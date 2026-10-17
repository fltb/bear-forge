import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { CardMachine, CardProgram, plainCardStorage } from '@bear-forge/card-engine';
import { createCardLoader, readCardTrace, replayCard } from '../src/index.ts';
import { definition } from './fixtures/nested.ts';
const unwrap = (result: any): any => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('ordinary native interaction constructs no record logs, COW graph or snapshot store', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, next) {
      const result = next(url, context);
      if (url.endsWith('/runtime/src/records.ts')) return { ...result, source: String(result.source).replace('export class Records<T> {', 'export class Records<T> { constructor() { throw Error("unused log constructed"); }') };
      if (url.endsWith('/runtime-card/src/store.ts')) return { ...result, source: String(result.source).replace('export function memorySnapshotStore(): SnapshotStore {', 'export function memorySnapshotStore(): SnapshotStore { throw Error("unused snapshot store constructed");') };
      if (url.endsWith('/runtime-card/src/graph.ts')) return { ...result, source: String(result.source).replace('constructor(value: T) {', 'constructor(value: T) { throw Error("unused COW graph constructed");') };
      return result;
    } });
    const { createCardLoader, readCardTrace } = await import(${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)});
    const { definition } = await import(${JSON.stringify(new URL('./fixtures/nested.ts', import.meta.url).href)});
    const u = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
    const loaded = u(await createCardLoader({ controlled: false }).load(definition));
    assert.equal(loaded.capture, undefined); assert.equal(loaded.persistence, undefined);
    const handle = u(await loaded.core.start(1));
    for (const value of [2, 4]) { u(await handle.bind({ choose: async () => ({ kind: 'reply', value }) })); assert.equal(u(await handle.run()).accepted, true); }
    assert.equal(u(await handle.inspect()).kind, 'done');
    assert.equal(readCardTrace(loaded, handle.id).ok, false);
    u(await handle.close()); assert.equal((await handle.inspect()).error.code, 'instance_closed');
    const { Records } = await import(${JSON.stringify(new URL('../../runtime/src/records.ts', import.meta.url).href)});
    const { CardGraph } = await import(${JSON.stringify(new URL('../src/graph.ts', import.meta.url).href)});
    const { memorySnapshotStore } = await import(${JSON.stringify(new URL('../src/store.ts', import.meta.url).href)});
    assert.throws(() => new Records(), /unused log constructed/);
    assert.throws(() => new CardGraph({}), /unused COW graph constructed/);
    assert.throws(() => memorySnapshotStore(), /unused snapshot store constructed/);
  `;
  execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], { stdio: 'pipe' });
});

test('native auditing is explicit and retains complete isolated external and core records', async () => {
  const loaded = unwrap(await createCardLoader({ controlled: false, recordCore: true }).load(definition));
  const instance = unwrap(await loaded.core.start(1));
  for (const value of [2, 4]) {
    unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value }) })); unwrap(await instance.run());
  }
  const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 100 })).records;
  assert.deepEqual(records.map((r: any) => r.kind), ['started', 'called', 'returned', 'called', 'returned', 'completed']);
  const coreTrace = unwrap(readCardTrace(loaded, instance.id)); assert.ok(coreTrace.length);
  assert.equal((await replayCard(definition, records, { controlled: false, coreTrace })).ok, true);
  const completed = records.at(-1); completed.result.sum = 999;
  assert.notEqual(unwrap(await instance.inspect()).result.sum, 999);
  unwrap(await instance.close()); unwrap(await loaded.capture.release(instance.id));
  assert.equal(readCardTrace(loaded, instance.id).ok, false);
});

test('native execution keeps no implicit step counter and honors an explicitly requested limit', async () => {
  const program = new CardProgram(definition), root = program.initial(1, Infinity);
  let budgetWrites = 0;
  Object.defineProperty(root, 'budget', { get: () => Infinity, set: () => { budgetWrites++; }, configurable: true });
  const machine = new CardMachine(program, plainCardStorage(root));
  machine.advance(); machine.advance(2); machine.advance(4); assert.equal(budgetWrites, 0);
  const loaded = unwrap(await createCardLoader({ controlled: false, stepBudget: 1 }).load(definition));
  const instance = unwrap(await loaded.core.start(1));
  assert.equal(unwrap(await instance.inspect()).error.code, 'budget_exceeded');
  assert.equal(loaded.capture, undefined); unwrap(await instance.close());
});
