import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CowHeap} from '../src/cow-heap.ts';
const invoke = (fn: Function, self: unknown, args: unknown[]) => Reflect.apply(fn, self, args);
const data = (value: unknown) => ({value, writable: true, enumerable: true, configurable: true});

test('COW objects retain alias and cycle identities while parent and child mutate independently', () => {
  const parent = new CowHeap(), object = parent.create();
  parent.defineProperty(object, 'self', data(object));
  parent.defineProperty(object, 'value', data(1));
  const child = parent.fork(), sibling = parent.fork();
  assert.equal(child.set(object, 'value', 2, object, invoke), true);
  assert.equal(parent.set(object, 'value', 3, object, invoke), true);
  assert.equal(parent.get(object, 'value', object, invoke), 3);
  assert.equal(child.get(object, 'value', object, invoke), 2);
  assert.equal(sibling.get(object, 'value', object, invoke), 1);
  for (const heap of [parent, child, sibling]) assert.strictEqual(heap.get(object, 'self', object, invoke), object);
  const created = child.create();
  assert.equal(parent.has(created), false);
  assert.throws(() => parent.getOwnPropertyDescriptor(created, 'value'), /Context/);
  parent.clear(); child.clear();
  assert.equal(sibling.get(object, 'value', object, invoke), 1);
});

test('COW descriptors and preventExtensions are branch-local, including irreversible native changes', () => {
  const parent = new CowHeap(), object = parent.create();
  parent.defineProperty(object, 'value', data(1));
  const child = parent.fork();
  child.defineProperty(object, 'value', {writable: false, configurable: false});
  child.preventExtensions(object);
  assert.equal(child.set(object, 'value', 2, object, invoke), false);
  assert.equal(child.deleteProperty(object, 'value'), false);
  assert.equal(child.defineProperty(object, 'extra', data(3)), false);
  assert.equal(parent.set(object, 'value', 2, object, invoke), true);
  assert.equal(parent.deleteProperty(object, 'value'), true);
  assert.equal(parent.defineProperty(object, 'extra', data(3)), true);
  assert.equal(child.get(object, 'value', object, invoke), 1);
  assert.equal(parent.isExtensible(object), true);
  assert.equal(child.isExtensible(object), false);
});

test('adopting nonextensible objects and arrays preserves integrity and branch writes', () => {
  for (const array of [false, true]) for (const integrity of [Object.preventExtensions, Object.seal, Object.freeze]) {
    const identity = integrity(array ? [1] : {value: 1});
    const parent = new CowHeap(); parent.register(identity);
    const child = parent.fork(), key = array ? '0' : 'value';
    assert.equal(parent.isExtensible(identity), false);
    assert.equal(child.defineProperty(identity, 'extra', data(2)), false);
    assert.equal(child.setPrototypeOf(identity, null), false);
    const writable = integrity !== Object.freeze;
    assert.equal(child.set(identity, key, 2, identity, invoke), writable);
    assert.equal(child.get(identity, key, identity, invoke), writable ? 2 : 1);
    assert.equal(parent.get(identity, key, identity, invoke), 1);
    assert.deepEqual(parent.getOwnPropertyDescriptor(identity, key), Object.getOwnPropertyDescriptor(identity, key));
    if (array) assert.equal(child.defineProperty(identity, '1', data(2)), false);
  }
});

test('existing data writes honor inherited restrictions and explicit receiver descriptors across branches', () => {
  const parent = new CowHeap(), base = parent.create(), receiver = parent.create();
  parent.defineProperty(base, 'value', data(1));
  parent.defineProperty(receiver, 'value', {value: 2, writable: true, enumerable: false, configurable: false});
  parent.preventExtensions(receiver);
  const child = parent.fork();
  assert.equal(child.set(base, 'value', 3, receiver, invoke), true);
  assert.deepEqual(child.getOwnPropertyDescriptor(receiver, 'value'),
    {value: 3, writable: true, enumerable: false, configurable: false});
  assert.equal(parent.get(receiver, 'value', receiver, invoke), 2);
  assert.equal(child.get(base, 'value', base, invoke), 1);
  child.defineProperty(base, 'value', {writable: false});
  assert.equal(child.set(base, 'value', 4, receiver, invoke), false);
  assert.equal(child.get(receiver, 'value', receiver, invoke), 3);
  parent.defineProperty(receiver, 'value', {writable: false});
  assert.equal(parent.set(base, 'value', 5, receiver, invoke), false);
  const accessor = parent.create();
  let calls = 0;
  parent.defineProperty(accessor, 'value', {set() {calls++;}, configurable: true});
  assert.equal(parent.set(base, 'value', 6, accessor, invoke), false);
  assert.equal(calls, 0, 'receiver accessor is not invoked for a base data property');
});

