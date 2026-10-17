import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const entry = fileURLToPath(new URL('../src/training/cli.ts', import.meta.url));
const events = (output: string) => output.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));

test('training CLI stops at a game boundary, resumes optimizer steps and evaluates held-out seeds', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ddz-cli-train-'));
  const output = join(directory, 'model'), configPath = join(directory, 'config.json');
  try {
    await writeFile(configPath, JSON.stringify({ output, samples: 100000, minutes: 1, batchSamples: 16 }));
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', entry, 'train', configPath]);
      let stdout = '', stderr = '', sent = false;
      const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
      child.stdout.on('data', chunk => {
        stdout += String(chunk);
        if (!sent && stdout.includes('training-progress')) { sent = true; child.kill('SIGINT'); }
      });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (code !== 0) reject(Error(`training exit ${code}/${signal}: ${stderr}`)); else resolve(stdout);
      });
    });
    const stopped = events(text).find(event => event.event === 'training-complete');
    assert.equal(stopped.stopped, true);
    assert.ok(stopped.samples > 0);
    await assert.rejects(access(join(output, '.writer.lock')), { code: 'ENOENT' });
    await writeFile(configPath, JSON.stringify({ output, checkpoint: join(output, 'model.pt'), samples: 400, minutes: 1, batchSamples: 16 }));
    const resumed = await promisify(execFile)(process.execPath, ['--experimental-strip-types', entry, 'resume', configPath]);
    const complete = events(resumed.stdout).find(event => event.event === 'training-complete');
    assert.deepEqual(complete.initialUpdates, stopped.updates);
    assert.ok(complete.newSamples >= 400);
    assert.ok(Object.values<number>(complete.updates).every((value, index) => value > Object.values<number>(stopped.updates)[index]!));
    await writeFile(configPath, JSON.stringify({ output, checkpoint: join(output, 'model.pt'),
      previousCheckpoint: join(output, 'previous-1.pt'), seed: 1000000, evaluationSeeds: 1 }));
    const evaluated = await promisify(execFile)(process.execPath, ['--experimental-strip-types', entry, 'eval', configPath]);
    const evaluation = events(evaluated.stdout).find(event => event.event === 'evaluation-complete');
    assert.equal(evaluation.ended, 8);
    assert.equal(evaluation.evaluationMode, 'team');
    assert.deepEqual(new Set(evaluation.summaries.map((row: any) => row.group)), new Set(['landlord', 'peasants', 'overall']));
    assert.equal(evaluation.fault, 0);
    assert.equal(evaluation.truncated, 0);
    assert.deepEqual(new Set(evaluation.summaries.map((row: any) => row.opponent)), new Set(['first', 'last', 'random', 'previous']));
    await assert.rejects(access(join(output, '.writer.lock')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('pretrained CLI imports both modes, trains against a frozen teacher and resumes queued cross-game batches', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ddz-cli-wp-'));
  const invoke = promisify(execFile);
  const python = fileURLToPath(new URL('../.venv/bin/python', import.meta.url));
  const source = fileURLToPath(new URL('../src/training', import.meta.url));
  const weights = join(directory, 'weights'), teacher = join(directory, 'teacher'), student = join(directory, 'student');
  const configPath = join(directory, 'config.json');
  const run = async (command: string, config: Record<string, unknown>) => {
    await writeFile(configPath, JSON.stringify(config));
    const result = await invoke(process.execPath, ['--experimental-strip-types', entry, command, configPath]);
    return events(result.stdout).at(-1);
  };
  try {
    await invoke(python, ['-c', `import sys,torch; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from douzero_adapter import create_learner,ROLES; p=Path(sys.argv[2]); p.mkdir(); m,_,_=create_learner(extended=False); [torch.save(m.get_model(r).state_dict(),p/(r+'.ckpt')) for r in ROLES]`, source, weights]);
    const baseline = await run('init', { output: teacher, pretrainedDirectory: weights, pretrainedMode: 'original' });
    assert.equal(baseline.modelKind, 'original');
    const trained = await run('train', { output: student, pretrainedDirectory: weights,
      teacherCheckpoint: join(teacher, 'model.pt'), samples: 1000, minutes: 1, batchSamples: 64 });
    assert.equal(trained.modelKind, 'extended');
    assert.ok(trained.teacherGames > 0 && trained.teacherGames < trained.episodes);
    assert.deepEqual(Object.values(trained.teacherUpdates), [0, 0, 0]);
    assert.ok(Object.values<number>(trained.updates).every(value => value > 0));
    assert.equal(Object.values<number>(trained.learnedSamples).reduce((a, b) => a + b, 0)
      + Object.values<number>(trained.pendingSamples).reduce((a, b) => a + b, 0), trained.samples);
    const resumed = await run('resume', { output: student, checkpoint: join(student, 'model.pt'),
      teacherCheckpoint: join(teacher, 'model.pt'), samples: 300, minutes: 1, batchSamples: 64 });
    assert.deepEqual(resumed.initialUpdates, trained.updates);
    assert.equal(resumed.teacherVersion, trained.teacherVersion);
    assert.equal(Object.values<number>(resumed.learnedSamples).reduce((a, b) => a + b, 0)
      + Object.values<number>(resumed.pendingSamples).reduce((a, b) => a + b, 0), resumed.samples);
    const evaluated = await run('eval', { output: student, checkpoint: join(student, 'model.pt'),
      previousCheckpoint: join(teacher, 'model.pt'), seed: 1000000, evaluationSeeds: 1, evaluationMode: 'both' });
    assert.equal(evaluated.ended, 20);
    assert.equal(evaluated.fault, 0);
    assert.deepEqual(new Set(evaluated.summaries.map((row: any) => row.mode)), new Set(['team', 'single']));
    for (const summary of evaluated.summaries.filter((row: any) => row.group !== 'overall')) {
      assert.ok(summary.wilson95[0] < summary.wilson95[1]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
