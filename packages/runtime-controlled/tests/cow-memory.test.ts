import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CowMemory, type TypedKind} from '../src/cow-memory.ts';

test('overlapping COW views share their branch buffer and keep stable buffer identities', () => {
  const parent = new CowMemory(), buffer = parent.createBuffer(8192);
  const bytes = parent.createView('Uint8', buffer), data = parent.createView('DataView', buffer, 4093, 20);
  const words = parent.createView('Uint16', buffer, 4092, 4);
  parent.writeData(data, 'Uint32', 0, 0x01020304, false);
  const child = parent.fork(), sibling = parent.fork();
  child.writeData(data, 'Uint32', 0, 0xaabbccdd, false);
  assert.deepEqual([4093, 4094, 4095, 4096].map(i => child.readElement(bytes, i)), [0xaa, 0xbb, 0xcc, 0xdd]);
  assert.deepEqual([4093, 4094, 4095, 4096].map(i => parent.readElement(bytes, i)), [1, 2, 3, 4]);
  parent.writeElement(words, 0, 0x1122);
  assert.equal(sibling.readData(data, 'Uint32', 0, false), 0x01020304);
  assert.equal(child.readData(data, 'Uint32', 0, false), 0xaabbccdd);
  for (const memory of [parent, child, sibling]) {
    assert.strictEqual(memory.view(bytes).buffer, buffer);
    assert.strictEqual(memory.view(data).buffer, buffer);
    assert.equal(memory.bufferLength(buffer), 8192);
  }
  const metadata = child.view(words); metadata.byteOffset = 0;
  assert.equal(child.view(words).byteOffset, 4092);
  parent.clear(); child.clear();
  assert.equal(sibling.readData(data, 'Uint32', 0, false), 0x01020304);
});

test('COW typed element conversion matches native storage for all fixed numeric types', () => {
  const kinds: TypedKind[] = ['Int8', 'Uint8', 'Uint8Clamped', 'Int16', 'Uint16', 'Int32', 'Uint32', 'Float32', 'Float64', 'BigInt64', 'BigUint64'];
  const values = [-Infinity, -999.9, -0, 0, 0.5, 1.5, 2.5, 254.5, 255.5, 999, NaN, Infinity];
  for (const kind of kinds) {
    const Constructor = (globalThis as any)[kind + 'Array'];
    const native = new Constructor(values.length);
    const memory = new CowMemory(), buffer = memory.createBuffer(native.byteLength), view = memory.createView(kind, buffer);
    const input = kind.startsWith('Big') ? [0n, -1n, 2n ** 65n, -(2n ** 65n), 9007199254740993n] : values;
    for (const [index, value] of input.entries()) {
      native[index] = value; memory.writeElement(view, index, value);
      assert.ok(Object.is(memory.readElement(view, index), native[index]), kind + ':' + String(value));
    }
    for (const index of [-1, -0, 0.5, Infinity, values.length]) assert.equal(memory.readElement(view, index), undefined);
    const incompatible = kind.startsWith('Big') ? 1 : 1n;
    assert.throws(() => memory.writeElement(view, values.length, incompatible), TypeError);
  }
});

test('view geometry, foreign identities and overlapping byte copies preserve branch isolation', () => {
  const parent = new CowMemory(), buffer = parent.createBuffer(10000);
  const initial = Uint8Array.from({length: 10000}, (_, i) => i % 251);
  parent.writeBytes(buffer, 0, initial);
  const child = parent.fork();
  child.copyBytes(buffer, 1, buffer, 0, 9999);
  const expected = initial.slice(); expected.copyWithin(1, 0, 9999);
  const actual = new Uint8Array(10000); child.readBytes(buffer, 0, actual); assert.deepEqual(actual, expected);
  parent.readBytes(buffer, 0, actual); assert.deepEqual(actual, initial);
  const foreign = child.createBuffer(8);
  assert.equal(parent.has(foreign), false);
  assert.throws(() => parent.bufferLength(foreign), /Unknown/);
  for (const args of [['Uint16', 1, 1], ['Uint32', 0, 2501], ['DataView', 9999, 2]] as const) {
    assert.throws(() => child.createView(args[0], buffer, args[1], args[2]), RangeError);
  }
  const one = child.createView('DataView', buffer, 5, 1);
  assert.throws(() => child.readData(one, 'Uint16', 0), RangeError);
  assert.throws(() => child.writeData(one, 'Uint16', 0, 1), RangeError);
  child.readBytes(buffer, 0, actual); assert.deepEqual(actual, expected);
});

