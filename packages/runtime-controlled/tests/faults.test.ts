import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEntry } from '@bear-forge/compiler';
import { createControlledLoader, programDigest } from '../src/index.ts';
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};
test('budget and undeclared entropy latch; overlapping or abandoned IO cannot become success; Done snapshots and artifact trust', async () => {
  const artifact = await compileEntry(new URL('./faults-fixture.ts', import.meta.url).pathname);
  assert.equal((await createControlledLoader({
    trustedDigests: new Set()
  }).load(artifact)).ok, false);
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)]),
    stepBudget: 100000
  }).load(artifact));
  for (const mode of ['loop', 'catch-loop', 'entropy', 'overlap', 'pending', 'schema-budget']) {
    const x = unwrap(await loaded.core.start(mode)),
      stop = unwrap(await x.inspect());
    assert.equal(stop.kind, 'fault', mode + ' ' + JSON.stringify(stop));
    assert.equal(stop.error.code, mode.includes('loop') || mode === 'schema-budget' ? 'budget_exceeded' : 'program_failed');
    assert.equal((await loaded.persistence.save(x)).ok, false);
    await x.close();
  }
  const ended = unwrap(await loaded.core.start('done'));
  assert.deepEqual(unwrap(await ended.inspect()), {
    kind: 'done',
    result: 4
  });
  const snapshot = unwrap(await loaded.persistence.save(ended));
  await ended.close();
  const restored = unwrap(await loaded.persistence.restore(snapshot));
  assert.deepEqual(unwrap(await restored.run()), {
    state: {
      kind: 'done',
      result: 4
    },
    accepted: false,
    pause: null
  });
  unwrap(await loaded.persistence.release(snapshot));
  assert.equal((await loaded.persistence.restore(snapshot)).ok, false);
  unwrap(await loaded.persistence.release(snapshot));
  await restored.close();
});
