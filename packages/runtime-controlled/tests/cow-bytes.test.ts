import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CowBytes, type ByteKind} from '../src/cow-bytes.ts';

test('COW buffer local writes copy a page rather than a large backing buffer', () => {
  const parent = new CowBytes(64 * 1024 * 1024);
  parent.write(0, 1); parent.write(8192, 2);
  const child = parent.fork(), sibling = parent.fork();
  assert.strictEqual((parent as any).pages.root, (child as any).pages.root);
  child.write(0, 7);
  assert.notStrictEqual((parent as any).pages.get(0), (child as any).pages.get(0));
  assert.strictEqual((parent as any).pages.get(2), (child as any).pages.get(2));
  assert.equal((child as any).pages.get(0).byteLength, 4096);
  assert.equal((child as any).pages.size, 2);
  assert.equal(parent.read(0), 1); assert.equal(child.read(0), 7); assert.equal(sibling.read(0), 1);
  parent.write(8192, 9);
  assert.equal(child.read(8192), 2); assert.equal(sibling.read(8192), 2);
  child.write(child.byteLength - 1, 255);
  assert.equal(parent.read(parent.byteLength - 1), 0);
  assert.equal((child as any).pages.size, 3);
  parent.clear(); child.clear();
  assert.equal(sibling.read(8192), 2);
});

test('paged DataView values match V8 including unaligned page boundaries and endian order', () => {
  const store = new CowBytes(9000), native = new Uint8Array(9000), view = new DataView(native.buffer);
  const values: [ByteKind, number | bigint][] = [
    ['Int8', -1], ['Uint8', 999], ['Int16', -9000], ['Uint16', 60000],
    ['Int32', -12345678], ['Uint32', 4000000000], ['Float32', -0], ['Float64', Infinity],
    ['Float64', NaN], ['BigInt64', -9007199254740993n], ['BigUint64', 18446744073709551615n]
  ];
  for (const offset of [0, 4093, 4095, 8191]) for (const little of [false, true]) for (const [kind, value] of values) {
    (view as any)['set' + kind](offset, value, little);
    store.writeValue(kind, offset, value, little);
    assert.ok(Object.is(store.readValue(kind, offset, little), (view as any)['get' + kind](offset, little)), kind);
    const actual = new Uint8Array(native.length); store.readInto(0, actual);
    assert.deepEqual(actual, native);
  }
});

test('paged copies preserve memmove overlap and isolate buffers sharing pages', () => {
  for (const [target, source, length] of [[7, 0, 15000], [0, 7, 15000], [4095, 0, 9000], [0, 4095, 9000]] as const) {
    const expected = Uint8Array.from({length: 20000}, (_, index) => index % 251);
    const store = new CowBytes(expected.length); store.writeFrom(0, expected);
    const branch = store.fork();
    expected.copyWithin(target, source, source! + length!);
    branch.copyFrom(target!, branch, source!, length!);
    const actual = new Uint8Array(expected.length); branch.readInto(0, actual);
    assert.deepEqual(actual, expected);
    const old = new Uint8Array(expected.length); store.readInto(0, old);
    assert.deepEqual(old, Uint8Array.from({length: 20000}, (_, index) => index % 251));
    branch.copyFrom(100, store, 99, 17000);
    expected.set(old.subarray(99, 17099), 100);
    branch.readInto(0, actual); assert.deepEqual(actual, expected);
  }
});

test('buffer range failures do not allocate pages or partially mutate a branch', () => {
  const parent = new CowBytes(4097); parent.write(4096, 42);
  const child = parent.fork(), root = (child as any).pages.root;
  for (const offset of [-1, 4097, NaN, Infinity, 0.5]) {
    assert.throws(() => child.write(offset, 1), RangeError);
    assert.throws(() => child.read(offset), RangeError);
  }
  assert.throws(() => child.writeFrom(4096, new Uint8Array([7, 8])), RangeError);
  assert.throws(() => child.copyFrom(0, parent, 4096, 2), RangeError);
  assert.strictEqual((child as any).pages.root, root);
  assert.equal(child.read(4096), 42);
  assert.equal(parent.read(4096), 42);
  child.writeFrom(4097, new Uint8Array());
  child.readInto(4097, new Uint8Array());
});