test('guarded numeric indexing and DataView methods use the active buffer version', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  let active = new CowMemory();
  const parent = active, buffer = parent.createBuffer(8192);
  const bytes = parent.createView('Uint8', buffer), data = parent.createView('DataView', buffer, 4093, 8);
  const ops = createOperations({memory: () => active});
  assert.equal(ops.get(ops.ref(buffer, 'byteLength')), 8192);
  assert.equal(ops.get(ops.ref(bytes, 'length')), 8192);
  assert.equal(ops.get(ops.ref(data, 'byteLength')), 8);
  assert.equal(ops.get(ops.ref(data, 'byteOffset')), 4093);
  assert.strictEqual(ops.get(ops.ref(data, 'buffer')), buffer);
  ops.invoke(DataView.prototype.setUint32, data, [0, 0x01020304]);
  const child = parent.fork(); active = child;
  ops.set(ops.ref(bytes, '4093'), 255);
  assert.equal(ops.invoke(DataView.prototype.getUint32, data, [0]), 0xff020304);
  ops.invoke(DataView.prototype.setUint16, data, [3, 0xaabb, true]);
  assert.equal(ops.get(ops.ref(bytes, '4096')), 0xbb);
  assert.equal(ops.get(ops.ref(bytes, '4097')), 0xaa);
  active = parent;
  assert.equal(ops.invoke(DataView.prototype.getUint32, data, [0]), 0x01020304);
  assert.equal(ops.get(ops.ref(bytes, '4097')), 0);
  for (const key of ['-0', '-1', 'NaN', 'Infinity', '8192']) {
    assert.equal(ops.get(ops.ref(bytes, key)), undefined);
    ops.set(ops.ref(bytes, key), 7);
    assert.equal(ops.get(ops.ref(bytes, key)), undefined);
  }
  assert.throws(() => ops.invoke(DataView.prototype.setBigInt64, data, [999, 1]), TypeError,
    'value conversion precedes bounds checking');
  assert.throws(() => ops.invoke(DataView.prototype.setBigInt64, data, [-1, 1]), RangeError,
    'ToIndex rejects negative offsets before value conversion');
  assert.throws(() => ops.invoke(DataView.prototype.getUint8, bytes, [0]), TypeError, 'borrowed receiver remains brand checked');
});

test('buffer slots and ordinary view properties share one branch boundary', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const {createOperations, protectIntrinsics} = await import('@bear-forge/runtime');
  let active = new CowMemory(undefined, new CowHeap());
  const parent = active, buffer = active.createBuffer(3), view = active.createView('Uint8', buffer);
  const ops = createOperations({objects: () => active.objects!, memory: () => active});
  ops.set(ops.ref(view, 'note'), 'parent');
  ops.set(ops.ref(view, '0'), 3);
  const child = parent.fork(); active = child;
  ops.invoke(Object.defineProperties, Object, [view, {'0': {value: 7}, note: {value: 'child'}}]);
  assert.deepEqual(ops.invoke(Object.keys, Object, [view]), ['0', '1', '2', 'note']);
  assert.equal(ops.invoke(Object.prototype.hasOwnProperty, view, ['0']), true);
  assert.deepEqual(ops.invoke(Object.getOwnPropertyDescriptor, Object, [view, '0']),
    {value: 7, writable: true, enumerable: true, configurable: true});
  assert.equal(ops.invoke(Reflect.defineProperty, Reflect, [view, '0', {configurable: false}]), false);
  assert.equal(ops.invoke(Reflect.deleteProperty, Reflect, [view, '0']), false);
  assert.equal(ops.invoke(JSON.stringify, JSON, [view]), '{"0":7,"1":0,"2":0,"note":"child"}');
  const receiver = child.objects!.create();
  assert.equal(ops.invoke(Reflect.set, Reflect, [view, '0', 10, receiver]), true);
  assert.equal(ops.get(ops.ref(receiver, '0')), 10);
  assert.equal(ops.get(ops.ref(view, '0')), 7);
  assert.throws(() => ops.invoke(Object.freeze, Object, [view]), TypeError);
  assert.equal(ops.invoke(Object.isExtensible, Object, [view]), false);
  assert.equal(ops.invoke(Object.isFrozen, Object, [view]), false);
  active = parent;
  assert.equal(ops.get(ops.ref(view, 'note')), 'parent');
  assert.equal(ops.get(ops.ref(view, '0')), 3);
  assert.equal(ops.invoke(Object.isExtensible, Object, [view]), true);
  protectIntrinsics(buffer);
  assert.throws(() => ops.set(ops.ref(view, '0'), 1), /shared intrinsic/);
});

