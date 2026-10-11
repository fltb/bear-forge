import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileEntry } from '@bear-forge/compiler';
import { programDigest } from '@bear-forge/runtime-controlled';
import { ExperimentFiles, runTask, createTasks, RegistrationSchema, trajectories } from '../src/index.ts';
test('compiled Forge Duel checkpoints resume with policy state, trace prefix and same complete native result', async () => {
  const config = RegistrationSchema.parse({
      version: 1,
      game: 'forge-duel-v1',
      engine: 'controlled',
      id: 'controlled',
      blocks: 1,
      seed: 87,
      policies: ['last'],
      opponents: ['last'],
      maxSteps: 1000,
      maxAttempts: 3,
      minimumBlocks: 64,
      margin: 0.05,
      bootstrap: 2000,
      analysisSeed: 4
    }),
    directory = await mkdtemp(join(tmpdir(), 'bear-controlled-experiment-')),
    files = new ExperimentFiles(directory),
    content = (await compileEntry(new URL('../../../examples/forge-duel/src/module.ts', import.meta.url).pathname, 'program')).content;
  await files.write('artifact', {
    content: Buffer.from(content).toString('base64'),
    digest: programDigest(content)
  });
  const input = createTasks(config)[0]!;
  await files.register(config, [input]);
  await assert.rejects(() => promisify(execFile)(process.execPath, ['--experimental-strip-types', new URL('./crash-controlled-child.ts', import.meta.url).pathname, directory]));
  assert.equal((await files.results()).length, 0);
  const checkpoint: any = await files.read('checkpoint-' + input.id);
  assert.equal(checkpoint.step, 2);
  assert.equal((await files.receipt(input.id, 1))?.logicalStep, 1);
  assert.equal(await files.receipt(input.id, 2), null);
  await files.collectSnapshots();
  const resumed = await runTask(input, config, 2, files),
    native = await runTask(input, {
      ...config,
      engine: 'native'
    });
  assert.equal(resumed.status, 'ended', resumed.error ?? '');
  assert.deepEqual(resumed.result, native.result);
  assert.deepEqual(resumed.facts, native.facts);
  const traces = trajectories(resumed);
  for (const seat of ['0', '1']) assert.equal(traces[seat]!.transitions.reduce((s: number, t: any) => s + t.reward, 0), resumed.result.scores[seat]);
  assert.equal(new Set(resumed.facts.map(e => e.key)).size, resumed.facts.length);
});
