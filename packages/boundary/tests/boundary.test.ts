import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { copy, sameData, read, keys, admitSchema } from '../src/index.ts';
import { admittedCopy, readOwned } from '../src/values.ts';
test('inherited descriptor value fields cannot turn accessors into boundary data', () => {
  let getters = 0;
  const accessor = { get n() { getters++; return 1; } };
  const privateInput = readOwned(z.any(), { n: 1 });
  const operations = [() => copy(accessor), () => keys(accessor), () => admittedCopy(accessor),
    () => readOwned(z.any(), accessor), () => readOwned({ parse: () => accessor }, privateInput)];
  const rejected: boolean[] = [];
  Object.defineProperty(Object.prototype, 'value', { value: 1, writable: true, configurable: true });
  try {
    for (const operation of operations) {
      try { operation(); rejected.push(false); }
      catch (error) { rejected.push(error instanceof TypeError); }
    }
  } finally { delete (Object.prototype as any).value; }
  assert.deepEqual(rejected, operations.map(() => true));
  assert.equal(getters, 0);
});
test('private DTO copying agrees with the public inspection path for values and rejection order', () => {
  const inspection = { getPrototypeOf: Object.getPrototypeOf, getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor, ownKeys: Reflect.ownKeys };
  const shared: any = JSON.parse('{"__proto__":{"n":1},"constructor":2}'); shared.self = shared;
  const array: any[] = [, shared, undefined, -0, NaN, 3n];
  const hidden: any = { child: () => 1 }; Object.defineProperty(hidden, 'hidden', { value: 1 });
  let calls = 0;
  const mixed: any = { get x() { calls++; return 1; } }; mixed[Symbol('x')] = 1;
  const proxy = new Proxy({}, { ownKeys() { calls++; return []; } });
  for (const source of [array, shared, { a: shared, b: shared }, hidden, mixed, proxy, new Date(), Object.create(null)]) {
    let expected: any, failure: unknown;
    try { expected = copy(source, inspection); } catch (e) { failure = e; }
    if (failure) assert.throws(() => admittedCopy(source), { name: (failure as Error).name, message: (failure as Error).message });
    else { const actual = admittedCopy(source); assert.equal(sameData(actual, expected), true); assert.deepEqual(actual, expected); assert.deepEqual(Object.keys(actual), Object.keys(expected)); }
  }
  assert.equal(calls, 0);
});
test('production validation compares against a baseline unavailable to schema callbacks', () => {
  const schema = z.any().superRefine(value => { value.child.n++; });
  admitSchema(schema);
  const child = { n: 1 }, input = { child, alias: child };
  assert.throws(() => read(schema, input), /changed its input/);
  assert.equal(input.child.n, 1);
  assert.equal(input.child, input.alias);
  assert.deepEqual(read(z.any().superRefine(() => {}), input), input);
});
test('isolation preserves aliases, holes and numeric edge values', () => {
  const shared = {
    value: -0
  };
  const value: any = {
    a: shared,
    b: shared,
    array: [, NaN, undefined]
  };
  value.self = value;
  const result = copy(value);
  assert.notEqual(result, value);
  assert.equal(result.a, result.b);
  assert.equal(result.self, result);
  assert.equal(0 in result.array, false);
  assert.ok(Object.is(result.a.value, -0));
  assert.ok(Number.isNaN(result.array[1]));
});
test('boundary data equality preserves aliases and Object.is numeric distinctions', () => {
  const shared={value:1};
  assert.equal(sameData(-0,0),false);
  assert.equal(sameData(NaN,NaN),true);
  assert.equal(sameData({left:shared,right:shared},{left:{value:1},right:{value:1}}),false);
  assert.equal(sameData({a:1,b:2},{b:2,a:1}),true);
  let calls=0;
  const accessor={get value(){calls++;return 1;}};
  assert.throws(()=>sameData(accessor,{value:1}));
  assert.equal(calls,0);
});
test('rejects getters without invoking them and functions/resources', () => {
  let calls = 0;
  const getter = {
    get x() {
      calls++;
      return 1;
    }
  };
  assert.throws(() => copy(getter));
  assert.equal(calls, 0);
  for (const value of [() => 0, new Map(), new Date(), Object.create({
    x: 1
  })]) assert.throws(() => copy(value));
  assert.throws(() => keys({
    [Symbol('x')]: 1
  }));
});
test('rejects proxy input before invoking any host trap', () => {
  const calls:string[]=[];
  const handler={
    getPrototypeOf(){calls.push('prototype');return Object.prototype;},
    ownKeys(){calls.push('keys');return ['value'];},
    getOwnPropertyDescriptor(){calls.push('descriptor');return {value:1,enumerable:true,configurable:true};},
    get(){calls.push('get');return 1;}
  };
  const object=new Proxy({},handler),array=new Proxy([] as unknown[],handler);
  for(const value of [object,array])assert.throws(()=>copy(value),/Proxy cannot cross a boundary/);
  const objectWithProxyPrototype=Object.create(new Proxy({},handler));
  const arrayWithProxyPrototype:unknown[]=[];
  Object.setPrototypeOf(arrayWithProxyPrototype,new Proxy(Array.prototype,handler));
  for(const value of [objectWithProxyPrototype,arrayWithProxyPrototype])
    assert.throws(()=>copy(value),/Proxy cannot cross a boundary/);
  const revoked=Proxy.revocable({},handler);revoked.revoke();
  assert.throws(()=>copy(revoked.proxy),/Proxy cannot cross a boundary/);
  assert.throws(()=>keys(object),/Proxy cannot cross a boundary/);
  assert.deepEqual(calls,[]);
});
test('schema values are preserved irrespective of source property order', () => {
  assert.deepEqual(read(z.strictObject({
    a: z.number(),
    b: z.string()
  }), {
    b: 'x',
    a: 2
  }), {
    a: 2,
    b: 'x'
  });
  assert.throws(() => read(z.object({
    x: z.number()
  }), {
    x: 2,
    hidden: true
  }));
  assert.throws(() => read(z.string().transform(x => x.toUpperCase()), 'x'));
  assert.throws(() => admitSchema(z.coerce.number()));
  assert.throws(() => admitSchema(z.number().default(1)));
});