test('COW inherited setters receive stable identity and can write only their active branch', () => {
  let active = new CowHeap();
  const parent = active, prototype = parent.create(), object = parent.create(prototype);
  parent.defineProperty(prototype, 'value', {configurable: true,
    get(this: object) {return active.get(this, '_value', this, invoke);},
    set(this: object, value: unknown) {assert.strictEqual(this, object); active.set(this, '_value', value, this, invoke);}
  });
  const child = parent.fork();
  active = child; assert.equal(child.set(object, 'value', 9, object, invoke), true);
  active = parent; assert.equal(parent.get(object, 'value', object, invoke), undefined);
  parent.set(object, 'value', 4, object, invoke);
  assert.equal(parent.get(object, 'value', object, invoke), 4);
  active = child; assert.equal(child.get(object, 'value', object, invoke), 9);
  assert.equal(child.setPrototypeOf(prototype, object), false, 'cycle rejected');
  assert.equal(child.setPrototypeOf(object, null), true);
  assert.strictEqual(parent.getPrototypeOf(object), prototype);
});

test('COW own key order and descriptor transitions match V8 across deletion and recreation', () => {
  const heap = new CowHeap(), object = heap.create(), native = Object.create(null);
  const symbol = Symbol('key');
  const steps: [PropertyKey, PropertyDescriptor][] = [
    ['z', data(0)], ['9', data(9)], ['1', data(1)], [symbol, data(2)],
    ['4294967295', data(3)], ['01', data(4)], ['__proto__', data(5)],
    ['a', {value: NaN, writable: true, configurable: false}],
    ['a', {writable: false}], ['a', {value: NaN}], ['a', {value: 1}],
    ['z', {get() {return 7;}, configurable: true}], ['z', {value: 8}]
  ];
  for (const [key, descriptor] of steps) {
    assert.equal(heap.defineProperty(object, key, descriptor), Reflect.defineProperty(native, key, descriptor));
    assert.deepEqual(heap.getOwnPropertyDescriptor(object, key), Object.getOwnPropertyDescriptor(native, key));
    assert.deepEqual(heap.ownKeys(object), Reflect.ownKeys(native));
  }
  for (const key of ['z', symbol]) {
    assert.equal(heap.deleteProperty(object, key), Reflect.deleteProperty(native, key));
    heap.defineProperty(object, key, data(10)); Reflect.defineProperty(native, key, data(10));
    assert.deepEqual(heap.ownKeys(object), Reflect.ownKeys(native));
  }
  const descriptor = heap.getOwnPropertyDescriptor(object, 'z')!;
  descriptor.value = 999;
  assert.equal(heap.get(object, 'z', object, invoke), 10, 'descriptor reads cannot mutate storage');
});

test('large object local writes share untouched property paths across forks', () => {
  const parent = new CowHeap(), object = parent.create();
  for (let index = 0; index < 10000; index++) parent.defineProperty(object, String(index), data(index));
  const child = parent.fork();
  const before = (parent as any).states.getIdentity(object);
  child.set(object, '1', -1, object, invoke);
  const after = (child as any).states.getIdentity(object);
  assert.notStrictEqual(before.properties, after.properties);
  assert.strictEqual(before.properties.pages.root.slots[1], after.properties.pages.root.slots[1]);
  assert.notStrictEqual(before.properties.read(2), after.properties.read(2));
  assert.strictEqual(before.properties.read(2).layout, after.properties.read(2).layout);
  assert.strictEqual(before.properties.read(64), after.properties.read(64));
  assert.equal(parent.get(object, '1', object, invoke), 1);
  assert.equal(child.get(object, '1', object, invoke), -1);
  assert.equal(child.get(object, '9999', object, invoke), 9999);
});

