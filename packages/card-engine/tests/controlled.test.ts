import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEntry } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../../runtime-controlled/src/execution.ts';
import { createControlledLoader, programDigest } from '@bear-forge/runtime-controlled';

test('nested continuations restore without replay and fork with isolated locals, results and frames', async () => {
  const compiled = await compileEntry(new URL('./fixtures/nested.ts', import.meta.url).pathname, 'program');
  const artifact = decode(compiled.content);
  const parent = new ProgramExecution(artifact, 10_000_000);
  parent.start(2);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const initializations = parent.loaded.statistics.initializations;
  const first = structuredClone(parent.io.callData);
  const child = parent.fork();
  const restored = parent.fresh();
  restored.restore(parent.snapshot());
  assert.strictEqual(child.loaded, parent.loaded);
  assert.strictEqual(restored.loaded, parent.loaded);
  for (const [instance, reply] of [[parent, 3], [child, 8], [restored, 3]] as const) {
    assert.deepEqual(instance.io.callData, first);
    instance.resume(reply);
    assert.equal(instance.result.status, 0, String(instance.result.value));
    assert.deepEqual(instance.io.callData, { port: 'choose', input: {
      sum: 2 * reply, starts: 2, frames: ['root', 'round', 'choose'],
    } });
  }
  const second = parent.fresh(); second.restore(parent.snapshot());
  parent.dispose(); // A surviving child/snapshot does not depend on its parent.
  for (const [instance, firstReply] of [[child, 8], [restored, 3], [second, 3]] as const) {
    instance.resume(4);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, { sum: 2 * (firstReply + 4), starts: 2, rounds: 2,
      items: [7, 8, 99, 99], seen: [2 * firstReply, 8, 7, 8] });
    instance.dispose();
  }
  assert.equal(parent.loaded.statistics.initializations, initializations);
  const parallel = parent.fresh(10_000_000);
  parallel.start(99);
  assert.equal(parallel.result.status, 0, String(parallel.result.value));
  const parallelRestored = parallel.fresh(10_000_000);
  parallelRestored.restore(parallel.snapshot());
  parallel.dispose();
  parallelRestored.resume(7);
  assert.equal(parallelRestored.result.status, 1, String(parallelRestored.result.value));
  assert.deepEqual(parallelRestored.result.value, { sum: 7, starts: 1, rounds: 0, items: [7, 8], seen: [] });
  parallelRestored.dispose();
  const loaded = await createControlledLoader({ trustedDigests: new Set([programDigest(compiled.content)]), stepBudget: 1_000_000 }).load(compiled);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw Error('load failed');
  const looping = await loaded.value.core.start(0);
  assert.equal(looping.ok, true);
  if (!looping.ok) throw Error('start failed');
  const stopped = await looping.value.inspect();
  assert.equal(stopped.ok, true);
  if (!stopped.ok || stopped.value.kind !== 'fault') throw Error('loop must fault');
  assert.equal(stopped.value.error.code, 'budget_exceeded');
  assert.equal((await loaded.value.persistence!.save(looping.value)).ok, false);
  await looping.value.close();
  await loaded.value.capture!.release(looping.value.id);
});
