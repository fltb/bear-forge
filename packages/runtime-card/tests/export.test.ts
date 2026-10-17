import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { card } from '@bear-forge/card-engine';
import { CardGraph, privateCardGraph } from '../src/graph.ts';
import { createCardLoader } from '../src/index.ts';
import { createCapture } from '../../runtime/src/capture.ts';
import { Records } from '../../runtime/src/records.ts';
import { isOwned, isOwnedTree, isDenseTree, copyOwned, readOwned, sameData } from '../../boundary/src/values.ts';
const unwrap = (r: any): any => { assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r)); return r.value; };

test('a retained closed native handle releases its live world without a capture registry', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { setImmediate } from 'node:timers/promises';
    import { z } from 'zod';
    import { card } from '@bear-forge/card-engine';
    import { createCardLoader } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
    const u = r => { assert.equal(r.ok, true); return r.value; };
    let reference;
    const definition = { id: 'native-closed-world', schemas: { setup: z.null(), result: z.null(), ports: { ask: { input: z.number(), output: z.null() } } },
      initialize() { const world = { large: new Array(10000).fill(3) }; reference = new WeakRef(world); return world; },
      entry: 'main', effects: [{ id: 'main', steps: [card.request(s => ({ port: 'ask', input: s.state.large.length }))] }] };
    const loaded = u(await createCardLoader({ controlled: false }).load(definition));
    const handle = u(await loaded.core.start(null));
    assert.notEqual(reference.deref(), undefined);
    u(await handle.close()); assert.equal(loaded.capture, undefined);
    globalThis.retained = [loaded, handle];
    for (let i = 0; i < 12; i++) { await setImmediate(); globalThis.gc(); }
    await setImmediate();
    assert.equal(reference.deref(), undefined, 'closed handle retained the active world');
    assert.equal((await handle.inspect()).error.code, 'instance_closed');
  `;
  execFileSync(process.execPath, ['--experimental-strip-types', '--expose-gc', '--input-type=module', '-e', source], { stdio: 'pipe' });
});

test('native clone proof keeps graph identity, holes and ordinary independently mutable boundaries', async () => {
  const item = { n: -0 }, source: any = JSON.parse('{"__proto__":{"safe":true}}');
  source.a = item; source.b = item; source.self = source; source.values = [, undefined, 3n]; source.values.label = 4;
  let retained: any, parses = 0;
  const input = z.any(); input.parse = (value: any) => { parses++; retained = value; return value; };
  const definition = { id: 'native-private-proof', schemas: { setup: z.null(), result: z.any(), ports: {
    ask: { input, output: z.any() }
  } }, initialize: () => source, entry: 'main', effects: [{ id: 'main', steps: [
    card.request<any>(s => ({ port: 'ask', input: s.state }), 'reply'),
    card.operation<any>(s => { s.locals.reply.n = 5; }), card.return<any>(s => s.locals.reply)
  ] }] };
  const loaded = unwrap(await createCardLoader({ controlled: false, recordCore: true }).load(definition)), instance = unwrap(await loaded.core.start(null));
  const first = unwrap(await instance.inspect()).call.input;
  assert.equal(parses, 1); assert.equal(sameData(first, source), true); assert.equal(first.a, first.b); assert.equal(first.self, first);
  assert.equal(Object.hasOwn(first.values, 0), false); assert.equal(first.values.label, 4);
  first.a.n = 8; retained.a.n = 9;
  assert.equal(Object.is(unwrap(await instance.inspect()).call.input.a.n, -0), true);
  const reply = { n: 1 };
  unwrap(await instance.bind({ ask: async () => ({ kind: 'reply', value: reply }) }));
  const end = unwrap(await instance.run()).state; assert.equal(end.result.n, 5); assert.equal(reply.n, 1);
  const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 100 })).records;
  assert.equal(records.find((r: any) => r.kind === 'returned').reply.output.n, 1);
  assert.equal(Object.is(records.find((r: any) => r.kind === 'called').call.input.a.n, -0), true);
  await instance.close(); await loaded.capture?.release(instance.id);
});

test('native clone proof preserves getter normalization and unsupported-brand fault classification', async () => {
  for (const input of [new Date(0), new Map([['n', 1]]), new Uint8Array([1])]) {
    const definition = { id: 'native-invalid-brand', schemas: { setup: z.null(), result: z.any(), ports: { ask: { input: z.any(), output: z.null() } } },
      initialize: () => input, entry: 'main', effects: [{ id: 'main', steps: [card.request<any>(s => ({ port: 'ask', input: s.state }))] }] };
    const loaded = unwrap(await createCardLoader({ controlled: false }).load(definition)), instance = unwrap(await loaded.core.start(null));
    const stop = unwrap(await instance.inspect()); assert.equal(stop.kind, 'fault'); assert.equal(stop.error.code, 'invalid_output');
    await instance.close(); await loaded.capture?.release(instance.id);
  }
  let gets = 0;
  const definition = { id: 'native-getter-clone', schemas: { setup: z.null(), result: z.any(), ports: {} },
    initialize: () => ({ get n() { gets++; return 2; } }), entry: 'main', effects: [{ id: 'main', steps: [card.return<any>(s => s.state)] }] };
  const loaded = unwrap(await createCardLoader({ controlled: false }).load(definition)), instance = unwrap(await loaded.core.start(null));
  const result = unwrap(await instance.inspect()).result;
  assert.equal(gets, 1); assert.deepEqual(Object.getOwnPropertyDescriptor(result, 'n'), { value: 2, writable: true, enumerable: true, configurable: true });
  await instance.close(); await loaded.capture?.release(instance.id);
});

test('replaced native clone and native projections do not inherit construction proof', async () => {
  const definition = { id: 'native-clone-replacement', schemas: { setup: z.null(), result: z.any(), ports: {} },
    initialize: () => ({ n: 1 }), entry: 'main', effects: [{ id: 'main', steps: [card.return<any>(s => s.state)] }] };
  const clone = globalThis.structuredClone; let getters = 0;
  const loaded = unwrap(await createCardLoader({ controlled: false }).load(definition));
  globalThis.structuredClone = ((value: any) => {
    const out = clone(value);
    if (out?.kind === 'done') Object.defineProperty(out.result, 'n', { enumerable: true, get() { getters++; return 1; } });
    return out;
  }) as typeof structuredClone;
  let instance: any;
  try { instance = unwrap(await loaded.core.start(null)); }
  finally { globalThis.structuredClone = clone; }
  assert.equal(unwrap(await instance.inspect()).error.code, 'invalid_output'); assert.equal(getters, 0);
  await instance.close(); await loaded.capture?.release(instance.id);
  let retained: any;
  const projected = unwrap(await createCardLoader({ controlled: false }).load({ ...definition, project(stop: any) {
    assert.equal(isOwned(stop), false); retained = stop; return stop;
  } }));
  const handle = unwrap(await projected.core.start(null)); retained.result.n = 9;
  assert.equal(unwrap(await handle.inspect()).result.n, 1);
  await handle.close(); await projected.capture?.release(handle.id);
});

test('generic capture keeps its existing whole-batch graph identity policy', async () => {
  const shared = { n: 1 }, records = new Records<any>();
  records.push({ sequence: 0, kind: 'started', setup: shared });
  records.push({ sequence: 1, kind: 'completed', result: shared });
  const capture = createCapture(new Map([['generic', { records } as any]]));
  const read = unwrap(await capture.read('generic' as any, { after: null, limit: 10 })).records;
  assert.equal(read[0].setup, read[1].result); assert.notEqual(read[0].setup, shared);
});

test('public graph exports stay unbranded, independent and mutable across reads', () => {
  const graph = new CardGraph({ item: { n: 1 }, values: [-0, undefined, 3n] });
  const first = graph.export(graph.root), second = graph.export(graph.root);
  assert.equal(isOwned(first), false); assert.notEqual(first.item, second.item);
  first.item.n = 9; first.values.push(5);
  Object.defineProperty(first.item, 'n', { enumerable: true, get() { throw Error('must not run'); } });
  assert.throws(() => readOwned(z.any(), first), /enumerable data/);
  assert.deepEqual(graph.export(graph.root), second); graph.close();
});

test('private managed exports prove admission and share only unchanged primitive leaves', () => {
  const graph = privateCardGraph<any>({ fixed: { n: -0 }, item: { n: 1 }, values: [1, undefined, 3n] });
  const first = graph.export(graph.root), second = graph.export(graph.root);
  assert.equal(isOwned(first), true); assert.equal(isOwnedTree(first), true); assert.equal(isDenseTree(first), true);
  assert.equal(first.fixed, second.fixed); assert.equal(first.values, second.values);
  assert.notEqual(first, second);
  const publicValue = copyOwned(first); assert.equal(isOwned(publicValue), false); publicValue.fixed.n = 9;
  graph.root.item.n = 2; graph.root.values[0] = 2;
  const third = graph.export(graph.root);
  assert.equal(third.fixed, first.fixed); assert.notEqual(third.item, first.item); assert.notEqual(third.values, first.values);
  assert.equal(first.item.n, 1); assert.equal(first.values[0], 1); assert.equal(Object.is(third.fixed.n, -0), true);
  delete graph.root.item.n; graph.root.item.child = { n: 3 };
  const fourth = graph.export(graph.root); graph.root.item.child.n = 4;
  assert.equal(graph.export(graph.root).item.child.n, 4); assert.equal(fourth.item.child.n, 3);
  graph.root.values.length = 1; const short = graph.export(graph.root); graph.root.values.length = 3;
  const sparse = graph.export(graph.root);
  assert.equal(short.values.length, 1); assert.equal(Object.hasOwn(sparse.values, 1), false); assert.equal(isDenseTree(sparse), false);
  graph.root.values.label = 5; assert.equal(graph.export(graph.root).values.label, 5); graph.close();
});

test('private export identity, alias, cycle and fork proofs remain branch local', () => {
  const source: any = { a: { n: 1 }, separate: { n: 1 }, array: [, -0] }; source.b = source.a; source.self = source;
  const graph = privateCardGraph(source), initial = graph.export(graph.root), child = graph.fork();
  assert.equal(isOwnedTree(initial), false); assert.equal(initial.a, initial.b); assert.notEqual(initial.a, initial.separate); assert.equal(initial.self, initial);
  const forked = child.export(child.root); assert.equal(forked.a, initial.a);
  child.root.a.n = 2; graph.root.separate.n = 3;
  const parentValue = graph.export(graph.root), childValue = child.export(child.root);
  assert.equal(parentValue.a.n, 1); assert.equal(childValue.a.n, 2); assert.equal(childValue.separate.n, 1);
  assert.equal(initial.separate.n, 1); assert.equal(childValue.a, childValue.b);
  assert.equal(sameData(copyOwned(initial), source), true);
  graph.close(); assert.equal(child.export(child.root).a.n, 2); child.close();
});

test('unmanaged export roots never inherit cached private nodes or ownership', () => {
  const graph = privateCardGraph({ item: { n: 1 } }), owned = graph.export(graph.root);
  const mixed = graph.export({ item: graph.root.item });
  assert.equal(isOwned(mixed), false); assert.notEqual(mixed.item, owned.item);
  mixed.item.n = 8; assert.equal(graph.export(graph.root).item.n, 1); assert.equal(owned.item.n, 1); graph.close();
});

test('projection callbacks keep ordinary detached values and retained results cannot corrupt previous stops', async () => {
  let retained: any;
  const definition = { id: 'project-export-ownership', schemas: { setup: z.null(), result: z.any(), ports: { ask: { input: z.any(), output: z.null() } } },
    initialize: () => ({ item: { n: 1 } }), entry: 'main',
    effects: [{ id: 'main', steps: [card.request<any>(s => ({ port: 'ask', input: s.state })), card.operation<any>(s => { s.state.item.n++; }), card.return<any>(s => s.state)] }],
    project(stop: any) { assert.equal(isOwned(stop), false); assert.equal(Object.isFrozen(stop), false); retained = stop; return stop; }
  };
  const loaded = unwrap(await createCardLoader().load(definition)), instance = unwrap(await loaded.core.start(null));
  const first = unwrap(await instance.inspect()); retained.call.input.item.n = 9;
  assert.equal(unwrap(await instance.inspect()).call.input.item.n, 1);
  unwrap(await instance.bind({ ask: async () => ({ kind: 'reply', value: null }) }));
  const last = unwrap(await instance.run()).state; retained.result.item.n = 8;
  assert.equal(first.call.input.item.n, 1); assert.equal(last.result.item.n, 2); assert.equal(unwrap(await instance.inspect()).result.item.n, 2);
  await instance.close(); await loaded.capture?.release(instance.id);
});

test('private export falls back to fresh unbranded values when the array prototype condition changes', () => {
  const graph = privateCardGraph({ values: [1, 2] }), first = graph.export(graph.root);
  const original = Object.getPrototypeOf(Array.prototype);
  let exported: typeof first;
  Object.setPrototypeOf(Array.prototype, Object.create(null));
  try { exported = graph.export(graph.root); }
  finally { Object.setPrototypeOf(Array.prototype, original); }
  assert.equal(isOwned(exported!), false); assert.notEqual(exported!.values, first.values);
  exported!.values[0] = 9; assert.equal(first.values[0], 1); assert.equal(graph.export(graph.root).values[0], 1); graph.close();
});

test('private publications normalize DTO prototypes and preserve special keys and inherited write protection', () => {
  const key = '__privateLeafSetter', leaf = Object.create(null);
  Object.defineProperty(leaf, '__proto__', { value: -0, writable: true, configurable: true, enumerable: true });
  leaf[key] = 2;
  const graph = privateCardGraph({ leaf, ordinary: { [key]: 3 } }); let writes = 0;
  Object.defineProperty(Object.prototype, key, { set() { writes++; }, configurable: true });
  let first: any, second: any;
  try { first = graph.export(graph.root); second = graph.export(graph.root); }
  finally { delete (Object.prototype as any)[key]; }
  assert.equal(writes, 0); assert.equal(Object.getPrototypeOf(first.leaf), Object.prototype);
  assert.equal(Object.hasOwn(first.leaf, '__proto__'), true); assert.equal(Object.is(first.leaf.__proto__, -0), true);
  assert.equal(first.leaf, second.leaf); assert.equal(first.ordinary, second.ordinary);
  assert.equal(copyOwned(first).ordinary[key], 3); graph.close();
  const publicGraph = new CardGraph({ leaf });
  assert.equal(Object.getPrototypeOf(publicGraph.export(publicGraph.root).leaf), null);
  publicGraph.close();
});

test('physical sharing between stops never introduces public aliases between capture records, including restore', async () => {
  const leaf = { n: 1 };
  const definition = { id: 'record-alias-domains', schemas: { setup: z.null(), result: z.any(), ports: { ask: { input: z.any(), output: z.null() } } },
    initialize: () => ({ a: { ...leaf }, b: null as any }), entry: 'main', effects: [{ id: 'main', steps: [
      card.operation<any>(s => { s.state.b = s.state.a; }),
      card.request<any>(s => ({ port: 'ask', input: s.state })),
      card.request<any>(s => ({ port: 'ask', input: s.state })), card.return<any>(s => s.state)
    ] }]
  };
  for (const controlled of [false, true]) {
    const loaded = unwrap(await createCardLoader({ controlled, recordCore: true }).load(definition)), instance = unwrap(await loaded.core.start(null));
    unwrap(await instance.bind({ ask: async () => ({ kind: 'reply', value: null }) })); unwrap(await instance.run());
    const snapshot = controlled ? unwrap(await loaded.persistence.save(instance)) : null;
    const species = Object.getOwnPropertyDescriptor(Array, Symbol.species)!; let hooks = 0;
    Object.defineProperty(Array, Symbol.species, { configurable: true, get() { hooks++; throw Error('record copying consulted array species'); } });
    let pending: Promise<any>;
    try { pending = loaded.capture.read(instance.id, { after: null, limit: 100 }); }
    finally { Object.defineProperty(Array, Symbol.species, species); }
    unwrap(await pending!); assert.equal(hooks, 0);
    const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 100 })).records;
    const calls = records.filter((r: any) => r.kind === 'called');
    assert.equal(calls.length, 2); assert.equal(calls[0].call.input.a, calls[0].call.input.b);
    assert.notEqual(calls[0].call.input.a, calls[1].call.input.a, 'each boundary is an independent public snapshot');
    calls[0].call.input.a.n = 9; assert.equal(calls[1].call.input.a.n, 1);
    if (snapshot) {
      const restored = unwrap(await loaded.persistence.restore(snapshot));
      const copied = unwrap(await loaded.capture.read(restored.id, { after: null, limit: 100 })).records.filter((r: any) => r.kind === 'called');
      assert.equal(copied[0].call.input.a, copied[0].call.input.b); assert.notEqual(copied[0].call.input.a, copied[1].call.input.a);
      await restored.close(); await loaded.capture?.release(restored.id); await loaded.persistence.release(snapshot);
    }
    await instance.close(); await loaded.capture?.release(instance.id);
  }
});