test('copy validates plain fields once and preserves cyclic data with dangerous property names', () => {
  const input: any = JSON.parse('{"__proto__":{"value":1},"constructor":2}');
  input.self = input;
  let ownKeyCalls = 0;
  const reads = new Map<object, Map<PropertyKey, number>>();
  const result = copy(input, {
    getPrototypeOf: Object.getPrototypeOf,
    ownKeys(value) { ownKeyCalls++; return Reflect.ownKeys(value); },
    getOwnPropertyDescriptor(value, key) {
      let fields = reads.get(value);
      if (!fields) reads.set(value, fields = new Map());
      fields.set(key, (fields.get(key) ?? 0) + 1);
      return Object.getOwnPropertyDescriptor(value, key);
    }
  });
  assert.equal(ownKeyCalls, 2);
  for (const fields of reads.values()) for (const count of fields.values()) assert.equal(count, 1);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.self, result);
  assert.equal(result.constructor, 2);
  assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__'), {
    value: {value: 1}, writable: true, enumerable: true, configurable: true
  });
});

test('copy never invokes inherited setters while constructing plain output', () => {
  const key = '__bearBoundaryInheritedSetter';
  let calls = 0;
  Object.defineProperty(Object.prototype, key, {set() {calls++;}, configurable: true});
  try {
    const result = copy({[key]: 42});
    assert.equal(calls, 0);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, key), {
      value: 42, writable: true, enumerable: true, configurable: true
    });
  } finally { delete (Object.prototype as any)[key]; }
});

test('copy snapshots values from reusable inspection descriptors before nested traversal', () => {
  const child = {nested: 7};
  const input: any = {first: child, second: 8, alias: child, array: [child, , 9]};
  input.self = input;
  const scratchDescriptors = new Set<PropertyDescriptor>();
  const inspect = {
    getPrototypeOf: Object.getPrototypeOf,
    ownKeys: Reflect.ownKeys,
    getOwnPropertyDescriptor(object: object, key: PropertyKey, scratch?: PropertyDescriptor) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !scratch) return descriptor;
      scratchDescriptors.add(scratch);
      for (const field of Reflect.ownKeys(scratch)) delete (scratch as any)[field];
      return Object.assign(scratch, descriptor);
    }
  };
  const result = copy(input, inspect);
  assert.equal(scratchDescriptors.size, 1);
  assert.equal(result.first.nested, 7);
  assert.equal(result.second, 8);
  assert.equal(result.first, result.alias);
  assert.equal(result.array[0], result.first);
  assert.equal(1 in result.array, false);
  assert.equal(result.self, result);
  let called = false;
  assert.throws(() => copy({data: 1, get bad() {called = true; return 2;}}, inspect));
  assert.equal(called, false);
});

test('copy defines own writable fields over inherited readonly array properties', () => {
  const key = '__bearBoundaryReadonly';
  const source: any[] = [1, , 3];
  Object.defineProperty(source, key, {value: 7, enumerable: true});
  Object.defineProperty(Array.prototype, key, {value: 0, configurable: true});
  try {
    const result = copy(source);
    assert.equal(result.length, 3);
    assert.equal(1 in result, false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, key), {
      value: 7, writable: true, enumerable: true, configurable: true
    });
  } finally {delete (Array.prototype as any)[key];}
});

test('copy does not inspect an exotic host array prototype chain while writing output', async () => {
  const {runInNewContext} = await import('node:vm');
  const source = runInNewContext('[1,2]');
  const previous = Object.getPrototypeOf(Array.prototype);
  let traps = 0, result: unknown;
  const exotic = new Proxy(Object.create(null), {
    has() {traps++; throw Error('unexpected output prototype lookup');},
    get() {traps++; throw Error('unexpected output prototype read');}
  });
  Object.setPrototypeOf(Array.prototype, exotic);
  try {result = copy(source);}
  finally {Object.setPrototypeOf(Array.prototype, previous);}
  assert.equal(traps, 0);
  assert.deepEqual(result, [1,2]);
});
