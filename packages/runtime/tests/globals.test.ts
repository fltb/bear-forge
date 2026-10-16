import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programCapabilities } from '../src/program-code.ts';

test('admitted global constants have the same values and property descriptors as JavaScript', () => {
  const environment = programCapabilities(() => {}, () => { throw Error('unavailable'); });
  const first = environment.globals(), second = environment.globals();
  for (const key of ['undefined', 'NaN', 'Infinity']) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(first, key), Object.getOwnPropertyDescriptor(globalThis, key));
    assert.equal(Reflect.set(first, key, 3), false);
    assert.equal(Reflect.deleteProperty(first, key), false);
  }
  first.local = { value: 1 };
  assert.equal(Object.hasOwn(second, 'local'), false);
  assert.strictEqual(first.globalThis, first);
  assert.strictEqual(second.globalThis, second);
});

test('mutable global binding descriptors match V8 without sharing instance assignments',()=>{
  const environment=programCapabilities(()=>{},()=>{throw Error('unavailable');});
  const first=environment.globals(),second=environment.globals();
  for(const name of ['Object','Array','Number','Math','Promise','globalThis']){
    const actual=Object.getOwnPropertyDescriptor(first,name)!;
    const expected=Object.getOwnPropertyDescriptor(globalThis,name)!;
    for(const flag of ['writable','enumerable','configurable'] as const)assert.equal(actual[flag],expected[flag],name+':'+flag);
    const original=second[name];
    assert.equal(Reflect.set(first,name,3),true);
    assert.equal(first[name],3);assert.strictEqual(second[name],original);
    assert.equal(Reflect.deleteProperty(first,name),true);assert.equal(Object.hasOwn(first,name),false);
  }
  assert.strictEqual(second.Object,Object);assert.strictEqual(second.globalThis,second);
});

test('Function keeps its native identity as data while dynamic construction stays rejected', () => {
  const environment = programCapabilities(() => {}, () => { throw Error('unavailable'); });
  const globals = environment.globals();
  assert.strictEqual(globals.Function, Function);
  assert.equal(environment.operations.get(environment.operations.ref(globals.Function, 'name')), 'Function');
  assert.equal(environment.operations.get(environment.operations.ref(globals.Function, 'length')), 1);
  assert.strictEqual(environment.operations.get(environment.operations.ref(Function.prototype, 'constructor')), Function);
  assert.throws(() => environment.operations.invoke(globals.Function, undefined, ['return 1']), /not admitted/);
});

test('local constructors and Math retain V8 identities without exposing Node metadata', () => {
  const environment = programCapabilities(() => {}, () => { throw Error('unavailable'); });
  const globals = environment.globals();
  for (const name of ['Function', 'Date', 'Proxy', 'Math'] as const) {
    assert.strictEqual(globals[name], globalThis[name], name);
  }
  for (const name of ['navigator', 'URL', 'File', 'atob', 'btoa']) {
    assert.equal(Object.hasOwn(globals, name), false, name);
    assert.equal(environment.operations.globalTypeof(environment.operations.globalReference(name)), 'undefined', name);
    assert.throws(() => environment.operations.globalRead(name), ReferenceError, name);
  }
  assert.strictEqual((globals.Math as Math).random, Math.random);
  assert.equal((globals.Math as Math).random.name, 'random');
  assert.strictEqual((globals.Date as DateConstructor).now, Date.now);
});