test('guarded runtime operations route reflection, assignment and conversions through the active COW branch', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  let active = new CowHeap();
  const parent = active, object = parent.create(Object.prototype);
  const ops = createOperations({objects: () => active});
  const call = (fn: Function, ...args: any[]) => ops.invoke(fn, undefined, args);
  call(Object.defineProperty, object, 'value', data(1));
  const child = parent.fork();
  active = child;
  assert.equal(ops.set(ops.ref(object, 'value'), 2), 2);
  assert.equal(ops.get(ops.ref(object, 'value')), 2);
  assert.equal(call(Reflect.get, object, 'value'), 2);
  assert.equal(ops.has('value', object), true);
  assert.equal(call(Reflect.has, object, 'value'), true);
  assert.deepEqual(call(Object.keys, object), ['value']);
  assert.deepEqual(call(Object.entries, object), [['value', 2]]);
  assert.deepEqual(call(Object.getOwnPropertyDescriptors, object), {value: data(2)});
  assert.equal(call(Object.hasOwn, object, 'value'), true);
  assert.equal(ops.invoke(Object.prototype.propertyIsEnumerable, object, ['value']), true);
  assert.strictEqual(call(Object.freeze, object), object);
  assert.equal(call(Object.isFrozen, object), true);
  assert.equal(call(Reflect.set, object, 'value', 3), false);
  assert.throws(() => ops.set(ops.ref(object, 'value'), 3), TypeError);
  assert.equal(call(Reflect.deleteProperty, object, 'value'), false);
  assert.throws(() => ops.remove(ops.ref(object, 'value')), TypeError);
  active = parent;
  assert.equal(call(Object.isFrozen, object), false);
  assert.equal(ops.get(ops.ref(object, 'value')), 1);
  const receiver = parent.create();
  assert.equal(call(Reflect.set, object, 'value', 4, receiver), true);
  assert.equal(ops.get(ops.ref(receiver, 'value')), 4);
  assert.equal(ops.get(ops.ref(object, 'value')), 1);
  call(Object.defineProperty, object, Symbol.toPrimitive, data(function(this: object) {return ops.get(ops.ref(this, 'value'));}));
  assert.equal(ops.add(object, 9), 10);
  assert.strictEqual(call(Object.assign, object, {extra: 7}), object);
  assert.equal(ops.get(ops.ref(object, 'extra')), 7);
  assert.equal(ops.remove(ops.ref(object, 'extra')), true);
  active = child;
  assert.equal(call(Object.hasOwn, object, 'extra'), false);
});

test('COW arrays match V8 length truncation failures and preserve holes across branches', () => {
  const parent = new CowHeap(), array = parent.createArray(10), native: unknown[] = new Array(10);
  for (const index of [1, 4, 8]) {
    const descriptor = {...data(index), configurable: index !== 4};
    parent.defineProperty(array, String(index), descriptor);
    Reflect.defineProperty(native, String(index), descriptor);
  }
  const child = parent.fork();
  assert.equal(child.defineProperty(array, 'length', {value: 2, writable: false}),
    Reflect.defineProperty(native, 'length', {value: 2, writable: false}));
  assert.deepEqual(child.ownKeys(array), Reflect.ownKeys(native));
  for (const key of Reflect.ownKeys(native)) assert.deepEqual(child.getOwnPropertyDescriptor(array, key), Object.getOwnPropertyDescriptor(native, key));
  assert.equal(parent.get(array, 'length', array, invoke), 10);
  assert.equal(parent.get(array, '8', array, invoke), 8);
  assert.equal(child.get(array, 'length', array, invoke), 5);
  assert.equal(child.defineProperty(array, '7', data(7)), false);
});

test('guarded array operations mutate only their branch and run length conversion twice', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  let active = new CowHeap();
  const parent = active, array = parent.createArray();
  const ops = createOperations({objects: () => active});
  assert.equal(ops.invoke(Array.prototype.push, array, [3, 1, 2]), 3);
  const child = parent.fork(); active = child;
  assert.strictEqual(ops.invoke(Array.prototype.sort, array, []), array);
  assert.deepEqual(ops.invoke(Object.values, undefined, [array]), [1, 2, 3]);
  const length = child.create();
  let calls = 0;
  child.defineProperty(length, 'valueOf', data(() => {calls++; return 1;}));
  ops.set(ops.ref(array, 'length'), length);
  assert.equal(calls, 2);
  assert.deepEqual(ops.invoke(Object.values, undefined, [array]), [1]);
  active = parent;
  assert.deepEqual(ops.invoke(Object.values, undefined, [array]), [3, 1, 2]);
  assert.equal(ops.invoke(Array.prototype.pop, array, []), 2);
  assert.equal(ops.get(ops.ref(array, 'length')), 2);
  active = child;
  assert.equal(ops.get(ops.ref(array, 'length')), 1);
});

