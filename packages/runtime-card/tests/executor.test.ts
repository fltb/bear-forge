import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { serialize, deserialize } from 'node:v8';
import { card as c, CardProgram, CardMachine, plainCardStorage } from '@bear-forge/card-engine';
import type { CardDefinition } from '@bear-forge/card-engine';
import { createCardLoader, readCardTrace, memorySnapshotStore } from '../src/index.ts';
import { CardGraph } from '../src/graph.ts';
const unwrap = <T>(value: { ok: true; value: T } | { ok: false; error: unknown }): T => { assert.equal(value.ok, true, JSON.stringify(value)); if (!value.ok) throw Error('failed'); return value.value; };
import {definition} from './fixtures/nested.ts';
type World = ReturnType<typeof definition.initialize>;

test('local result slots are data keys, including __proto__, constructor and toString', () => {
  const d = { ...definition, entry: 'main', effects: [
    { id: 'main', steps: [c.operation<World>(() => 3, '__proto__'), c.invoke<World>('child', () => 4, 'constructor'), c.request<World>(() => ({ port: 'choose', input: 1 }), 'toString'), c.return<World>(s => [s.locals.__proto__, s.locals.constructor, s.locals.toString])] },
    { id: 'child', steps: [c.operation<World>(s => s.input, '__proto__'), c.return<World>(s => s.locals.__proto__)] },
  ] };
  for (const controlled of [false, true]) {
    const program = new CardProgram(d), root = program.initial(1), storage = controlled ? new CardGraph(root) : plainCardStorage(root, structuredClone), machine = new CardMachine(program, storage);
    assert.equal(machine.advance().kind, 'call'); assert.deepEqual(machine.advance(5), { kind: 'done', result: [3, 4, 5] }); storage.close?.();
  }
});

test('captured aliases stay isolated and restore rejects altered alias relationships even when all fields are equal', async () => {
  const d = { id: 'alias-record', schemas: { setup: z.null(), result: z.any(), ports: { choose: { input: z.any(), output: z.null() } } }, initialize: () => ({ n: 1 }), entry: 'main', effects: [{ id: 'main', steps: [c.request<{ n: number }>(s => ({ port: 'choose', input: { a: s.state, b: s.state } })), c.return<{ n: number }>(s => ({ a: s.state, b: s.state }))] }] };
  for (const controlled of [false, true]) {
    const store = memorySnapshotStore(), loaded: any = unwrap(await createCardLoader({ controlled, recordCore: true, snapshots: store }).load(d)), instance = unwrap<any>(await loaded.core.start(null));
    const snapshot = controlled ? unwrap<any>(await loaded.persistence.save(instance)) : null;
    unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value: null }) })); unwrap(await instance.run());
    const records: any[] = unwrap<any>(await loaded.capture.read(instance.id, { after: null, limit: 100 })).records;
    assert.equal(records[1].call.input.a,records[1].call.input.b);
    assert.equal(records.at(-1).result.a,records.at(-1).result.b);
    records[1].call.input.b = structuredClone(records[1].call.input.b);
    records.at(-1).result.b = structuredClone(records.at(-1).result.b);
    const fresh=unwrap<any>(await loaded.capture.read(instance.id,{after:null,limit:100})).records;
    assert.equal(fresh[1].call.input.a,fresh[1].call.input.b);
    assert.equal(fresh.at(-1).result.a,fresh.at(-1).result.b);
    if(controlled){
      const terminal=unwrap<any>(await loaded.persistence.save(instance));
      const data=deserialize((await store.get(terminal.snapshotId))!);
      data.state.result.b=structuredClone(data.state.result.b);
      await store.put(terminal.snapshotId,serialize(data));
      assert.equal((await loaded.persistence.restore(terminal)).ok,false);
      unwrap(await loaded.persistence.release(terminal));
    }
    if (snapshot) {
      const data = deserialize((await store.get(snapshot.snapshotId))!); data.state.call.input.b = structuredClone(data.state.call.input.b);
      await store.put(snapshot.snapshotId, serialize(data)); assert.equal((await loaded.persistence.restore(snapshot)).ok, false);
    }
    await instance.close(); await loaded.capture.release(instance.id);
  }
});

