import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistrationSchema, createTasks, runTask, runExperiment } from '../src/experiment/execution.ts';
import type { Task } from '../src/experiment/execution.ts';
import { createScript, PolicyRouter } from '@bear-forge/policies';
import { createCardLoader } from '@bear-forge/runtime-card';
import { createGameBinder } from '@bear-forge/game-host';
import { game } from '../src/module.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ExperimentFiles } from '@bear-forge/experiments';

const combinations: Task['seats'][] = [
  ['last', 'last', 'last'], ['random', 'random', 'random'],
  ['first', 'last', 'random'], ['random', 'first', 'last'], ['last', 'random', 'first']
];
function semantic(value: unknown): unknown {
  const ids = new Map<string, string>();
  return JSON.parse(JSON.stringify(value, (key, item) => {
    // Restore creates a new physical instance for the same logical game.
    if (key === 'instanceId') return 'logical-game';
    if (key === 'callId' && typeof item === 'string') {
      if (!ids.has(item)) ids.set(item, 'identity-' + ids.size);
      return ids.get(item);
    }
    return item;
  }));
}

test('production script experiments preserve accepted decisions and repeat across native/controlled modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ddz-script-'));
  try {
    for (const [index, seats] of combinations.entries()) {
      const config = RegistrationSchema.parse({ id: 'scripts-' + index, seats, seed: 7 });
      const task = createTasks(config)[0]!;
      const native = await runTask(task, config);
      assert.equal(native.status, 'ended', native.error ?? 'expected terminal game');
      assert.equal(Object.values<number>(native.result.scores).reduce((a, b) => a + b, 0), 0);
      for (const decision of native.decisions) {
        const request = native.packets.find(packet => packet.kind === 'request'
          && JSON.stringify(packet.value.id) === JSON.stringify(decision.accepted.reply.requestId))?.value;
        assert.ok(request, 'accepted action must join to a delivered observation');
        assert.equal(request.options.kind, 'exact');
        assert.ok(request.options.values.some((action: unknown) => JSON.stringify(action) === JSON.stringify(decision.proposal.action)));
        assert.equal(decision.proposal.policyVersion, seats[Number(request.player)] + '-legal@1');
      }
      for (const player of ['0', '1', '2']) {
        assert.equal(native.policy.actors[player].memory.decisions,
          native.decisions.filter(d => d.accepted.player === player).length);
      }
      const repeated = await runTask(task, config);
      assert.deepEqual(semantic(repeated.decisions), semantic(native.decisions));
      assert.deepEqual(repeated.result, native.result);
      const controlledConfig = { ...config, engine: 'controlled' as const, checkpointEvery: 20 };
      const controlled = await runExperiment(join(directory, String(index)), controlledConfig);
      const row: any = await controlled.files.read('task-' + task.id);
      assert.equal(row.status, 'ended', row.error);
      assert.deepEqual(row.result, native.result);
      assert.deepEqual(semantic(row.decisions), semantic(native.decisions));
      assert.deepEqual(semantic(row.packets), semantic(native.packets));
      const resumed = await runExperiment(join(directory, String(index)));
      assert.deepEqual(resumed.results, controlled.results, 'completed tasks must not run twice');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('FirstLegal remains all-pass and is bounded without inventing a terminal loss', async () => {
  const config = RegistrationSchema.parse({ id: 'all-first', seats: ['first', 'first', 'first'], maxSteps: 12 });
  const row = await runTask(createTasks(config)[0]!, config);
  assert.equal(row.status, 'truncated');
  assert.equal(row.result, null);
  assert.equal(row.decisions.length, 12);
  assert.equal(row.cost.steps, 12);
  assert.equal(row.error, 'Experiment step budget exceeded');
  assert.ok(row.decisions.every(d => d.proposal.action.kind === 'bid' && d.proposal.action.value === 0));
});

test('a killed script experiment resumes its saved random stream without duplicating accepted samples', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ddz-recovery-'));
  try {
    await assert.rejects(promisify(execFile)(process.execPath, ['--experimental-strip-types',
      fileURLToPath(new URL('./experiment-crash-child.ts', import.meta.url)), directory]),
    (error: any) => error.signal === 'SIGKILL');
    const saved: any = await new ExperimentFiles(directory, (row: any) => row).read('checkpoint-recovery-0');
    const prior:any=await new ExperimentFiles(directory,(row:any)=>row).read('attempt-recovery-0');
    assert.equal(saved.step, 10, 'the process must die after a durable checkpoint');
    assert.equal(prior.attempt,1);
    const recovered = await runExperiment(directory);
    assert.equal(recovered.results.length, 1);
    const row: any = await recovered.files.read('task-recovery-0');
    assert.equal(row.status, 'ended', row.error);
    assert.equal(row.attempt,prior.attempt,'direct continuation belongs to the same attempt');
    assert.deepEqual(row.decisions.slice(0,saved.decisions.length),saved.decisions);
    const config = RegistrationSchema.parse({ id: 'recovery', seats: ['random', 'random', 'random'], seed: 7 });
    const baseline = await runTask(createTasks(config)[0]!, config);
    assert.deepEqual(row.result, baseline.result);
    assert.deepEqual(semantic(row.decisions), semantic(baseline.decisions));
    assert.deepEqual(semantic(row.packets), semantic(baseline.packets));
    assert.equal(new Set(row.decisions.map((d: any) => d.step)).size, row.decisions.length);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('controlled records from the three real script players retain one original terminal execution', async () => {
  const unwrap = (result: any): any => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  const loaded = unwrap(await createCardLoader({ controlled: true, recordCore: true }).load(game.definition));
  const instance = unwrap(await loaded.core.start({ seed: 7, game: {
    profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0
  } }));
  const host = unwrap(await createGameBinder().bind({ instance, contract: game.contract }));
  const router = new PolicyRouter({ '0': createScript('first'), '1': createScript('last'), '2': createScript('random') }, 7);
  try {
    for (const player of ['0', '1', '2']) unwrap(await host.bind(router.binding(player)));
    let ended = false;
    for (let step = 0; step < 600; step++) {
      router.begin();
      const next = unwrap(await host.run());
      const staged = router.prepare(next.accepted);
      router.commit('actual:' + step, staged.state);
      assert.notEqual(next.state.kind, 'fault');
      if (next.state.kind === 'ended') { ended = true; break; }
    }
    assert.equal(ended, true);
    const records: any[] = [];
    let after: number | null = null;
    do {
      const page = unwrap(await loaded.capture.read(instance.id, { after, limit: 1000 }));
      records.push(...page.records); after = page.next;
    } while (after !== null);
    assert.equal(records.at(-1)?.kind,'completed');
    assert.equal(new Set(records.filter(row=>row.kind==='called').map(row=>row.callId)).size,records.filter(row=>row.kind==='called').length);
  } finally {
    unwrap(await host.close());
    unwrap(await loaded.capture.release(instance.id));
  }
});