test('deep COW prototype lookup is iterative and charges work in each branch', () => {
  let ticks = 0;
  const heap = new CowHeap(undefined, () => { ticks++; });
  const root = heap.create();
  heap.defineProperty(root, 'answer', data(42));
  let leaf = root;
  for (let index = 0; index < 10000; index++) leaf = heap.create(leaf);
  const branch = heap.fork();
  for (const active of [heap, branch]) {
    const before = ticks;
    assert.equal(active.get(leaf, 'answer', leaf, invoke), 42);
    assert.equal(ticks - before, 625);
    assert.equal(active.set(leaf, 'answer', 9, leaf, invoke), true);
    assert.equal(active.get(root, 'answer', root, invoke), 42);
    assert.equal(active.get(leaf, 'answer', leaf, invoke), 9);
  }
});

test('COW JSON and legacy prototype reflection observe branch state rather than identity shells', async () => {
  const {createOperations} = await import('@bear-forge/runtime');
  let active = new CowHeap();
  const parent = active, object = parent.create(Object.prototype), array = parent.createArray();
  const ops = createOperations({objects: () => active});
  ops.set(ops.ref(object, 'array'), array);
  ops.invoke(Array.prototype.push, array, [1, 2]);
  const child = parent.fork(); active = child;
  ops.set(ops.ref(array, '0'), 9);
  assert.equal(ops.invoke(JSON.stringify, JSON, [object]), '{"array":[9,2]}');
  assert.equal(ops.instanceOf(array, Array), true);
  assert.equal(ops.invoke(Object.prototype.isPrototypeOf, Array.prototype, [array]), true);
  const prototype = child.create(Object.prototype);
  ops.set(ops.ref(object, '__proto__'), prototype);
  assert.strictEqual(ops.get(ops.ref(object, '__proto__')), prototype);
  assert.equal(ops.invoke(Object.prototype.isPrototypeOf, prototype, [object]), true);
  const getter = () => 7;
  ops.invoke((Object.prototype as any).__defineGetter__, object, ['answer', getter]);
  assert.strictEqual(ops.invoke((Object.prototype as any).__lookupGetter__, object, ['answer']), getter);
  assert.equal(ops.get(ops.ref(object, 'answer')), 7);
  active = parent;
  assert.equal(ops.invoke(JSON.stringify, JSON, [object]), '{"array":[1,2]}');
  assert.strictEqual(ops.get(ops.ref(object, '__proto__')), Object.prototype);
  assert.equal(ops.get(ops.ref(object, 'answer')), undefined);
});

test('small named objects use a shallow index without collisions with array indices',()=>{
  const heap=new CowHeap(),object=heap.create(),symbol=Symbol('key');
  heap.defineProperty(object,'value',data(1));heap.defineProperty(object,'other',data(2));
  assert.equal((heap as any).states.getIdentity(object).properties.pages,undefined);
  assert.ok((heap as any).states.getIdentity(object).properties.read(1));
  heap.defineProperty(object,'0',data(3));heap.defineProperty(object,'1',data(4));heap.defineProperty(object,symbol,data(5));
  heap.defineProperty(object,'4294967294',data(6));heap.defineProperty(object,'4294967295',data(7));
  const branch=heap.fork();branch.set(object,'value',8,object,invoke);branch.deleteProperty(object,'1');
  for(const [key,value]of [['value',1],['other',2],['0',3],['1',4],[symbol,5],['4294967294',6],['4294967295',7]] as const)
    assert.equal(heap.get(object,key,object,invoke),value);
  assert.equal(branch.get(object,'value',object,invoke),8);assert.equal(branch.get(object,'1',object,invoke),undefined);
});

