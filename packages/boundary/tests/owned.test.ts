import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { copyOwned, readOwned, retainOwned, sameData, read, copy, isolatedParser, isOwnedTree, isDenseTree } from '../src/values.ts';

test('owned array delivery never consults an exotic prototype chain or inherited writes', () => {
  const baseline = readOwned(z.any(), { values: [1, 2], n: 3 });
  const original = Object.getPrototypeOf(Array.prototype); let effects = 0;
  const exotic = new Proxy(Object.create(null), {
    has() { effects++; throw Error('prototype queried'); },
    set() { effects++; throw Error('inherited write'); }
  });
  let delivered: typeof baseline;
  Object.setPrototypeOf(Array.prototype, exotic);
  try { delivered = copyOwned(baseline); }
  finally { Object.setPrototypeOf(Array.prototype, original); }
  assert.equal(effects, 0); assert.deepEqual(delivered!, baseline);
  delivered!.values[0] = 9; assert.equal(baseline.values[0], 1);
});

test('paired admission keeps root and sibling cycles separate from retained parser and source graphs', () => {
  const leaf: any = Object.assign(Object.create(null), { n: -0, big: 3n });
  const source: any = { left: leaf, right: leaf, sparse: new Array(5), tail: { leaf } };
  source.self = source; source.sparse[4] = source; leaf.parent = source.tail; source.tail.root = source;
  Object.defineProperty(source, '__proto__', { value: leaf, enumerable: true });
  let retained: any, calls = 0;
  const owned = readOwned({ parse(value: any) { retained = value; calls++; return value; } }, source);
  const expected = read(z.any(), source);
  assert.equal(sameData(owned, expected), true);
  assert.equal(owned.self, owned);
  assert.equal(owned.sparse[4], owned);
  assert.equal(owned.left, owned.right);
  assert.equal(owned.left.parent, owned.tail);
  assert.equal(owned.tail.root, owned);
  assert.equal(Object.hasOwn(owned.sparse, 0), false);
  assert.equal(Object.hasOwn(owned, '__proto__'), true);
  assert.notEqual(owned, retained); assert.notEqual(owned.left, retained.left);
  source.left.n = 7; retained.left.n = 8; retained.sparse[0] = retained;
  assert.equal(Object.is(owned.left.n, -0), true);
  assert.equal(Object.hasOwn(owned.sparse, 0), false);
  const delivered = copyOwned(owned); delivered.tail.leaf.n = 9;
  assert.equal(Object.is(owned.left.n, -0), true);
  assert.equal(calls, 1);
});

test('unknown paired admission does not invoke inherited index setters', () => {
  const source = { nested: { n: 1 }, items: [{ n: 2 }] };
  let setters = 0, result: typeof source;
  Object.defineProperty(Array.prototype, '0', { configurable: true, set() { setters++; } });
  try { result = readOwned({ parse: (value: any) => value }, source); }
  finally { delete (Array.prototype as any)['0']; }
  assert.equal(setters, 0);
  assert.deepEqual(result!, source);
  assert.notEqual(result!.nested, source.nested);
  assert.notEqual(result!.items[0], source.items[0]);
});

test('parser changes to enumeration cannot intercept private baseline keys or add inherited fields', () => {
  const original = readOwned(z.any(), { item: { n: -0 }, sparse: [, undefined] });
  const keys = Object.keys, inherited = '__privateBaselineEnumeration'; let intercepted = 0, getters = 0;
  let result: typeof original, delivered: typeof original;
  try {
    result = readOwned({ parse(value: any) {
      Object.keys = ((target: object) => {
        if (target === original || target === original.item || target === original.sparse) { intercepted++; throw Error('private baseline exposed'); }
        return keys(target);
      }) as typeof Object.keys;
      Object.defineProperty(Object.prototype, inherited, { configurable: true, enumerable: true, get() { getters++; throw Error('inherited getter evaluated'); } });
      return value;
    } }, original);
    delivered = copyOwned(result);
  } finally { Object.keys = keys; delete (Object.prototype as any)[inherited]; }
  assert.equal(result!, original); assert.equal(intercepted, 0); assert.equal(getters, 0);
  assert.deepEqual(delivered!, original); assert.notEqual(delivered!.item, original.item);
  assert.equal(Object.is(copyOwned(result!).item.n, -0), true);
  assert.equal(Object.hasOwn(copyOwned(result!).sparse, 0), false);
});

test('parser replacement cannot reuse an old isolation capability to expose the private baseline', () => {
  const schema = { parse: isolatedParser((value: any) => copy(value)) };
  const previous = readOwned(schema, { n: 1 });
  let retained: any;
  schema.parse = value => { retained = value; value.n++; return value; };
  const source = { n: 1 };
  assert.throws(() => readOwned(schema, source), /changed its input/);
  retained.n = 99;
  assert.deepEqual(copyOwned(previous), { n: 1 });
  assert.deepEqual(source, { n: 1 });
});