test('guarded typed set, fill and copyWithin match V8 for overlapping views and conversion order', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const {createOperations} = await import('@bear-forge/runtime');
  const methods = Object.getPrototypeOf(Uint8Array.prototype);
  for (const differentWidth of [false, true]) {
    let active = new CowMemory(undefined, new CowHeap());
    const parent = active, buffer = active.createBuffer(32), target = active.createView('Uint8', buffer);
    const source = active.createView(differentWidth ? 'Uint16' : 'Uint8', buffer, 0, 8);
    const native = Uint8Array.from({length: 32}, (_, i) => i + 1);
    const nativeSource = differentWidth ? new Uint16Array(native.buffer, 0, 8) : new Uint8Array(native.buffer, 0, 8);
    active.writeBytes(buffer, 0, native);
    const child = parent.fork(); active = child;
    const ops = createOperations({objects: () => active.objects!, memory: () => active});
    native.set(nativeSource, 3); ops.invoke(methods.set, target, [source, 3]);
    const check = () => assert.deepEqual(Array.from({length: 32}, (_, i) => active.readElement(target, i)), [...native]);
    check();
    native.copyWithin(7, 1, 20); assert.strictEqual(ops.invoke(methods.copyWithin, target, [7, 1, 20]), target); check();
    native.fill(280, -7, -2); assert.strictEqual(ops.invoke(methods.fill, target, [280, -7, -2]), target); check();
    assert.deepEqual(Array.from({length: 32}, (_, i) => parent.readElement(target, i)), Array.from({length: 32}, (_, i) => i + 1));
  }
  function trace(guarded: boolean) {
    const log: string[] = [], memory = new CowMemory(), buffer = memory.createBuffer(4);
    const target = guarded ? memory.createView('Uint8', buffer) : new Uint8Array(4);
    const ops = createOperations({memory: () => memory});
    const convert = (name: string, value: number) => ({valueOf() {log.push(name); return value;}});
    const source = {get length() {log.push('length'); return 2;}, get 0() {log.push('get0'); return convert('value0', 7);}, get 1() {log.push('get1'); return convert('value1', 8);}};
    const call = (fn: Function, args: unknown[]) => guarded ? ops.invoke(fn, target, args) : Reflect.apply(fn, target, args);
    call(methods.set, [source, convert('offset', 1)]);
    call(methods.fill, [convert('fill', 3), convert('start', 0), convert('end', 1)]);
    return {log, values: guarded ? Array.from({length: 4}, (_, i) => memory.readElement(target, i)) : Array.from(target as Uint8Array)};
  }
  assert.deepEqual(trace(true), trace(false));
});

