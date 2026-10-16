import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CowStore} from '../src/cow-store.ts';

test('COW state roots isolate parent, siblings and descendants without cloning payloads on fork', () => {
  const parent = new CowStore<{n: number; link: object}>();
  const link = {};
  for (let key = 0; key < 10000; key++) parent.set(key, {n: key, link});
  const child = parent.fork(), sibling = parent.fork(), descendant = child.fork();
  assert.strictEqual((parent as any).root, (descendant as any).root);
  let clones = 0;
  const clone = (value: {n: number; link: object}) => { clones++; return {...value}; };
  parent.edit(5, clone).n = -1;
  child.edit(5, clone).n = -2;
  child.edit(5, clone).n--;
  assert.equal(clones, 2, 'one payload copy per writing branch, no repeated copy');
  assert.equal(parent.get(5)!.n, -1);
  assert.equal(child.get(5)!.n, -3);
  assert.equal(sibling.get(5)!.n, 5);
  assert.equal(descendant.get(5)!.n, 5);
  assert.strictEqual(child.get(5)!.link, link, 'identity links are not recursively cloned');
  assert.strictEqual(parent.get(9999), child.get(9999), 'untouched payloads stay shared');
  const root = (child as any).root;
  assert.strictEqual(root.slots[1], (sibling as any).root.slots[1], 'untouched index paths stay shared');
  parent.clear(); child.clear(); sibling.clear();
  assert.equal(descendant.size, 10000);
  assert.equal(descendant.get(5)!.n, 5);
});

test('deep branching keeps bounded lookup depth and releases deleted payload references', () => {
  let store = new CowStore<number>();
  store.set(Number.MAX_SAFE_INTEGER, 42);
  store.set(0, 0);
  for (let depth = 0; depth < 20000; depth++) {
    store = store.fork();
    store.set(0, depth);
  }
  assert.equal((store as any).height, 10);
  assert.equal(store.get(Number.MAX_SAFE_INTEGER), 42);
  assert.equal(store.get(0), 19999);
  assert.equal(store.delete(Number.MAX_SAFE_INTEGER), true);
  assert.equal(store.delete(Number.MAX_SAFE_INTEGER), false);
  assert.deepEqual([...store.entries()], [[0, 19999]]);
  assert.equal(store.delete(0), true);
  assert.equal((store as any).root, undefined);
  const sparse = new CowStore<number>();
  sparse.set(Number.MAX_SAFE_INTEGER, 1);
  sparse.delete(Number.MAX_SAFE_INTEGER);
  assert.equal((sparse as any).root, undefined);
});

test('randomized COW branch writes, deletion and enumeration match independent maps', () => {
  let random = 19;
  const next = () => random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  const stores = [new CowStore<number | undefined>()];
  const expected = [new Map<number, number | undefined>()];
  const keys = [0, 1, 31, 32, 1023, 1024, 2 ** 32 - 1, 2 ** 32, Number.MAX_SAFE_INTEGER];
  for (let step = 0; step < 3000; step++) {
    const index = next() % stores.length;
    const store = stores[index]!, reference = expected[index]!;
    const key = keys[next() % keys.length]!;
    switch (next() % 4) {
      case 0: {
        const value = next() % 3 ? next() : undefined;
        store.set(key, value); reference.set(key, value); break;
      }
      case 1: assert.equal(store.delete(key), reference.delete(key)); break;
      case 2:
        if (stores.length < 100) { stores.push(store.fork()); expected.push(new Map(reference)); }
        break;
      default: assert.equal(store.has(key), reference.has(key)); assert.equal(store.get(key), reference.get(key));
    }
    assert.equal(store.size, reference.size);
    assert.deepEqual([...store.entries()], [...reference].sort(([a], [b]) => a - b));
  }
  stores.forEach((store, index) => assert.deepEqual([...store.entries()], [...expected[index]!].sort(([a], [b]) => a - b)));
});

test('invalid identities and failing payload clones leave state unchanged', () => {
  const parent = new CowStore<{n: number}>();
  parent.set(3, {n: 1});
  const child = parent.fork();
  assert.throws(() => child.edit(3, () => {throw Error('clone failed');}), /clone failed/);
  assert.strictEqual(parent.get(3), child.get(3));
  for (const key of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => child.set(key, {n: 2}), RangeError);
    assert.throws(() => child.get(key), RangeError);
    assert.throws(() => child.delete(key), RangeError);
  }
  assert.equal(child.size, 1);
  assert.equal(parent.get(3)!.n, 1);
});

test('ordered traversal starts at a requested key across radix boundaries', () => {
  const store = new CowStore<number>();
  const keys = [0, 1, 31, 32, 33, 1023, 1024, 1025, 32767, 32768, 1000000, Number.MAX_SAFE_INTEGER];
  for (const key of keys) store.set(key, key);
  for (const minimum of [...keys, 2, 30, 34, 1022, 1026, 32766, 32769, 999999, Number.MAX_SAFE_INTEGER - 1]) {
    assert.deepEqual([...store.entries(minimum)].map(([key]) => key), keys.filter(key => key >= minimum));
  }
  assert.throws(() => [...store.entries(-1)], RangeError);
});

test('repeated writes reuse private entries but detach entries shared by a fork', () => {
  const parent=new CowStore<number>();
  parent.set(3,1);
  const first=(parent as any).root.slots[3];
  parent.set(3,2);
  assert.strictEqual((parent as any).root.slots[3],first);
  const child=parent.fork();
  parent.set(3,3);
  assert.notStrictEqual((parent as any).root.slots[3],first);
  assert.equal(child.get(3),2);
  child.set(3,4);
  const childEntry=(child as any).root.slots[3];
  assert.notStrictEqual(childEntry,first);
  for(let i=0;i<1000;i++)child.set(3,i);
  assert.strictEqual((child as any).root.slots[3],childEntry);
  assert.equal(parent.get(3),3);
  assert.equal(child.get(3),999);
  assert.equal(parent.size,1);
  assert.equal(child.size,1);
});


test('adjacent shared payloads including slot 31 and undefined retain independent edit ownership', () => {
  const parent = new CowStore<{n:number} | undefined>();
  for (const key of [0, 1, 30, 31, 32, 63]) parent.set(key, {n:key});
  parent.set(2, undefined);
  const child = parent.fork();
  let clones = 0;
  const clone = (value: {n:number} | undefined) => {clones++; return value && {...value};};
  for (const key of [0, 31, 1, 30, 63, 32]) {
    child.edit(key, clone)!.n = -key - 1;
    child.edit(key, clone)!.n--;
    assert.equal(parent.get(key)!.n, key);
  }
  assert.equal(clones, 6, 'copying a leaf does not grant ownership of neighboring payloads');
  assert.equal(child.edit(2, clone), undefined);
  assert.equal(child.edit(2, clone), undefined);
  assert.equal(clones, 7);
  assert.equal(child.has(2), true);
  assert.equal(child.delete(31), true);
  child.set(31, undefined);
  assert.equal(child.has(31), true);
  assert.deepEqual([...child.entries(31)], [[31,undefined],[32,{n:-34}],[63,{n:-65}]]);
  assert.equal(parent.get(31)!.n,31);
});