test('admission precedes a parse getter and its source mutations cannot change parser input', () => {
  const source = { n: 1 }; let getters = 0;
  const schema = { get parse() { getters++; source.n = 2; return (v: any) => v; } };
  assert.deepEqual(copyOwned(readOwned(schema, source)), { n: 1 });
  assert.equal(source.n, 2); assert.equal(getters, 1);
  assert.throws(() => readOwned(schema, { get n() { throw Error('must not run'); } }));
  assert.equal(getters, 1, 'invalid values must reject before reading parse');
});

test('dense private copying never consults array constructors, species, iterators or replacement methods', () => {
  const source = readOwned(z.any(), { items: [{ n: -0 }, NaN, undefined, 3n] });
  const constructor = Object.getOwnPropertyDescriptor(Array.prototype, 'constructor')!;
  const species = Object.getOwnPropertyDescriptor(Array, Symbol.species)!;
  const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  const splice = Object.getOwnPropertyDescriptor(Array.prototype, 'toSpliced')!;
  let calls = 0, result: typeof source;
  const forbidden = () => { calls++; throw Error('unexpected array hook'); };
  Object.defineProperty(Array.prototype, 'constructor', { get: forbidden, configurable: true });
  Object.defineProperty(Array, Symbol.species, { get: forbidden, configurable: true });
  Object.defineProperty(Array.prototype, Symbol.iterator, { value: forbidden, writable: true, configurable: true });
  Object.defineProperty(Array.prototype, 'toSpliced', { value: forbidden, writable: true, configurable: true });
  try { result = copyOwned(source); }
  finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
    Object.defineProperty(Array.prototype, 'constructor', constructor);
    Object.defineProperty(Array, Symbol.species, species);
    Object.defineProperty(Array.prototype, 'toSpliced', splice);
  }
  assert.equal(calls, 0); assert.deepEqual(result!, source);
  assert.notEqual(result!.items[0], source.items[0]);
});

test('owned parsers keep ordinary callback inputs and isolate retained inputs and outputs', () => {
  let input: any, output: any, calls = 0;
  const source = { child: { n: 1 } };
  const schema = { parse(value: any) {
    calls++;
    assert.equal(Object.isFrozen(value), false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, 'child'), { value: value.child, writable: true, enumerable: true, configurable: true });
    input = value;
    output = structuredClone(value);
    return output;
  } };
  const privateValue = readOwned(schema, source);
  source.child.n = 4; input.child.n = 5; output.child.n = 6;
  assert.equal(privateValue.child.n, 1);
  const reordered = readOwned({ parse: () => ({ b: 2, a: 1 }) }, { a: 1, b: 2 });
  assert.deepEqual(Object.keys(copyOwned(reordered)), ['b', 'a']);
  const delivered = copyOwned(privateValue); delivered.child.n = 7;
  assert.equal(copyOwned(privateValue).child.n, 1);
  readOwned(schema, privateValue);
  assert.equal(calls, 2, 'ownership never skips a custom parser');
  assert.throws(() => readOwned(z.any().superRefine(v => { v.child.n++; }), privateValue), /changed its input/);
  assert.equal(privateValue.child.n, 1);
});

test('owned copies preserve graph and numeric semantics while unknown values still undergo admission', () => {
  const node = { n: -0 }, source: any = JSON.parse('{"__proto__":1,"constructor":2}');
  source.a = node; source.b = node; source.self = source; source.array = [, undefined, NaN, 3n];
  const owned = readOwned(z.any(), source);
  const result = copyOwned(retainOwned({ value: owned }));
  assert.equal(sameData(result.value, source), true);
  assert.notEqual(result.value, owned);
  assert.equal(Object.hasOwn(result.value.array, 0), false);
  assert.equal(Object.hasOwn(result.value, '__proto__'), true);
  let calls = 0;
  assert.throws(() => copyOwned({ get x() { calls++; return 1; } }));
  assert.throws(() => readOwned(z.any(), new Proxy({}, { ownKeys() { calls++; return []; } })));
  assert.equal(calls, 0);
});

test('fast DTO copying cannot call inherited setters, including exotic array bases', () => {
  const key = '__ownedCopySetter'; let calls = 0;
  const value: any = { array: [] };
  Object.defineProperty(value, key, { value: 1, enumerable: true });
  Object.defineProperty(value.array, key, { value: 2, enumerable: true });
  const privateValue = readOwned(z.any(), value);
  Object.defineProperty(Object.prototype, key, { set() { calls++; }, configurable: true });
  const previous = Object.getPrototypeOf(Array.prototype);
  Object.setPrototypeOf(Array.prototype, new Proxy(Object.create(null), {
    get() { calls++; throw Error('unexpected read'); }, set() { calls++; throw Error('unexpected set'); }, has() { calls++; throw Error('unexpected lookup'); }
  }));
  let result: any;
  try { result = copyOwned(privateValue); }
  finally { Object.setPrototypeOf(Array.prototype, previous); delete (Object.prototype as any)[key]; }
  assert.equal(calls, 0);
  assert.equal(result[key], 1); assert.equal(result.array[key], 2);
});