test('typed readers use internal length and expose original identities to callbacks', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const {createOperations} = await import('@bear-forge/runtime');
  const memory = new CowMemory(undefined, new CowHeap()), buffer = memory.createBuffer(4);
  const view = memory.createView('Uint8', buffer), native = new Uint8Array([1, 2, 3, 4]);
  memory.writeBytes(buffer, 0, native);
  const ops = createOperations({memory: () => memory, objects: () => memory.objects!});
  ops.invoke(Object.defineProperty, Object, [view, 'length', {value: 0}]);
  Object.defineProperty(native, 'length', {value: 0});
  const methods = Object.getPrototypeOf(Uint8Array.prototype);
  for (const name of ['every', 'some', 'find', 'findIndex', 'findLast', 'findLastIndex', 'forEach']) {
    const actual: unknown[] = [], expected: unknown[] = [];
    const receiver = {};
    const result = ops.invoke(methods[name], view, [function(this: unknown, value: number, index: number, array: unknown) {
      assert.strictEqual(array, view); assert.strictEqual(this, receiver); actual.push([value, index]); return value >= 3;
    }, receiver]);
    const reference = methods[name].call(native, function(this: unknown, value: number, index: number, array: unknown) {
      assert.strictEqual(array, native); assert.strictEqual(this, receiver); expected.push([value, index]); return value >= 3;
    }, receiver);
    assert.deepEqual(actual, expected, name); assert.deepEqual(result, reference, name);
  }
  for (const name of ['reduce', 'reduceRight']) {
    const trace: number[] = [];
    const result = ops.invoke(methods[name], view, [(sum: number, value: number, index: number, array: unknown) => {
      assert.strictEqual(array, view); trace.push(index); return sum * 10 + value;
    }, 0]);
    assert.equal(result, methods[name].call(native, (sum: number, value: number) => sum * 10 + value, 0));
    assert.deepEqual(trace, name === 'reduce' ? [0, 1, 2, 3] : [3, 2, 1, 0]);
  }
  for (const [name, args] of [['at', [-1]], ['includes', [3]], ['indexOf', [2]], ['lastIndexOf', [1]], ['join', ['-']]] as const) {
    assert.equal(ops.invoke(methods[name], view, [...args]), methods[name].apply(native, args));
  }
});

test('typed sort and reverse preserve raw float bits and comparator side effects like V8', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const methods = Object.getPrototypeOf(Uint8Array.prototype);
  for (const name of ['sort', 'reverse']) {
    const nativeBytes = new Uint8Array(32), nativeData = new DataView(nativeBytes.buffer);
    for (const [index, bits] of [0x7ff8000000000001n, 0x8000000000000000n, 0x0000000000000000n, 0x3ff0000000000000n].entries()) nativeData.setBigUint64(index * 8, bits, true);
    const parent = new CowMemory(), buffer = parent.createBuffer(32), view = parent.createView('Float64', buffer);
    parent.writeBytes(buffer, 0, nativeBytes);
    const branch = parent.fork(), ops = createOperations({memory: () => branch});
    methods[name].call(new Float64Array(nativeBytes.buffer));
    assert.strictEqual(ops.invoke(methods[name], view, []), view);
    const actual = new Uint8Array(32); branch.readBytes(buffer, 0, actual);
    assert.deepEqual(actual, nativeBytes, name);
    const original = new Uint8Array(32); parent.readBytes(buffer, 0, original);
    assert.equal(new DataView(original.buffer).getBigUint64(0, true), 0x7ff8000000000001n);
  }
  function run(guarded: boolean, throwing: boolean) {
    const memory = new CowMemory(), buffer = memory.createBuffer(4), native = new Uint8Array([4, 3, 2, 1]);
    memory.writeBytes(buffer, 0, native);
    const view = memory.createView('Uint8', buffer), ops = createOperations({memory: () => memory}), trace: unknown[] = [];
    const compare = (a: number, b: number) => {
      trace.push([a, b]);
      if (guarded) ops.set(ops.ref(view, '0'), 99); else native[0] = 99;
      if (throwing) throw Error('stop');
      return {valueOf() {trace.push('convert'); return a - b;}};
    };
    let error: string | undefined;
    try { if (guarded) ops.invoke(methods.sort, view, [compare]); else methods.sort.call(native, compare); }
    catch (caught) {error = (caught as Error).message;}
    return {trace, error, values: guarded ? Array.from({length: 4}, (_, i) => memory.readElement(view, i)) : [...native]};
  }
  for (const throwing of [false, true]) assert.deepEqual(run(true, throwing), run(false, throwing));
});

