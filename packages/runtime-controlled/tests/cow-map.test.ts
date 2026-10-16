import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CowMap, CowCollections} from '../src/cow-map.ts';

test('persistent collection keys match Map without invoking author conversion', () => {
  const object = {valueOf() {throw Error('coercion');}, toString() {throw Error('coercion');}};
  const keys = [undefined, null, true, false, -0, 0, NaN, Infinity, -Infinity, 3, 3n, '3', '', Symbol('x'), Symbol('x'), Symbol.for('x'), object, {}, () => {}];
  const actual = new CowMap<unknown>(), expected = new Map<unknown, unknown>();
  for (const [i, key] of keys.entries()) {actual.set(key, i); expected.set(key, i);}
  assert.deepEqual([...actual.entries()], [...expected]);
  for (const key of keys) {assert.equal(actual.get(key), expected.get(key)); assert.equal(actual.has(key), true);}
  for (const key of keys.slice().reverse()) {
    assert.equal(actual.delete(key), expected.delete(key));
    assert.deepEqual([...actual.entries()], [...expected]);
  }
});

test('persistent collection updates preserve AVL bounds and parent/sibling roots', () => {
  const parent = new CowMap<number>();
  for (let i = 0; i < 10000; i++) parent.set(i, i);
  const child = parent.fork(), sibling = parent.fork(), sharedRoot = (parent as any).root;
  assert.strictEqual((child as any).root, sharedRoot);
  child.set(-1, -1);
  assert.strictEqual((child as any).root.right, sharedRoot.right);
  const expected = new Map(parent.entries()); let seed = 89;
  for (let i = 0; i < 5000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const key = seed % 12000;
    if (i % 3) {parent.set(key, i); expected.set(key, i);}
    else assert.equal(parent.delete(key), expected.delete(key));
  }
  assert.deepEqual([...parent.entries()], [...expected]);
  function verify(node: any): number {
    if (!node) return 0;
    const left = verify(node.left), right = verify(node.right);
    assert.ok(Math.abs(left - right) <= 1);
    assert.equal(node.height, 1 + Math.max(left, right));
    return node.height;
  }
  assert.ok(verify((parent as any).root) < 20);
  assert.equal(sibling.size, 10000); assert.equal(sibling.get(-1), undefined);
  assert.equal(child.get(9999), 9999);
});

test('collection cursors observe delete, reinsertion and clear without scanning old history', () => {
  const map = new CowMap<number>(); map.set('a', 1).set('b', 2).set('c', 3);
  const first = map.next(0)!; assert.equal(first.key, 'a');
  const child = map.fork();
  child.delete('b'); child.set('a', 10); child.set('b', 20);
  assert.deepEqual(child.next(first.cursor), {key: 'c', value: 3, cursor: 3});
  assert.deepEqual(child.next(3), {key: 'b', value: 20, cursor: 4});
  assert.equal(map.next(first.cursor)!.key, 'b');
  child.clear(); child.set('new', 4);
  assert.deepEqual(child.next(first.cursor), {key: 'new', value: 4, cursor: 5});
  assert.equal(child.next(5), undefined);
  assert.equal(map.size, 3);
});

test('collection restore retains insertion gaps and rejects invalid state atomically', () => {
  const map = new CowMap<number>(); map.set('a', 1).set('b', 2).set('c', 3);
  map.delete('b'); map.set('b', 4);
  const saved = map.snapshot(), restored = new CowMap<number>();
  restored.restore(saved.entries, saved.sequence);
  assert.deepEqual(restored.snapshot(), saved);
  for (const cursor of [0, 1, 2, 3, 4]) assert.deepEqual(restored.next(cursor), map.next(cursor));
  const invalid: [number, unknown, number][][] = [
    [[1, 'x', 1], [1, 'y', 2]], [[2, 'x', 1], [1, 'y', 2]], [[0, 'x', 1], [1, 'x', 2]], [[4, 'x', 1]], [[-1, 'x', 1]],
  ];
  for (const entries of invalid) {
    assert.throws(() => restored.restore(entries, 4), TypeError);
    assert.deepEqual(restored.snapshot(), saved);
  }
});

test('collection lookup charges indexed work and budget failures do not partially edit roots', () => {
  const map = new CowMap<number>();
  for (let index = 0; index < 10000; index++) map.set(index, index);
  let charges = 0;
  assert.equal(map.get(9999, () => charges++), 9999);
  assert.ok(charges > 1 && charges < 20);
  const saved = map.snapshot();
  for (const action of [(tick: () => void) => map.set(-1, 1, tick), (tick: () => void) => map.delete(0, tick)]) {
    let remaining = 2;
    assert.throws(() => action(() => {if (!remaining--) throw Error('budget');}), /budget/);
    assert.deepEqual(map.snapshot(), saved);
  }
  const strings = new CowMap<number>(), prefix = 'x'.repeat(8192);
  strings.set(prefix + 'a', 1); charges = 0;
  strings.get(prefix + 'b', () => charges++);
  assert.ok(charges >= 9);
});

test('collection admission releases native keys only after success and rejects foreign branch identities', () => {
  const key = {}, value = {}, native = new Map([[key, value], ['second', value]]);
  const parent = new CowCollections();
  let remaining = 1;
  assert.throws(() => parent.data(native, true, false, () => {if (!remaining--) throw Error('budget');}), /budget/);
  assert.equal(native.size, 2); assert.strictEqual(native.get(key), value);
  const data = parent.data(native, true);
  assert.equal(native.size, 0); assert.strictEqual(data.get(key), value);
  const child = parent.fork();
  child.data(native, true, true).delete(key);
  assert.strictEqual(parent.data(native, true).get(key), value);
  assert.equal(child.data(native, true).has(key), false);
  const local = new Set([key]); child.data(local, false);
  assert.equal(local.size, 0);
  assert.throws(() => parent.data(local, false), /does not belong/);
});
