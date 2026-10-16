import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { copy, sameData, read, keys, admitSchema } from '../src/index.ts';
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