test('same synchronous definitions run natively and with isolated graph state and identical trace', () => {
  const p = new CardProgram(definition), traces: unknown[][] = [], results: unknown[] = [];
  for (const controlled of [false, true]) {
    const root = p.initial(1), storage = controlled ? new CardGraph(root) : plainCardStorage(root), trace: unknown[] = [];
    const machine = new CardMachine(p, storage, event => trace.push(event));
    assert.deepEqual(machine.advance(), { kind: 'call', call: { port: 'choose', input: 1 } });
    assert.deepEqual(machine.advance(2), { kind: 'call', call: { port: 'choose', input: 5 } });
    results.push(machine.advance(4)); traces.push(trace);
  }
  assert.deepEqual(results[0], results[1]); assert.deepEqual(traces[0], traces[1]);
  assert.deepEqual((results[0] as any).result, { sum: 13, rounds: 2, items: [{ n: 9 }, { n: 5 }, { n: 99 }, { n: 99 }], seen: [9, 5] });
});

test('COW graph preserves cycles/aliases/holes and separates large arrays by bounded pages', () => {
  const shared = { n: 1 }, data: any = { a: shared, b: shared, array: Array(10000), self: null }; data.self = data; data.array[9999] = shared;
  const parent = new CardGraph(data), child = parent.fork();
  assert.strictEqual(child.root.a, child.root.b); assert.strictEqual(child.root.self, child.root);
  child.root.a.n = 8; child.root.array.push(child.root.a); delete child.root.array[9999];
  assert.equal(parent.root.a.n, 1); assert.equal(parent.root.array.length, 10000); assert.equal(child.root.array.length, 10001);
  assert.equal(9999 in child.root.array, false); assert.equal(9999 in parent.root.array, true);
  const exported = child.export(child.root); assert.strictEqual(exported.a, exported.b); assert.strictEqual(exported.self, exported); assert.strictEqual(exported.array[10000], exported.a);
  assert.throws(() => child.root.array.push(parent.root.a), /Foreign/);
  parent.close(); assert.equal(child.root.a.n, 8); child.close();
});

test('Instance boundaries, invalid replies, fork/restore, records and transfer preserve semantics', async () => {
  const store = memorySnapshotStore(), loaded = unwrap(await createCardLoader({ snapshots: store }).load(definition));
  let parent = unwrap(await loaded.core.start(1)); const first = unwrap(await parent.inspect()); assert.equal(first.kind, 'call');
  unwrap(await parent.bind({ choose: async () => ({ kind: 'reply', value: 'bad' as any }) }));
  assert.equal(unwrap(await parent.run()).pause, 'invalid_reply'); assert.deepEqual(unwrap(await parent.inspect()), first);
  const snapshot = unwrap(await loaded.persistence!.save(parent));
  const prefix = unwrap(readCardTrace(loaded, parent.id)); assert.ok(prefix.length);
  const child = unwrap(await parent.fork!()); const restored = unwrap(await loaded.persistence!.restore(snapshot));
  assert.deepEqual(unwrap(readCardTrace(loaded, child.id)), prefix); assert.deepEqual(unwrap(readCardTrace(loaded, restored.id)), prefix);
  assert.notEqual(parent.id, child.id); assert.notEqual(parent.id, restored.id);
  assert.deepEqual(unwrap(await restored.inspect()), first);
  assert.equal(unwrap(await child.run()).pause, 'unbound');
  const old = parent; parent = unwrap(await parent.transfer()); assert.equal(parent.id, old.id); assert.equal((await old.inspect()).ok, false);
  unwrap(await parent.close());
  for (const [instance, replies] of [[child, [2, 4]], [restored, [3, 7]]] as const) {
    for (const value of replies) { unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value }) })); assert.equal(unwrap(await instance.run()).accepted, true); }
    const result = unwrap(await instance.inspect()); assert.equal(result.kind, 'done');
    const records = unwrap(await loaded.capture!.read(instance.id, { after: null, limit: 1000 })).records;
    const coreTrace = unwrap(readCardTrace(loaded, instance.id));
    assert.deepEqual(records.filter(row=>row.kind==='returned').map(row=>row.reply.output),replies);
    const called=records.filter(row=>row.kind==='called');
    assert.equal(new Set(called.map(row=>row.callId)).size,called.length);
    const completed=records.at(-1);assert.equal(completed?.kind,'completed');
    if(completed?.kind!=='completed'||result.kind!=='done')throw Error('Missing original completion');
    assert.deepEqual(completed.result,result.result);
    assert.deepEqual(coreTrace.slice(0,prefix.length),prefix);
    assert.ok(coreTrace.length>prefix.length);
    completed.result.sum++;
    const unchanged=unwrap(await instance.inspect());
    assert.equal(unchanged.kind,'done');if(unchanged.kind==='done')assert.deepEqual(unchanged.result,result.result);
    unwrap(await instance.close()); unwrap(await loaded.capture!.release(instance.id));
  }
  const incompatible = unwrap(await createCardLoader({ snapshots: store }).load({ ...definition, id: 'test/other' })); assert.equal((await incompatible.persistence!.restore(snapshot)).ok, false);
  unwrap(await loaded.persistence!.release(snapshot)); assert.equal((await loaded.persistence!.restore(snapshot)).ok, false);
});

