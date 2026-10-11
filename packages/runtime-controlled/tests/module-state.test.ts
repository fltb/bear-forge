import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEntry } from '@bear-forge/compiler';
import { createControlledLoader, programDigest } from '../src/index.ts';
let compiled: ReturnType<typeof compileEntry> | undefined;
const getArtifact = () => compiled ??= compileEntry(new URL('./module-state.ts', import.meta.url).pathname);
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};
test('module variables and exported schema closures restore with the same module environment', async () => {
  const artifact = await getArtifact();
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
  const original = await getArtifact();
  const content = JSON.parse(new TextDecoder().decode(original.content));
  content.exportName = 'namespaceProgram';
  const artifact = {
    ...original,
    content: new TextEncoder().encode(JSON.stringify(content))
  };
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
test('main-runtime instances interleave with independent modules, forks and registries without changing host builtins', async () => {
  const artifact = await getArtifact();
  const hostObjects = [globalThis, Math, Function.prototype, Array.prototype, Object.prototype, Promise, Promise.prototype, MessageChannel.prototype, MessagePort.prototype];
  const before = hostObjects.map(object => Object.getOwnPropertyDescriptors(object));
  const loader = createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)])
  });
  const loaded = unwrap(await loader.load(artifact));
  const other = unwrap(await loader.load(artifact));
  const a = unwrap(await loaded.core.start(null));
  const b = unwrap(await other.core.start(null));
  const saved = unwrap(await loaded.persistence.save(a));
  const branch = unwrap(await a.fork());
  const restored = unwrap(await loaded.persistence.restore(saved));
  for (const [instance, reply] of [[b, 10], [branch, 20], [a, 30], [restored, 40]] as const) {
    await instance.bind({
      step: async () => ({
        kind: 'reply',
        value: reply
      })
    });
    assert.deepEqual(unwrap(await instance.run()).state, {
      kind: 'done',
      result: reply + 1
    });
    await instance.close();
  }
  await loaded.persistence.release(saved);
  hostObjects.forEach((object, index) => {
    const after = Object.getOwnPropertyDescriptors(object);
    assert.deepEqual(Reflect.ownKeys(after), Reflect.ownKeys(before[index]!));
    for (const key of Reflect.ownKeys(after)) {
      const actual = Reflect.get(after, key),
        expected = Reflect.get(before[index]!, key);
      assert.deepEqual(Reflect.ownKeys(actual), Reflect.ownKeys(expected));
      for (const field of Reflect.ownKeys(actual)) assert.strictEqual(actual[field], expected[field], `host object ${index}, property ${String(key)}, field ${String(field)}`);
    }
  });
  assert.deepEqual(await Promise.all([Promise.resolve(1), Promise.resolve(2)]), [1, 2]);
  assert.deepEqual([...['host', 'array'].values()], ['host', 'array']);
});
