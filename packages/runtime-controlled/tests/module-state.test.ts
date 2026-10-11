import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEntry } from '@bear-forge/compiler';
import { createControlledLoader, programDigest } from '../src/index.ts';
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};
test('module variables and exported schema closures restore with the same module environment', async () => {
  const artifact = await compileEntry(new URL('./module-state.ts', import.meta.url).pathname);
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)])
  }).load(artifact));
  const a = unwrap(await loaded.core.start(null));
  const saved = unwrap(await loaded.persistence.save(a));
  await a.close();
  const b = unwrap(await loaded.persistence.restore(saved));
  await b.bind({
    step: async () => ({
      kind: 'reply',
      value: 4
    })
  });
  assert.deepEqual(unwrap(await b.run()).state, {
    kind: 'done',
    result: 5
  });
  await b.close();
  await loaded.persistence.release(saved);
});
test('export namespace identity and compound assignment references survive restoration', async () => {
  const artifact = await compileEntry(new URL('./module-state.ts', import.meta.url).pathname, 'namespaceProgram');
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)])
  }).load(artifact));
  const first = unwrap(await loaded.core.start(null)),
    snapshot = unwrap(await loaded.persistence.save(first));
  await first.close();
  const next = unwrap(await loaded.persistence.restore(snapshot));
  await next.bind({
    step: async () => ({
      kind: 'reply',
      value: 4
    })
  });
  assert.deepEqual(unwrap(await next.run()).state, {
    kind: 'done',
    result: 5
  });
  await next.close();
  await loaded.persistence.release(snapshot);
});