test('return unwinds nested blocks, budget fault cannot save, and async operations are rejected', async () => {
  const looping = { ...definition, id: 'loop', effects: [{ id: 'root', steps: [c.repeat<World>(() => true, [])] }] };
  const loaded = unwrap(await createCardLoader({ stepBudget: 10 }).load(looping)); const instance = unwrap(await loaded.core.start(1));
  const stop = unwrap(await instance.inspect()); assert.equal(stop.kind, 'fault'); if (stop.kind === 'fault') assert.equal(stop.error.code, 'budget_exceeded');
  assert.equal((await loaded.persistence!.save(instance)).ok, false); await instance.close();
  const early = new CardProgram({ ...definition, effects: [{ id: 'root', steps: [c.repeat<World>(() => true, [c.branch<World>(() => true, [c.return<World>(() => 42)])])] }] });
  const machine = new CardMachine(early, plainCardStorage(early.initial(1))); assert.deepEqual(machine.advance(), { kind: 'done', result: 42 });
  const asyncProgram = new CardProgram({ ...definition, effects: [{ id: 'root', steps: [c.operation<World>(async () => 1)] }] });
  assert.equal(new CardMachine(asyncProgram, plainCardStorage(asyncProgram.initial(1))).advance().kind, 'fault');
});

test('native mode has the same external protocol without persistence or fork', async () => {
  const loaded = unwrap(await createCardLoader({ controlled: false }).load(definition)); const instance = unwrap(await loaded.core.start(1));
  assert.equal(loaded.persistence, undefined); assert.equal(instance.fork, undefined); assert.equal(unwrap(await instance.inspect()).kind, 'call'); await instance.close();
});

test('diagnostic observer mutation or failure cannot corrupt core records or execution', async () => {
  const loaded = unwrap(await createCardLoader({ trace(event) { event.effect = 'corrupted'; throw Error('observer'); } }).load(definition));
  const instance = unwrap(await loaded.core.start(1));
  assert.equal(unwrap(await instance.inspect()).kind, 'call'); assert.ok(unwrap(readCardTrace(loaded, instance.id)).every(event => event.effect !== 'corrupted'));
  for (const value of [2, 4]) { unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value }) })); unwrap(await instance.run()); }
  const records = unwrap(await loaded.capture!.read(instance.id, { after: null, limit: 1000 })).records, coreTrace = unwrap(readCardTrace(loaded, instance.id));
  assert.ok(coreTrace.every(event=>event.effect!=='corrupted'));
  assert.deepEqual(records.filter(row=>row.kind==='returned').map(row=>row.reply.output),[2,4]);
  const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind==='done')assert.equal(done.result.sum,13);
  await instance.close();await loaded.capture!.release(instance.id);
});

test('loader snapshots store compact trace data and reject corrupted trace positions',async()=>{
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({snapshots:store}).load(definition));
  const instance=unwrap(await loaded.core.start(1)),snapshot=unwrap(await loaded.persistence!.save(instance));
  const original=(await store.get(snapshot.snapshotId))!,data=deserialize(original);
  assert.deepEqual(Object.keys(data.core),['positions','depths']);
  assert.equal(data.core.positions.length,unwrap(readCardTrace(loaded,instance.id)).length);
  for(const corrupt of [()=>{data.core.positions[0]=-1;},()=>{data.core.depths.pop();}]){
    data.core=deserialize(original).core;corrupt();await store.put(snapshot.snapshotId,serialize(data));
    assert.equal((await loaded.persistence!.restore(snapshot)).ok,false);
  }
  await store.put(snapshot.snapshotId,original);
  const restored=unwrap(await loaded.persistence!.restore(snapshot));
  assert.deepEqual(unwrap(readCardTrace(loaded,restored.id)),unwrap(readCardTrace(loaded,instance.id)));
  await instance.close();await restored.close();await loaded.persistence!.release(snapshot);
});