test('guarded native constructors adopt allocations and copy the active typed source version', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const {CowHeap} = await import('../src/cow-heap.ts');
  let active = new CowMemory(undefined, new CowHeap());
  const ops = createOperations({memory: () => active, objects: () => active.objects!});
  const buffer = ops.construct(ArrayBuffer, [32]);
  const original = ops.construct(Uint16Array, [buffer, 4, 3]);
  ops.set(ops.ref(original, '0'), 1000);
  const parent = active;
  active = parent.fork();
  ops.set(ops.ref(original, '0'), 2000);
  for (const Constructor of [Uint16Array, Float64Array, Uint8Array]) {
    const copy = ops.construct(Constructor, [original]);
    assert.equal(active.view(copy).length, 3);
    assert.equal(active.readElement(copy, 0), new Constructor([2000])[0]);
    ops.set(ops.ref(copy, '0'), 1);
    assert.equal(active.readElement(original, 0), 2000);
  }
  const data = ops.construct(DataView, [buffer, 4, 6]);
  assert.strictEqual(active.view(data).buffer, buffer);
  ops.invoke(DataView.prototype.setUint16, data, [0, 123, true]);
  assert.equal(active.readElement(original, 0), 123);
  assert.equal(parent.readElement(original, 0), 1000);
  class Words extends Uint16Array {}
  const subclass = ops.construct(Uint16Array, [original], Words);
  assert.strictEqual(Object.getPrototypeOf(subclass), Words.prototype);
  assert.equal(active.readElement(subclass, 0), 123);
  const fromList = ops.construct(Uint8Array, [[7, 8, 9]]);
  assert.deepEqual([0, 1, 2].map(i => active.readElement(fromList, i)), [7, 8, 9]);
  assert.throws(() => ops.construct(BigInt64Array, [original]), TypeError);
});

test('native allocation keeps coercion order and same-type copies preserve branch NaN payloads', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const memory = new CowMemory(), ops = createOperations({memory: () => memory});
  function geometry(guarded: boolean) {
    const trace: string[] = [];
    const argument = (name: string, value: number) => ({valueOf() {trace.push(name); return value;}});
    const buffer = guarded ? ops.construct(ArrayBuffer, [argument('size', 16)]) : new ArrayBuffer(argument('size', 16) as any);
    const args = [buffer, argument('offset', 4), argument('length', 2)];
    const view = guarded ? ops.construct(Uint16Array, args) : Reflect.construct(Uint16Array, args);
    return {trace, offset: guarded ? memory.view(view).byteOffset : view.byteOffset,
      length: guarded ? memory.view(view).length : view.length};
  }
  assert.deepEqual(geometry(true), geometry(false));
  const source = ops.construct(Float64Array, [2]), buffer = memory.view(source).buffer;
  const data = ops.construct(DataView, [buffer]);
  ops.invoke(DataView.prototype.setBigUint64, data, [0, 0x7ff8000000000042n, true]);
  ops.invoke(DataView.prototype.setBigUint64, data, [8, 0x8000000000000000n, true]);
  const branch = memory.fork(), branchOps = createOperations({memory: () => branch});
  branchOps.invoke(DataView.prototype.setBigUint64, data, [0, 0x7ff8000000001234n, true]);
  const copy = branchOps.construct(Float64Array, [source]);
  const result = new Uint8Array(16); branch.readBytes(branch.view(copy).buffer, 0, result);
  const native = new DataView(result.buffer);
  assert.equal(native.getBigUint64(0, true), 0x7ff8000000001234n);
  assert.equal(native.getBigUint64(8, true), 0x8000000000000000n);
  assert.equal(memory.readData(data, 'BigUint64', 0, true), 0x7ff8000000000042n);
});