test('fresh registration copies complete descriptors without executing accessors or relaxing integrity',()=>{
  const symbol=Symbol('field');let reads=0;
  for(const extensible of [true,false]){
    const object=Object.create(null);
    Object.defineProperties(object,{
      '8':{value:8,writable:false,enumerable:true,configurable:false},
      hidden:{value:{nested:1},writable:true,enumerable:false,configurable:true},
      accessor:{get(){reads++;return 3;},enumerable:true,configurable:true},
    });
    Object.defineProperty(object,symbol,{value:4,writable:true,enumerable:true,configurable:true});
    if(!extensible)Object.preventExtensions(object);
    const keys=Reflect.ownKeys(object),descriptors=Object.getOwnPropertyDescriptors(object);
    const heap=new CowHeap();heap.register(object);
    assert.equal(reads,0);assert.deepEqual(heap.ownKeys(object),keys);
    for(const key of keys)assert.deepEqual(heap.getOwnPropertyDescriptor(object,key),Reflect.get(descriptors,key));
    assert.equal(heap.isExtensible(object),extensible);assert.equal(heap.getPrototypeOf(object),null);
    const child=heap.fork();assert.equal(child.deleteProperty(object,'hidden'),true);
    assert.ok(heap.getOwnPropertyDescriptor(object,'hidden'));assert.equal(child.deleteProperty(object,'8'),false);
    assert.equal(child.defineProperty(object,'added',data(5)),extensible);
  }
});


test('repeated owned writes detach again after a later fork without changing descriptor attributes', () => {
  const parent = new CowHeap(), object = parent.create();
  parent.defineProperty(object, 'value', {value: 0, writable: true, enumerable: false, configurable: false});
  const first = parent.fork();
  for (let i = 1; i <= 20; i++) parent.set(object, 'value', i, object, invoke);
  const second = parent.fork();
  for (let i = 21; i <= 40; i++) parent.set(object, 'value', i, object, invoke);
  for (let i = 41; i <= 60; i++) second.set(object, 'value', i, object, invoke);
  assert.equal(first.get(object, 'value', object, invoke), 0);
  assert.equal(parent.get(object, 'value', object, invoke), 40);
  assert.deepEqual(second.getOwnPropertyDescriptor(object, 'value'),
    {value: 60, writable: true, enumerable: false, configurable: false});
  first.set(object, 'value', 100, object, invoke);
  assert.equal(parent.get(object, 'value', object, invoke), 40);
  assert.equal(second.get(object, 'value', object, invoke), 60);
});

test('fixed read hints bypass name lookup and validate layouts after branch mutations', () => {
  const parent = new CowHeap(), object = parent.create(), other = parent.create(), prototype = parent.create();
  parent.defineProperty(object, 'value', data(1));
  parent.defineProperty(other, 'different', data(2)); parent.defineProperty(other, 'value', data(3));
  parent.defineProperty(prototype, 'value', data(99)); parent.setPrototypeOf(object, prototype);
  const cache = {slots: [] as number[]};
  const hints = cache.slots;
  assert.equal(parent.get(object, 'value', object, invoke, cache), 1);
  assert.equal(parent.get(other, 'value', other, invoke, cache), 3);
  assert.equal(hints.length, 2);
  const child = parent.fork();
  child.set(object, 'value', 4, object, invoke);
  child.defineProperty(other, 'value', {get() {return this === other ? 5 : -1;}, configurable: true});
  const original = (child as any).slot;
  (child as any).slot = () => {throw new Error('A cached own read must not resolve a name');};
  assert.equal(child.get(object, 'value', object, invoke, cache), 4);
  assert.equal(child.get(other, 'value', other, invoke, cache), 5);
  (child as any).slot = original;
  child.deleteProperty(object, 'value');
  assert.equal(child.get(object, 'value', object, invoke, cache), 99, 'deleted own fields fall back to the current prototype');
  assert.equal(parent.get(object, 'value', object, invoke, cache), 1);
  child.defineProperty(object, 'value', data(undefined));
  assert.equal(child.get(object, 'value', object, invoke, cache), undefined);
  assert.ok(hints.every(value => typeof value === 'number'), 'hints never retain author values');
});

