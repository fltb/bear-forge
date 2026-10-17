import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { card as c, CardProgram, CardMachine, plainCardStorage } from '@bear-forge/card-engine';
import type { CardDefinition } from '@bear-forge/card-engine';
import { createCardLoader } from '../src/index.ts';
import { CardGraph } from '../src/graph.ts';
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
type State = { n: number };
test('own undefined values shadow prototypes, while missing graph fields still use the original prototype', () => {
  const key = '__cardOwnUndefined', array = new Array(10001);
  array[10000] = undefined;
  const plain = new CardGraph({ [key]: undefined }), indexed = new CardGraph(array);
  const nullData = Object.create(null); nullData[key] = undefined;
  const nullGraph = new CardGraph(nullData);
  let objectReads = 0, arrayReads = 0;
  const values: unknown[] = [];
  Object.defineProperty(Object.prototype, key, { configurable: true, get() { objectReads++; return 9; } });
  Object.defineProperty(Array.prototype, '10000', { configurable: true, get() { arrayReads++; return 8; } });
  try {
    values.push(plain.root[key], indexed.root[10000], nullGraph.root[key]);
    delete (plain.root as Record<string, unknown>)[key]; delete indexed.root[10000]; delete nullGraph.root[key];
    values.push(plain.root[key], indexed.root[10000], nullGraph.root[key]);
  } finally {
    delete (Object.prototype as any)[key]; delete (Array.prototype as any)['10000'];
    plain.close(); indexed.close(); nullGraph.close();
  }
  assert.deepEqual(values, [undefined, undefined, undefined, 9, 8, undefined]);
  assert.equal(objectReads, 1); assert.equal(arrayReads, 1);
});
test('inherited descriptor value fields cannot admit accessors into card state or exports', () => {
  let getters = 0;
  const accessor = { get n() { getters++; return 1; } }, graph = new CardGraph({ n: 0 });
  let stateRejected = false, exportRejected = false;
  Object.defineProperty(Object.prototype, 'value', { value: 1, writable: true, configurable: true });
  try {
    try { new CardGraph(accessor); } catch (error) { stateRejected = error instanceof TypeError; }
    try { graph.export(accessor); } catch (error) { exportRejected = error instanceof TypeError; }
  } finally { delete (Object.prototype as any).value; graph.close(); }
  assert.equal(stateRejected, true); assert.equal(exportRejected, true); assert.equal(getters, 0);
});
test('graph export preserves dangerous fields and cannot invoke inherited setters', () => {
  const key = '__cardExportSetter', value: any = JSON.parse('{"__proto__":{"n":1}}');
  value[key] = 2; value.array = [, undefined]; value.array[key] = 3; value.alias = value.array; value.self = value;
  const graph = new CardGraph(value); let calls = 0;
  Object.defineProperty(Object.prototype, key, { set() { calls++; }, configurable: true });
  let exported: any;
  try { exported = graph.export(graph.root); } finally { delete (Object.prototype as any)[key]; graph.close(); }
  assert.equal(calls, 0); assert.equal(exported.self, exported); assert.equal(exported.array, exported.alias);
  assert.equal(Object.hasOwn(exported.array, 0), false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(exported, '__proto__')?.value, { n: 1 });
  assert.equal(exported[key], 2); assert.equal(exported.array[key], 3);
});
test('native storage releases its world on close while detached exports remain readable', () => {
  const storage = plainCardStorage({ n: 1 }, structuredClone), detached = storage.export(storage.root);
  storage.close!(); assert.throws(() => storage.root, /Closed card storage/); assert.deepEqual(detached, { n: 1 });
});
const definition: CardDefinition<State, State, { choose: { input: State; output: State } }, State> = {
  id: 'boundary-test', schemas: { setup: z.object({ n: z.number() }), result: z.object({ n: z.number() }), ports: { choose: { input: z.object({ n: z.number() }), output: z.object({ n: z.number() }) } } },
  initialize: setup => setup, entry: 'main', effects: [{ id: 'main', steps: [c.request<State>(s => ({ port: 'choose', input: s.state }), 'reply'), c.return<State>(s => s.locals.reply)] }],
};
test('native cloning parser path preserves comparison baseline and host isolation', async () => {
  const setup = { n: 1 };
  const bad = { ...definition, schemas: { ...definition.schemas, setup: { parse(value: any) { value.n++; return value; } } as any } };
  const rejected: any = unwrap(await createCardLoader().load(bad)); assert.equal((await rejected.core.start(setup)).ok, false); assert.deepEqual(setup, { n: 1 });
  let retained: any;
  const capturing = { ...definition, schemas: { ...definition.schemas, ports: { choose: { ...definition.schemas.ports.choose, output: { parse(value: any) { retained = value; return value; } } as any } } } };
  const loaded: any = unwrap(await createCardLoader().load(capturing)), instance = unwrap(await loaded.core.start(setup));
  const reply = { n: 3 }; unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value: reply }) })); unwrap(await instance.run());
  retained.n = 99; reply.n = 88; setup.n = 77; assert.deepEqual(unwrap(await instance.inspect()), { kind: 'done', result: { n: 3 } }); await instance.close();
});
test('accessor parser results are rejected without invoking getters and leave the request pending', async () => {
  let invoked = 0;
  const bad = { ...definition, schemas: { ...definition.schemas, ports: { choose: { ...definition.schemas.ports.choose, output: { parse() { return Object.defineProperty({}, 'n', { enumerable: true, get() { invoked++; return 1; } }); } } as any } } } };
  const loaded: any = unwrap(await createCardLoader().load(bad)), instance = unwrap(await loaded.core.start({ n: 1 })), before = unwrap(await instance.inspect());
  unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value: { n: 1 } }) })); assert.equal(unwrap(await instance.run()).pause, 'invalid_reply');
  assert.equal(invoked, 0); assert.deepEqual(unwrap(await instance.inspect()), before); await instance.close();
});