test('ArrayBuffer slice copies branch bytes after species side effects without changing its baseline', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const parent = new CowMemory(undefined, new CowHeap()), memory = parent.fork();
  const ops = createOperations({memory: () => memory, objects: () => memory.objects!});
  const buffer = ops.construct(ArrayBuffer, [9000]), view = ops.construct(Uint8Array, [buffer]);
  ops.set(ops.ref(view, '4096'), 17);
  const sibling = memory.fork();
  const result = ops.invoke(ArrayBuffer.prototype.slice, buffer, [4095, 4098]);
  const bytes = new Uint8Array(3); memory.readBytes(result, 0, bytes);
  assert.deepEqual([...bytes], [0, 17, 0]);
  assert.deepEqual([...new Uint8Array(buffer).subarray(4095, 4098)], [0, 0, 0]);
  assert.equal(sibling.readElement(view, 4096), 17);
  function Species(size: number) {
    ops.set(ops.ref(view, '4096'), 33);
    return ops.construct(ArrayBuffer, [size]);
  }
  ops.set(ops.ref(buffer, 'constructor'), {[Symbol.species]: Species});
  const changed = ops.invoke(ArrayBuffer.prototype.slice, buffer, [4095, 4098]);
  memory.readBytes(changed, 0, bytes);
  assert.deepEqual([...bytes], [0, 33, 0]);
  assert.equal(sibling.readElement(view, 4096), 17);
});

test('copying typed sort and reverse read branch values and leave the source unchanged', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const methods = Object.getPrototypeOf(Uint8Array.prototype);
  for (const name of ['toSorted', 'toReversed']) {
    const memory = new CowMemory(), ops = createOperations({memory: () => memory});
    const source = ops.construct(Uint8Array, [[3, 1, 2]]);
    ops.set(ops.ref(source, '0'), 4);
    const native = new Uint8Array([4, 1, 2]);
    const result = ops.invoke(methods[name], source, []);
    assert.deepEqual([0, 1, 2].map(i => memory.readElement(result, i)), [...methods[name].call(native)]);
    assert.deepEqual([0, 1, 2].map(i => memory.readElement(source, i)), [4, 1, 2]);
    assert.notStrictEqual(memory.view(source).buffer, memory.view(result).buffer);
    const child = memory.fork(); child.writeElement(result, 0, 99);
    assert.notEqual(memory.readElement(result, 0), 99);
  }
});

test('typed map/filter species timing and callback writes match native execution', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const methods = Object.getPrototypeOf(Uint8Array.prototype);
  for (const method of ['map', 'filter']) {
    function run(guarded: boolean) {
      const memory = new CowMemory(undefined, new CowHeap());
      const ops = createOperations({memory: () => memory, objects: () => memory.objects!});
      const source = guarded ? ops.construct(Uint8Array, [[1, 2, 3]]) : new Uint8Array([1, 2, 3]);
      const trace: unknown[] = [], receiver = {};
      const write = (index: number, value: number) => guarded ? ops.set(ops.ref(source, String(index)), value) : source[index] = value;
      function Species(length: number) {
        trace.push(['species', length]); write(1, 9);
        return guarded ? ops.construct(Uint16Array, [length]) : new Uint16Array(length);
      }
      if (guarded) ops.set(ops.ref(source, 'constructor'), {[Symbol.species]: Species});
      else source.constructor = {[Symbol.species]: Species};
      const callback = function(this: unknown, value: number, index: number, array: unknown) {
        assert.strictEqual(this, receiver); assert.strictEqual(array, source);
        trace.push([index, value]); if (index === 0) write(2, 7);
        return method === 'map' ? value * 2 : value !== 2;
      };
      const result = guarded ? ops.invoke(methods[method], source, [callback, receiver]) : methods[method].call(source, callback, receiver);
      return {trace, values: guarded ? Array.from({length: memory.view(result).length}, (_, i) => memory.readElement(result, i)) : [...result]};
    }
    assert.deepEqual(run(true), run(false), method);
  }
});

