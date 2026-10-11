import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentFiles, createTasks, runTask, RegistrationSchema } from '../src/index.ts';
const config = RegistrationSchema.parse({
  version: 1,
  game: 'forge-duel-v1',
  id: 'test',
  blocks: 1,
  seed: 19,
  policies: ['rule'],
  opponents: ['last'],
  maxSteps: 1000,
  maxAttempts: 2,
  minimumBlocks: 64,
  margin: 0.05,
  bootstrap: 2000,
  analysisSeed: 51
});
test('registered disjoint phases, seats and complete factorial conditions', () => {
  const tasks = createTasks(config);
  assert.equal(tasks.length, 16);
  assert.equal(new Set(tasks.map(t => t.id)).size, 16);
  const seeds = tasks.filter(t => t.phase === 'discovery').map(t => t.seed);
  assert.ok(tasks.filter(t => t.phase === 'confirmation').every(t => !seeds.includes(t.seed)));
});
test('real production game, policies, private packets, audit facts and durable receipt', async () => {
  const input = createTasks(config)[0]!,
    result = await runTask(input, config);
  assert.equal(result.status, 'ended', JSON.stringify(result.error));
  assert.ok(result.facts.some(e => e.kind === 'carry'));
  assert.ok(result.facts.some(e => e.kind === 'available'));
  assert.ok(result.decisions.length);
  assert.equal(result.lineage?.rootTaskId, input.id);
  for (const p of result.packets) {
    assert.ok(!('seed' in (p.value.observation ?? {})));
    if (p.kind === 'event') assert.notEqual(p.value.event.visibility, 'audit');
  }
  const path = await mkdtemp(join(tmpdir(), 'bear-experiment-')),
    files = new ExperimentFiles(path);
  await files.register(config, [input]);
  await files.commit(input.id, result);
  await files.commit(input.id, {
    invalid: true
  });
  const restarted = new ExperimentFiles(path);
  assert.deepEqual(await restarted.results(), [result]);
  assert.deepEqual(await restarted.receipt(input.id, 0), result.commits![0]);
  await assert.rejects(() => restarted.register({
    ...config,
    seed: 20
  }, [input]), /mismatch/);
});
test('exclusive writer snapshot collection retains referenced checkpoints and removes abandoned snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-snapshot-gc-')),
    files = new ExperimentFiles(directory),
    kept = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    orphan = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await mkdir(join(directory, 'snapshots'));
  await writeFile(join(directory, 'snapshots', kept + '.snapshot'), 'keep');
  await writeFile(join(directory, 'snapshots', orphan + '.snapshot'), 'orphan');
  await files.write('checkpoint-task', {
    snapshot: {
      snapshotId: kept
    }
  });
  await files.collectSnapshots();
  assert.equal(await readFile(join(directory, 'snapshots', kept + '.snapshot'), 'utf8'), 'keep');
  await assert.rejects(() => readFile(join(directory, 'snapshots', orphan + '.snapshot')));
  await files.remove('checkpoint-task');
  await files.collectSnapshots();
  await assert.rejects(() => readFile(join(directory, 'snapshots', kept + '.snapshot')));
});
test('bounded concurrent batches reproduce independent sequential tasks; memory exhaustion is truncated without a fabricated result', async () => {
  const {
    runExperiment
  } = await import('../src/index.ts');
  const sequential = await runExperiment(await mkdtemp(join(tmpdir(), 'bear-sequential-')), config);
  const concurrent = await runExperiment(await mkdtemp(join(tmpdir(), 'bear-concurrent-')), {
    ...config,
    concurrency: 2
  });
  const semantic = (rows: any[]) => rows.map(row => ({
    id: row.id,
    result: row.result,
    facts: row.facts,
    decisions: row.decisions.map((d: any) => ({
      action: d.proposal.action,
      probability: d.proposal.probability
    }))
  }));
  assert.deepEqual(semantic(await sequential.files.results()), semantic(await concurrent.files.results()));
  const input = createTasks(config)[0]!;
  const exhausted = await runTask(input, {
    ...config,
    memoryBudgetMB: 32
  });
  assert.equal(exhausted.status, 'truncated');
  assert.equal(exhausted.result, null);
  assert.equal(exhausted.cost.steps, 0);
  assert.equal(RegistrationSchema.safeParse({
    ...config,
    concurrency: 5
  }).success, false);
});
