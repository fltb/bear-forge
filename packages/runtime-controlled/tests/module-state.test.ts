import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEntry } from '@bear-forge/compiler';
import { createControlledLoader, programDigest } from '../src/index.ts';
import { ProgramExecution, decode } from '../src/execution.ts';
let compiled: ReturnType<typeof compileEntry> | undefined;
const getArtifact = () => compiled ??= compileEntry(new URL('./module-state.ts', import.meta.url).pathname);
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};
test('Zod initialization and schema closures operate against the logical object heap', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const artifact=decode((await getArtifact()).content),instance=new ProgramExecution(artifact);
  const state=instance.loaded.effects.State.context;
  state.objects=new CowHeap();
  try {
    instance.admitSchemas();
    const schemas=instance.boundarySchemas();
    assert.equal(schemas.setup.parse(null),null);
    assert.throws(()=>schemas.setup.parse(1));
    instance.start(null);
    assert.deepEqual(instance.io.callData,{port:'step',input:1});
    assert.equal(schemas.ports.step.input.parse(1),1);
    instance.resume(2);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.equal(instance.result.value,3);
    assert.equal(schemas.result.parse(3),3);
    assert.throws(()=>schemas.result.parse(4));
  } finally {state.objects=undefined;instance.dispose();}
});
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
  // Node 26.5 materializes lazy globals (including Undici symbols) while
  // descriptors are first read. Finish that host operation before the baseline;
  // still compare every key and descriptor after running our code.
  hostObjects.forEach(object => Object.getOwnPropertyDescriptors(object));
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

test('dependency configuration and its callback captures belong to Context across interleaving and restore', async () => {
  const original=await getArtifact();
  const content=JSON.parse(new TextDecoder().decode(original.content));content.exportName='configurationProgram';
  const artifact={...original,content:new TextEncoder().encode(JSON.stringify(content))};
  const loaded=unwrap(await createControlledLoader({trustedDigests:new Set([programDigest(artifact.content)])}).load(artifact));
  const a=unwrap(await loaded.core.start(1)), b=unwrap(await loaded.core.start(10));
  const saved=unwrap(await loaded.persistence.save(a)), branch=unwrap(await a.fork()), restored=unwrap(await loaded.persistence.restore(saved));
  for(const [instance,reply,expected] of [[b,2,'context:12'],[a,3,'context:4'],[branch,4,'context:5'],[restored,5,'context:6']] as const){
    await instance.bind({step:async()=>({kind:'reply',value:reply})});
    assert.deepEqual(unwrap(await instance.run()).state,{kind:'done',result:expected});
    await instance.close();
  }
  await loaded.persistence.release(saved);
});


test('public loader admits schemas once and fork/restore reuse registered code without initializing', async () => {
  const artifact = await getArtifact();
  const registered = new ProgramExecution(decode(artifact.content));
  const before = registered.loaded.statistics.initializations;
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)])
  }).load(artifact));
  assert.equal(registered.loaded.statistics.initializations, before + 1);
  const instance = unwrap(await loaded.core.start(null));
  assert.equal(registered.loaded.statistics.initializations, before + 2);
  const saved = unwrap(await loaded.persistence.save(instance));
  const branch = unwrap(await instance.fork());
  await instance.close();
  const restored = unwrap(await loaded.persistence.restore(saved));
  assert.equal(registered.loaded.statistics.initializations, before + 2);
  for (const handle of [branch, restored]) {
    await handle.bind({ step: async () => ({ kind: 'reply', value: 8 }) });
    assert.deepEqual(unwrap(await handle.run()).state, { kind: 'done', result: 9 });
    await handle.close();
  }
  await loaded.persistence.release(saved);
  registered.dispose();
});