test('initialization failure becomes a recorded fault and invalid setup remains a rejection', async () => {
  const bad = { ...definition, initialize(): State { throw Error('initialization failed'); } };
  const loaded: any = unwrap(await createCardLoader().load(bad));
  assert.equal((await loaded.core.start({ n: 'wrong' })).ok, false);
  const instance = unwrap(await loaded.core.start({ n: 1 })), stop = unwrap(await instance.inspect());
  assert.equal(stop.kind, 'fault'); assert.equal(stop.error.code, 'program_failed');
  const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 100 })).records; assert.deepEqual(records.map((r: any) => r.kind), ['started', 'faulted']);
  assert.equal((await loaded.persistence.save(instance)).ok, false); await instance.close();
});

test('reusing a mutated host reply creates a fresh input without modifying the previous local', () => {
  const d = { ...definition, effects: [{ id: 'main', steps: [c.request<State>(s => ({ port: 'choose', input: s.state }), 'a'), c.request<State>(s => ({ port: 'choose', input: s.state }), 'b'), c.return<State>(s => [s.locals.a.n, s.locals.b.n])] }] };
  const p = new CardProgram(d);
  for (const controlled of [false, true]) {
    const root = p.initial({ n: 0 }), storage = controlled ? new CardGraph(root) : plainCardStorage(root, structuredClone), machine = new CardMachine(p, storage);
    machine.advance(); const input = { n: 3 }; machine.advance(input); input.n = 7;
    assert.deepEqual(machine.advance(input), { kind: 'done', result: [3, 7] });
  }
});

test('sharing owned stop/record payloads never exposes mutable aliases through protocol reads', async () => {
  const loaded: any = unwrap(await createCardLoader().load(definition)), source = { n: 1 }, instance = unwrap(await loaded.core.start(source));
  const inspected = unwrap(await instance.inspect()), captured = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 100 }));
  inspected.call.input.n = 9; captured.records[1].call.input.n = 8; source.n = 7;
  assert.equal(unwrap(await instance.inspect()).call.input.n, 1); assert.equal(unwrap(await loaded.capture.read(instance.id, { after: null, limit: 100 })).records[1].call.input.n, 1);
  unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value: { n: 3 } }) })); const result = unwrap(await instance.run()); result.state.result.n = 6;
  assert.deepEqual(unwrap(await instance.inspect()), { kind: 'done', result: { n: 3 } });
  const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 100 })).records; assert.equal(records.at(-1).result.n, 3); await instance.close();
});
