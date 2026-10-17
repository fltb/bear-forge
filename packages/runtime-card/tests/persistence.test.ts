import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serialize, deserialize } from 'node:v8';
import { createCardLoader, fileSnapshotStore, memorySnapshotStore } from '../src/index.ts';
import { definition } from './fixtures/nested.ts';
import { CardGraph } from '../src/graph.ts';
import { z } from 'zod';
import { card as c } from '@bear-forge/card-engine';
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };

test('new process restores real waiting locals/aliases and continues without initialization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-card-restore-'));
  try {
    const loaded: any = unwrap(await createCardLoader({ snapshots: fileSnapshotStore(directory) }).load(definition));
    const instance = unwrap(await loaded.core.start(1)); unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value: 2 }) })); unwrap(await instance.run());
    const saved = unwrap(await loaded.persistence.save(instance)); await instance.close(); await loaded.capture.release(instance.id);
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import {createCardLoader,fileSnapshotStore} from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
      import {definition} from ${JSON.stringify(new URL('./fixtures/nested.ts', import.meta.url).href)};
      const u=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value};
      const definitionWithoutInit={...definition,initialize(){throw Error('restore reinitialized')}};
      const loaded=u(await createCardLoader({snapshots:fileSnapshotStore(process.argv[1])}).load(definitionWithoutInit));
      const instance=u(await loaded.persistence.restore(JSON.parse(process.argv[2])));
      u(await instance.bind({choose:async()=>({kind:'reply',value:4})}));u(await instance.run());
      process.stdout.write(JSON.stringify(u(await instance.inspect())));
      await instance.close();`, directory, JSON.stringify(saved)]);
    const result = JSON.parse(stdout); assert.equal(result.kind, 'done'); assert.equal(result.result.sum, 13); assert.deepEqual(result.result.seen, [9, 5]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt positions, pending targets and wrong rule identities are rejected before execution', async () => {
  const store = memorySnapshotStore(), loaded: any = unwrap(await createCardLoader({ snapshots: store }).load(definition)); const instance = unwrap(await loaded.core.start(1));
  const snapshot = unwrap(await loaded.persistence.save(instance)), bytes = await store.get(snapshot.snapshotId);
  for (const corrupt of [(x: any) => { x.root.frames[0].index = -1; }, (x: any) => { x.root.waiting.frame = 123; }, (x: any) => { x.rule = 'wrong'; },
    (x: any) => { x.state.callId = 'invalid'; },
    // Consistency of two equally corrupted graphs is not schema validity.
    (x: any) => { x.root.stop.call.input = 'invalid'; x.state.call.input = 'invalid'; }
  ]) {
    const data = deserialize(bytes!); corrupt(data); await store.put(snapshot.snapshotId, serialize(data)); assert.equal((await loaded.persistence.restore(snapshot)).ok, false);
  }
  await instance.close();
});

test('restore rejects a schema-invalid result even when root and host stop agree', async () => {
  const { project: _project, ...source } = definition;
  const store = memorySnapshotStore(), typed = { ...source, id: 'typed-terminal', entry: 'main',
    schemas: { ...definition.schemas, result: z.number() },
    effects: [{ id: 'main', steps: [c.return<ReturnType<typeof definition.initialize>>(s => s.state.sum)] }]
  };
  const loaded: any = unwrap(await createCardLoader({ snapshots: store }).load(typed)), instance = unwrap(await loaded.core.start(1));
  const snapshot = unwrap(await loaded.persistence.save(instance)), data = deserialize((await store.get(snapshot.snapshotId))!);
  data.root.stop.result = 'invalid'; data.state.result = 'invalid';
  await store.put(snapshot.snapshotId, serialize(data));
  assert.equal((await loaded.persistence.restore(snapshot)).ok, false);
  await instance.close(); await loaded.capture.release(instance.id);
});

test('unreachable short-lived graph data is reclaimed; collection does not mutate a sibling', () => {
  const graph = new CardGraph<any>({ current: null, stable: { value: 7 } });
  for (let i = 0; i < 3000; i++) graph.root.current = { i, nested: [i] };
  const child = graph.fork(), previous = graph.nodeCount;
  graph.collect(); assert.ok(graph.nodeCount < 10); assert.equal(child.nodeCount, previous); assert.equal(child.root.current.i, 2999);
  assert.equal(graph.root.stable.value, 7); child.root.stable.value = 9; assert.equal(graph.root.stable.value, 7);
  graph.close(); child.collect(); assert.ok(child.nodeCount < 10); assert.equal(child.root.stable.value, 9);
});

test('large-state fork and first local write do not export, enumerate or collect the graph', () => {
  const graph = new CardGraph<any>({ data: Array.from({ length: 20000 }, (_, n) => ({ n })), local: { value: 0 } });
  graph.export = () => { throw Error('full export'); }; graph.collect = () => { throw Error('full collection'); };
  const child = graph.fork(); child.export = () => { throw Error('full export'); }; child.collect = () => { throw Error('full collection'); };
  child.root.local.value = 3; child.boundary(); graph.root.local.value = 4; graph.boundary();
  assert.equal(child.root.local.value, 3); assert.equal(graph.root.local.value, 4);
  graph.close(); assert.equal(child.root.data[19999].n, 19999); child.close();
});

test('public Instance fork does not re-export a large pending view through its adapter', async () => {
  type World = { values: { n: number }[] };
  const d = { id: 'large-pending', schemas: { setup: z.null(), result: z.any(), ports: { choose: { input: z.any(), output: z.number() } } }, initialize: () => ({ values: Array.from({ length: 20000 }, (_, n) => ({ n })) }), entry: 'main', effects: [{ id: 'main', steps: [c.request<World>(s => ({ port: 'choose', input: s.state })), c.return<World>(() => null)] }] };
  const loaded: any = unwrap(await createCardLoader().load(d)), parent = unwrap(await loaded.core.start(null));
  const original = CardGraph.prototype.export;
  try {
    CardGraph.prototype.export = () => { throw Error('fork re-exported the graph'); };
    const child = unwrap(await parent.fork()); assert.notEqual(child.id, parent.id); await child.close();
  } finally { CardGraph.prototype.export = original; await parent.close(); }
});