test('typed subarray keeps branch aliases and validates species content types', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const parent = new CowMemory(undefined, new CowHeap());
  let active = parent;
  const ops = createOperations({memory: () => active, objects: () => active.objects!});
  const source = ops.construct(Uint16Array, [[1, 2, 3, 4]]);
  active = parent.fork();
  const subarray = Object.getPrototypeOf(Uint8Array.prototype).subarray;
  const result = ops.invoke(subarray, source, [1, -1]);
  assert.strictEqual(active.view(result).buffer, active.view(source).buffer);
  assert.equal(active.view(result).byteOffset, 2);
  ops.set(ops.ref(result, '0'), 99);
  assert.equal(active.readElement(source, 1), 99);
  assert.equal(parent.readElement(source, 1), 2);
  ops.set(ops.ref(source, 'constructor'), {[Symbol.species]: BigUint64Array});
  assert.throws(() => ops.invoke(subarray, source, [0, 1]), TypeError);
  ops.set(ops.ref(source, 'constructor'), {[Symbol.species]: function() { return ops.construct(Uint8Array, [0]); }});
  assert.equal(active.view(ops.invoke(subarray, source, [0, 2])).length, 0);
  const methods = Object.getPrototypeOf(Uint8Array.prototype);
  assert.throws(() => ops.invoke(methods.map, source, [(x: number) => x]), TypeError);
  assert.throws(() => ops.invoke(methods.filter, source, [() => true]), TypeError);
});

test('typed slice preserves raw bits and sequential overlapping species copies', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const memory = new CowMemory(undefined, new CowHeap());
  const ops = createOperations({memory: () => memory, objects: () => memory.objects!});
  const slice = Object.getPrototypeOf(Uint8Array.prototype).slice;
  for (const Constructor of [Uint8Array, Uint16Array]) {
    const source = ops.construct(Constructor, [[1, 2, 3, 4]]), native = new Constructor([1, 2, 3, 4]);
    ops.set(ops.ref(source, 'constructor'), {[Symbol.species]: function() {
      return ops.construct(Constructor, [memory.view(source).buffer, Constructor.BYTES_PER_ELEMENT, 3]);
    }});
    Object.defineProperty(native, 'constructor', {value: {[Symbol.species]: function() {
      return new Constructor(native.buffer, Constructor.BYTES_PER_ELEMENT, 3);
    }}});
    const result = ops.invoke(slice, source, [0, 3]), expected = slice.call(native, 0, 3);
    assert.deepEqual([0, 1, 2].map(i => memory.readElement(result, i)), [...expected]);
    assert.deepEqual([0, 1, 2, 3].map(i => memory.readElement(source, i)), [...native]);
  }
  const source = ops.construct(Float64Array, [1]);
  const data = ops.construct(DataView, [memory.view(source).buffer]);
  ops.invoke(DataView.prototype.setBigUint64, data, [0, 0x7ff8000000000077n, true]);
  const result = ops.invoke(slice, source, []), bytes = new Uint8Array(8);
  memory.readBytes(memory.view(result).buffer, 0, bytes);
  assert.equal(new DataView(bytes.buffer).getBigUint64(0, true), 0x7ff8000000000077n);
});

test('typed with observes argument side effects before copying and validates value before index range', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const method = Object.getPrototypeOf(Uint8Array.prototype).with;
  for (const index of [-1, 20]) {
    function run(guarded: boolean) {
      const memory = new CowMemory(), ops = createOperations({memory: () => memory});
      const source = guarded ? ops.construct(Uint8Array, [[1, 2, 3]]) : new Uint8Array([1, 2, 3]);
      const trace: string[] = [];
      const args = [{valueOf() {trace.push('index'); return index;}}, {valueOf() {
        trace.push('value');
        if (guarded) ops.set(ops.ref(source, '0'), 9); else source[0] = 9;
        return 257;
      }}];
      let values, error;
      try {
        const result = guarded ? ops.invoke(method, source, args) : method.apply(source, args);
        values = guarded ? [0, 1, 2].map(i => memory.readElement(result, i)) : [...result];
      } catch (caught) { error = (caught as Error).name; }
      return {trace, values, error, source: guarded ? memory.readElement(source, 0) : source[0]};
    }
    assert.deepEqual(run(true), run(false));
  }
});

