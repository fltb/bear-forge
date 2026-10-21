import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardGraph, privateCardGraph } from '../src/graph.ts';

test('private leaf publications use row-local caches without global weak-table writes', () => {
  const graph = privateCardGraph({ leaf: { n: 1, exportCache: 7 }, hidden: Array.from({ length: 4096 }, (_, n) => ({ n })) });
  const set = WeakMap.prototype.set;
  let effects = 0;
  Object.defineProperty(Object.prototype, 'exportCache', { get() { effects++; throw Error('inherited cache read'); }, set() { effects++; }, configurable: true });
  WeakMap.prototype.set = function (key, value) {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'dense') && Object.hasOwn(value, 'value')) throw Error('global leaf cache write');
    return set.call(this, key, value);
  };
  let child: CardGraph<any> | undefined;
  try {
    const first = graph.export(graph.root), repeated = graph.export(graph.root);
    assert.equal(first.leaf, repeated.leaf); assert.equal(first.leaf.exportCache, 7);
    assert.deepEqual(Object.keys(first.leaf), ['n', 'exportCache']);
    child = graph.fork(); child.root.leaf.n = 2;
    assert.equal(child.export(child.root).leaf.n, 2); assert.equal(first.leaf.n, 1);
    assert.equal(graph.export(graph.root).leaf, first.leaf);
    assert.equal(effects, 0);
  } finally {
    WeakMap.prototype.set = set; delete (Object.prototype as any).exportCache;
    graph.close(); child?.close();
  }
});

test('source identity tables end after complete imports and IO while managed aliases survive', () => {
  const set = WeakMap.prototype.set, tables: WeakMap<object, unknown>[] = [];
  WeakMap.prototype.set = function (key, value) {
    if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.ref === 'number') tables.push(this);
    return set.call(this, key, value);
  };
  let graph: CardGraph<any> | undefined, child: CardGraph<any> | undefined;
  try {
    const leaf = { n: 1 }, source: any = { one: leaf, two: leaf }; source.self = source;
    graph = new CardGraph(source);
    const initialTable = tables[0]; assert.ok(initialTable);
    assert.equal(graph.root.one, graph.root.two); assert.equal(graph.root.self, graph.root);
    tables.length = 0;
    const local = { n: 2 }; graph.root.left = local; graph.root.right = local;
    const activeTable = tables[0]; assert.ok(activeTable); assert.notEqual(activeTable, initialTable);
    assert.equal(graph.root.left, graph.root.right);
    graph.boundary(); tables.length = 0;
    graph.root.last = { n: 3 };
    assert.ok(tables[0]); assert.notEqual(tables[0], activeTable);
    assert.equal(graph.root.left, graph.root.right); assert.equal(graph.root.self, graph.root);
    child = graph.fork(); child.root.one.n = 4; child.boundary();
    assert.equal(child.root.one, child.root.two); assert.equal(graph.root.one.n, 1);
    assert.equal(child.root.one.n, 4);
    const restored = new CardGraph(graph.export(graph.root));
    assert.equal(restored.root.one, restored.root.two); assert.equal(restored.root.self, restored.root);
    restored.close();
  } finally { WeakMap.prototype.set = set; graph?.close(); child?.close(); }
});

test('temporary child allocations do not advance the parent identity range', () => {
  const graph = new CardGraph<any>({ item: { n: 1 } });
  const identity = (value: CardGraph<any>): { next: number; originals: WeakMap<object, {ref:number}> } => (value as any).identity;
  const before = identity(graph).next;
  for (let i = 0; i < 20; i++) {
    const child = graph.fork();
    assert.notEqual(identity(child), identity(graph));
    child.root.extra = Array.from({ length: 64 }, (_, n) => ({ n }));
    child.root.item.n = 2;
    assert.equal(identity(graph).next, before); assert.equal(graph.root.item.n, 1);
    child.close();
  }
  const sibling = graph.fork(); graph.root.last = { n: 3 }; sibling.root.last = { n: 4 };
  assert.equal(identity(graph).next, before + 1); assert.equal(identity(sibling).next, before + 1);
  assert.equal(graph.root.last.n, 3); assert.equal(sibling.root.last.n, 4);
  graph.close(); sibling.close();
});
