import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { game } from '../src/module.ts';
import { ExperimentFiles, runTask, createTasks, RegistrationSchema, trajectories } from '@bear-forge/forge-duel/experiment/execution';
// Normalize only generated protocol identities, preserving their repeated-use
// relationships across observations, accepted replies and durable commits.
function semantic(row: any) {
  // Restoring creates a new InstanceId by contract. Validate the concrete
  // request identity before mapping all restored epochs to this logical task.
  const requests = row.packets.filter((packet: any) => packet.kind === 'request');
  for (const decision of row.decisions) {
    const accepted = decision.accepted;
    assert.ok(requests.some((packet: any) => packet.player === accepted.player
      && packet.value.id.instanceId === accepted.reply.requestId.instanceId
      && packet.value.id.callId === accepted.reply.requestId.callId
      && packet.value.id.key === accepted.reply.requestId.key), 'accepted request must match a delivered identity');
  }
  const calls = new Map<string, number>();
  const visit = (value: any, key = ''): any => {
    if (key === 'instanceId' && typeof value === 'string') return row.id;
    if (key === 'callId' && typeof value === 'string') {
      if (!calls.has(value)) calls.set(value, calls.size);
      return calls.get(value);
    }
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name)]));
    return value;
  };
  return visit({ input: row.input, status: row.status, result: row.result, facts: row.facts,
    packets: row.packets, decisions: row.decisions, commits: row.commits, policy: row.policy });
}
test('Card Core Forge Duel checkpoints resume with policy state, trace prefix and same complete native result', async () => {
  const config = RegistrationSchema.parse({
      version: 1,
      game: 'forge-duel-v1',
      engine: 'controlled',
      checkpointEvery: 1,
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
    files = new ExperimentFiles(directory);
  const executable = { kind: 'card', rule: game.definition.id };
  await files.write('artifact', executable);
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
  assert.deepEqual(semantic(resumed), semantic(native));
  for (const checkpointEvery of [0, 5]) {
    const fresh = new ExperimentFiles(await mkdtemp(join(tmpdir(), 'bear-checkpoint-frequency-')));
    await fresh.write('artifact', executable);
    const uninterrupted = await runTask(input, {
      ...config,
      checkpointEvery
    }, 1, fresh);
    assert.equal(uninterrupted.status, 'ended', uninterrupted.error ?? '');
    assert.deepEqual(uninterrupted.result, native.result);
    assert.deepEqual(uninterrupted.facts, native.facts);
    assert.deepEqual(semantic(uninterrupted), semantic(native));
    if (checkpointEvery === 0) assert.equal(uninterrupted.cost.snapshotBytes, 0);else assert.ok(uninterrupted.cost.snapshotBytes! > 0);
  }
  const traces = trajectories(resumed);
  for (const seat of ['0', '1']) assert.equal(traces[seat]!.transitions.reduce((s: number, t: any) => s + t.reward, 0), resumed.result.scores[seat]);
  assert.equal(new Set(resumed.facts.map(e => e.key)).size, resumed.facts.length);
  // Independent seeds and policies exercise each decision checkpoint with the
  // same complete player observations, legal choices and accepted actions.
  for (const [seed, script] of [[87, 'rule'], [991, 'last'], [991, 'rule']] as const) {
    const variant = RegistrationSchema.parse({ ...config, seed, policies: [script] });
    const task = createTasks(variant)[0]!;
    const storage = new ExperimentFiles(await mkdtemp(join(tmpdir(), 'bear-controlled-seeded-')));
    await storage.write('artifact', executable);
    let controlled;
    let checkpoints = 0;
    for (;;) {
      let advances = 0;
      controlled = await runTask(task, variant, 1, storage, { point(stage) {
        if (stage === 'before-advance' && ++advances === 2) throw Error('test checkpoint restart');
      } });
      if (controlled.status !== 'fault' || controlled.error !== 'Error: test checkpoint restart') break;
      const saved: any = await storage.read('checkpoint-' + task.id);
      assert.ok(saved.step > checkpoints, 'resume must advance beyond the saved decision');
      checkpoints = saved.step;
      assert.ok(checkpoints < variant.maxSteps);
    }
    const reference = await runTask(task, { ...variant, engine: 'native' });
    assert.equal(controlled.status, 'ended', controlled.error ?? '');
    assert.deepEqual(semantic(controlled), semantic(reference), `seed ${seed}, policy ${script}`);
    assert.ok(checkpoints > 1);
  }

});