test('typed static from/of write branch storage including preexisting constructor results', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  const parent = new CowMemory(); let active = parent;
  const ops = createOperations({memory: () => active});
  const destination = ops.construct(Uint16Array, [[1, 2, 3]]);
  active = parent.fork();
  function Existing() { return destination; }
  const result = ops.invoke(Uint16Array.of, Existing, [10, 20, 30]);
  assert.strictEqual(result, destination);
  assert.deepEqual([0, 1, 2].map(i => active.readElement(result, i)), [10, 20, 30]);
  assert.deepEqual([0, 1, 2].map(i => parent.readElement(result, i)), [1, 2, 3]);
  assert.deepEqual([...new Uint16Array(active.view(result).buffer)], [1, 2, 3]);
  ops.invoke(Uint16Array.from, Existing, [{length: 3, 0: 7, 1: 8, 2: 9}, (x: number) => x + 1]);
  assert.deepEqual([0, 1, 2].map(i => active.readElement(result, i)), [8, 9, 10]);
  assert.throws(() => ops.invoke(Uint16Array.of, Existing, [1, 2, 3, 4]), TypeError);
});

test('typed from preserves iterator, allocation, mapping and array-like access order', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  for (const iterable of [true, false]) {
    function run(guarded: boolean) {
      const memory = new CowMemory(), ops = createOperations({memory: () => memory}), trace: unknown[] = [];
      function Constructor(length: number) {
        trace.push(['allocate', length]);
        return guarded ? ops.construct(Uint16Array, [length]) : new Uint16Array(length);
      }
      const source = iterable ? {[Symbol.iterator]() {
        trace.push('iterator'); let index = 0;
        return {next() {trace.push(['next', index]); return index < 2 ? {value: ++index, done: false} : {done: true};}};
      }} : {get length() {trace.push('length'); return 2;}, get 0() {trace.push('read0'); return 1;}, get 1() {trace.push('read1'); return 2;}};
      const receiver = {};
      const mapper = function(this: unknown, value: number, index: number) {
        assert.strictEqual(this, receiver); trace.push(['map', index]);
        return {valueOf() {trace.push(['convert', index]); return value * 10;}};
      };
      const result = guarded ? ops.invoke(Uint16Array.from, Constructor, [source, mapper, receiver]) : Uint16Array.from.call(Constructor as any, source as any, mapper as any, receiver);
      return {trace, values: guarded ? [0, 1].map(i => memory.readElement(result, i)) : [...result]};
    }
    assert.deepEqual(run(true), run(false));
  }
});

test('typed static failures retain only writes preceding the failed conversion in their branch', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  for (const from of [false, true]) {
    const parent = new CowMemory(); let active = parent;
    const ops = createOperations({memory: () => active});
    const result = ops.construct(Uint8Array, [[1, 2, 3]]);
    active = parent.fork();
    function Existing() {return result;}
    const input = [9, {valueOf() {throw new Error('conversion');}}, 8];
    assert.throws(() => ops.invoke(from ? Uint8Array.from : Uint8Array.of, Existing, from ? [input] : input), /conversion/);
    assert.deepEqual([0, 1, 2].map(i => active.readElement(result, i)), [9, 2, 3]);
    assert.deepEqual([0, 1, 2].map(i => parent.readElement(result, i)), [1, 2, 3]);
    let touched = false;
    const source = {get [Symbol.iterator]() {touched = true; return undefined;}};
    assert.throws(() => ops.invoke(Uint8Array.from, Existing, [source, 42]), TypeError);
    assert.equal(touched, false);
  }
});

test('adopting another branch allocation rejects without replacing its identity registration', () => {
  const parent = new CowMemory(), child = parent.fork();
  const buffer = child.createBuffer(8), view = child.createView('Uint8', buffer);
  child.writeElement(view, 0, 42);
  assert.throws(() => parent.adoptBuffer(buffer), /does not belong/);
  assert.throws(() => parent.adoptView(view), /does not belong/);
  assert.equal(child.readElement(view, 0), 42);
  assert.equal(parent.has(buffer), false);
});