test('missing fixed fields invalidate on insertion, prototype changes and forked layouts', () => {
  const parent = new CowHeap(), object = parent.create(), cache = {slots: [] as number[]};
  assert.equal(parent.get(object, 'optional', object, invoke, cache), undefined);
  const original = (parent as any).slot;
  (parent as any).slot = () => {throw new Error('A cached absence must not resolve a name');};
  assert.equal(parent.get(object, 'optional', object, invoke, cache), undefined);
  (parent as any).slot = original;
  parent.defineProperty(object, 'different', data(7));
  assert.equal(parent.get(object, 'optional', object, invoke, cache), undefined);
  assert.equal(parent.get(object, 'different', object, invoke, cache), 7, 'absence entries also validate the requested key');
  const child = parent.fork();
  child.defineProperty(object, 'optional', data(4));
  assert.equal(child.get(object, 'optional', object, invoke, cache), 4);
  assert.equal(parent.get(object, 'optional', object, invoke, cache), undefined);
  const prototype = parent.create(); parent.defineProperty(prototype, 'optional', data(5));
  parent.setPrototypeOf(object, prototype);
  assert.equal(parent.get(object, 'optional', object, invoke, cache), 5);
  parent.deleteProperty(prototype, 'optional');
  assert.equal(parent.get(object, 'optional', object, invoke, cache), undefined);
  parent.defineProperty(prototype, 'optional', data(6));
  assert.equal(parent.get(object, 'optional', object, invoke, cache), 6, 'prototype changes invalidate cached misses');
});

test('cached absence on mutable prototypes invalidates independently in sibling branches', () => {
  const parent = new CowHeap(), prototype = parent.create(), object = parent.create(prototype);
  const cache = {slots: [] as number[]};
  assert.equal(parent.get(object, 'field', object, invoke, cache), undefined);
  const child = parent.fork(), sibling = parent.fork();
  parent.defineProperty(prototype, 'field', data(1));
  child.defineProperty(prototype, 'other', data(2));
  assert.equal(child.get(object, 'field', object, invoke, cache), undefined);
  assert.equal(parent.get(object, 'field', object, invoke, cache), 1);
  assert.equal(sibling.get(object, 'field', object, invoke, cache), undefined);
  const ancestor = child.create(); child.defineProperty(ancestor, 'field', data(3));
  child.setPrototypeOf(prototype, ancestor);
  assert.equal(child.get(object, 'field', object, invoke, cache), 3);
  assert.equal(sibling.get(object, 'field', object, invoke, cache), undefined);
  child.deleteProperty(ancestor, 'field');
  assert.equal(child.get(object, 'field', object, invoke, cache), undefined);
  child.defineProperty(ancestor, 'field', data(4));
  assert.equal(child.get(object, 'field', object, invoke, cache), 4);
});

test('reusable descriptor inspection preserves branch-local data and accessor distinctions', () => {
  const heap = new CowHeap(), object = heap.create(), scratch: PropertyDescriptor = {};
  const getter = () => 2;
  heap.defineProperty(object, 'data', data(1));
  heap.defineProperty(object, 'accessor', {get: getter, enumerable: false, configurable: true});
  const child = heap.fork();
  child.defineProperty(object, 'data', data(3));
  for (const branch of [heap, child]) {
    for (const key of ['data', 'accessor', 'data']) {
      const expected = branch.getOwnPropertyDescriptor(object, key);
      assert.equal(branch.getOwnPropertyDescriptor(object, key, scratch), scratch);
      assert.deepEqual(scratch, expected);
    }
  }
  assert.equal(heap.getOwnPropertyDescriptor(object, 'absent', scratch), undefined);
});

test('own key order matches native across sparse pages and divergent branch insertions', () => {
  const heap = new CowHeap(), object = heap.create(), native: any = {};
  const symbol = Symbol('field');
  for (const key of ['4294967294','96','32','0','-0','01','4294967295','name',symbol]) {
    heap.defineProperty(object,key,data(1)); Object.defineProperty(native,key,data(1));
  }
  const branch = heap.fork(), nativeBranch = Object.defineProperties({},Object.getOwnPropertyDescriptors(native));
  for (const [current, expected, keys] of [[heap,native,['95','1','new']], [branch,nativeBranch,['2','64','other']]] as const) {
    current.deleteProperty(object,'32'); delete (expected as any)['32'];
    current.deleteProperty(object,'name'); delete (expected as any).name;
    for (const key of [...keys,'32','name']) {
      current.defineProperty(object,key,data(2)); Object.defineProperty(expected,key,data(2));
    }
    assert.deepEqual(current.ownKeys(object),Reflect.ownKeys(expected));
  }
  assert.deepEqual(heap.ownKeys(object),Reflect.ownKeys(native));
});