test('private validation agrees with the public boundary for graph, order and rejection counterexamples', () => {
  const transforms: ((v: any) => any)[] = [
    v => v,
    v => ({ array: v.array, b: v.b, a: v.a, self: v.self }),
    v => { v.a.n = 2; return v; },
    v => { v.b = { ...v.a }; return v; },
    v => { v.array.length++; return v; },
    v => { delete v.array[1]; return v; },
    v => { v.extra = undefined; return v; },
    v => { Object.defineProperty(v, 'hidden', { value: 1 }); return v; },
    v => { v.extra = new Map(); return v; },
    v => { v.extra = () => 1; return v; },
    v => { v.extra = Symbol('x'); return v; },
    v => { v[Symbol('x')] = 1; return v; },
    v => { v.self = { ...v }; return v; },
    v => { Object.defineProperty(v.a, 'n', { get() { throw Error('getter must not execute'); }, enumerable: true }); return v; }
  ];
  for (const transform of transforms) {
    const node = { n: -0 }, source: any = { a: node, b: node, array: [, undefined, NaN, 3n] }; source.self = source;
    const schema = { parse: transform };
    let expected: any, failure: unknown;
    try { expected = read(schema, source); } catch (e) { failure = e; }
    if (failure) assert.throws(() => readOwned(schema, source), { name: (failure as Error).name });
    else {
      const actual = copyOwned(readOwned(schema, source));
      assert.equal(sameData(actual, expected), true);
      assert.deepEqual(Object.keys(actual), Object.keys(expected));
      assert.deepEqual(actual, expected);
    }
  }
  const separate = { a: { n: 1 }, b: { n: 1 } };
  const merging = { parse(v: any) { v.b = v.a; return v; } };
  assert.throws(() => read(merging, separate));
  assert.throws(() => readOwned(merging, separate));
});

test('tree certificates stay private and aliases or cycles introduced by a caller use graph copying', () => {
  const privateValue = readOwned(z.any(), { a: { n: 1 }, array: [] as any[] });
  assert.equal(isOwnedTree(privateValue), true);
  const delivered = copyOwned(privateValue);
  assert.equal(isOwnedTree(delivered), false);
  delivered.array.push(delivered.a);
  const shared = readOwned(z.any(), delivered);
  assert.equal(isOwnedTree(shared), false);
  const copied = copyOwned(shared); assert.equal(copied.a, copied.array[0]);
  delivered.array.push(delivered);
  const cyclic = copyOwned(readOwned(z.any(), delivered));
  assert.equal(cyclic.array[1], cyclic);
  assert.deepEqual(copyOwned(privateValue), { a: { n: 1 }, array: [] });
});

test('dense array certificates reject holes and extra fields and guard inherited index setters', () => {
  const dense = readOwned(z.any(), { values: [1, 2, 3] });
  assert.equal(isDenseTree(dense), true);
  const sparse = copyOwned(dense); delete sparse.values[1];
  const checkedSparse = readOwned(z.any(), sparse);
  assert.equal(isDenseTree(checkedSparse), false);
  assert.equal(Object.hasOwn(copyOwned(checkedSparse).values, 1), false);
  const extra: any = copyOwned(dense); extra.values.label = 'kept';
  const checkedExtra = readOwned(z.any(), extra);
  assert.equal(isDenseTree(checkedExtra), false);
  assert.equal((copyOwned(checkedExtra).values as any).label, 'kept');
  let setters = 0, copied: typeof dense;
  Object.defineProperty(Array.prototype, '0', { set() { setters++; }, configurable: true });
  try { copied = copyOwned(dense); }
  finally { delete (Array.prototype as any)['0']; }
  assert.equal(setters, 0); assert.deepEqual(copied!, dense);
  assert.equal(isDenseTree(copied!), false, 'public copies carry no reusable certificate');
});

test('dense private baselines still reject changed array shapes and admit all parser results', () => {
  const source = readOwned(z.any(), { values: [1, 2] });
  let getters = 0;
  const changes = [
    (v: any) => { v.values.pop(); },
    (v: any) => { v.values.push(3); },
    (v: any) => { delete v.values[0]; },
    (v: any) => { v.values.label = 'extra'; },
    (v: any) => { v.values[Symbol('extra')] = 1; },
    (v: any) => { v.values.pop(); Object.defineProperty(v.values, '0', { enumerable: true, get() { getters++; return 1; } }); },
  ];
  for (const change of changes) {
    const parser = { parse(v: any) { change(v); return v; } };
    assert.throws(() => read(parser, source));
    assert.throws(() => readOwned(parser, source));
  }
  assert.equal(getters, 0, 'even a length mismatch cannot skip result admission');
  assert.deepEqual(copyOwned(source), { values: [1, 2] });
});

test('a longer parsed dense array never reads inherited indices absent from the private baseline', () => {
  const source = readOwned(z.any(), { values: [1] });
  let reads = 0, failure: unknown;
  Object.defineProperty(Array.prototype, '10000', { configurable: true, get() { reads++; throw Error('inherited index read'); } });
  try {
    readOwned({ parse(v: any) { v.values = Array.from({ length: 10001 }, () => 1); return v; } }, source);
  } catch (error) { failure = error; }
  finally { delete (Array.prototype as any)['10000']; }
  assert.equal(reads, 0);
  assert.match(String(failure), /Boundary schema changed its input/);
});
