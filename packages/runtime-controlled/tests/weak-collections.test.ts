import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

test('weak keys include shared functions, symbols, cycles and aliased keys across fork and restore', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    const key={}, symbol=Symbol('key');
    const map=new WeakMap([[Object.assign,3],[key,4],[symbol,5]]);
    const set=new WeakSet([Object.assign,key,symbol]);
    map.set(map,key);
    const amount=await io.call({port:'step',input:map.get(Object.assign)});
    map.set(key,amount);set.delete(symbol);
    return [map.get(Object.assign),map.get(key),map.get(symbol),map.get(map)===key,set.has(key),set.has(symbol),map instanceof WeakMap];
  }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.io.callData.input, 3);
  const branch = parent.fork(), restored = new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  parent.resume(7); branch.resume(8); restored.resume(7);
  assert.deepEqual(parent.result.value, [3,7,5,true,true,false,true]);
  assert.deepEqual(branch.result.value, [3,8,5,true,true,false,true]);
  assert.deepEqual(restored.result.value, parent.result.value);
});

test('weak entries follow strong reachability to a fixed point in every copy path', () => {
  const instance = new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){return null;}};`).content));
  instance.start(null);
  const runtime = instance as any;
  runtime.loaded.enter(runtime.context, () => {
    const effects = runtime.loaded.effects;
    const record=runtime.loaded.record;
    const RealmObject=runtime.loaded.read(runtime.context.globals,'Object'),RealmSymbol=runtime.loaded.read(runtime.context.globals,'Symbol');
    const map = new effects.WeakMap(), set = new effects.WeakSet();
    const live = record(), second = record(), propertyKey = RealmSymbol('property'), boxedKey = RealmSymbol('boxed');
    // Keep these keys alive in the test host, outside the copied root. Collection
    // timing must not decide whether they enter an independent Context.
    const dead = RealmSymbol('external-only'), cycle = record();
    map.set(dead, Object.assign(record(),{ marker: 'weak-only-payload' })); set.add(dead);
    map.set(cycle, Object.assign(record(),{ cycle, marker: 'self-supporting-weak-cycle' }));
    // Reverse order requires another pass after live's value discovers second.
    map.set(second, Object.assign(record(),{ answer: 42 })); map.set(live, second);
    map.set(propertyKey, 4); map.set(boxedKey, 5);
    map.set(RealmObject.assign, 6); map.set(RealmSymbol.iterator, 7); map.set(map, 8);
    set.add(live); set.add(propertyKey); set.add(RealmObject.assign);
    const root = Object.assign(record(),{ map, set, live, [propertyKey]: true, boxed: RealmObject(boxedKey) });
    const encoded = effects.S.write(root);
    assert.doesNotMatch(JSON.stringify(encoded), /weak-only-payload|self-supporting-weak-cycle/);
    const plan = effects.prepareCopy(root);
    const copies = [effects.prepareCopy(root)(), plan(), plan(), effects.S.read(encoded)];
    for (const copy of copies) {
      assert.equal(copy.map.has(dead), false);
      assert.equal(copy.set.has(dead), false);
      assert.equal(copy.map.get(copy.map.get(copy.live)).answer, 42);
      const ownSymbol = Object.getOwnPropertySymbols(copy)[0];
      assert.equal(copy.map.get(ownSymbol), 4);
      assert.equal(copy.map.get(RealmSymbol.prototype.valueOf.call(copy.boxed)), 5);
      assert.equal(copy.map.get(RealmObject.assign), 6);
      assert.equal(copy.map.get(RealmSymbol.iterator), 7);
      assert.equal(copy.map.get(copy.map), 8);
      assert.equal(copy.set.has(copy.live), true);
      assert.equal(copy.set.has(ownSymbol), true);
      assert.equal(copy.set.has(RealmObject.assign), true);
      assert.notStrictEqual(copy.live, live);
    }
    copies[0].map.get(copies[0].live).branch = true;
    assert.equal(copies[1].map.get(copies[1].live).branch, undefined);
    assert.equal(map.has(dead), true);
    assert.equal(map.has(cycle), true);
  });
});

test('completed collection iterations do not retain their tables through the cursor index', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    function walk(count){
    let total=0;
    for(let i=0;i<count;i++){
      const table=new Map([[i,'discarded-iteration-payload']]);
      for(const [key]of table)total+=key;
    }
    return total;
    }
    const total=walk(n);
    return total+await io.call({port:'step',input:total});
  }};`).content);
  const small = new ProgramExecution(artifact), large = new ProgramExecution(artifact);
  small.start(0); large.start(1000);
  const smallText = JSON.stringify(small.snapshot()), largeSnapshot = large.snapshot();
  const largeText = JSON.stringify(largeSnapshot);
  assert.doesNotMatch(largeText, /discarded-iteration-payload/);
  assert.ok(largeText.length < smallText.length + 500, `${smallText.length} -> ${largeText.length}`);
  const branch = large.fork(), restored = new ProgramExecution(artifact);
  restored.restore(largeSnapshot);
  large.resume(1); branch.resume(2); restored.resume(3);
  assert.equal(large.result.value, 499501);
  assert.equal(branch.result.value, 499502);
  assert.equal(restored.result.value, 499503);
});

test('reverse weak-key chains across collections survive all copy paths without recursive scheduling', () => {
  const instance = new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){return null;}};`).content));
  instance.start(null);
  const runtime = instance as any;
  runtime.loaded.enter(runtime.context, () => {
    const effects = runtime.loaded.effects, count = 4000;
    const maps = runtime.loaded.array(0);
    maps.push(new effects.WeakMap(),new effects.WeakMap());
    const keys = Array.from({length:count+1}, (_, index) => Object.assign(runtime.loaded.record(),{index}));
    for (let i=count-1;i>=0;i--) maps[i%2].set(keys[i],keys[i+1]);
    const root = Object.assign(runtime.loaded.record(),{maps,head:keys[0]});
    const plan = effects.prepareCopy(root);
    for(const copy of [effects.prepareCopy(root)(),plan(),plan(),effects.S.read(effects.S.write(root))]){
      let key=copy.head;
      for(let i=0;i<count;i++){
        assert.equal(key.index,i);
        assert.notStrictEqual(key,keys[i]);
        key=copy.maps[i%2].get(key);
      }
      assert.equal(key.index,count);
    }
  });
});

test('weak-entry scheduling wakes each dependency once and leaves unsupported cycles pending', () => {
  const instance = new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){return null;}};`).content));
  const Queue=instance.loaded.effects.S.WeakEntryQueue;
  const queue=new Queue(), count=10000, keys=Array.from({length:count+1},()=>({}));
  let writes=0,unreachableWrites=0;
  for(let i=count-1;i>=0;i--)queue.add(keys[i],()=>{writes++;queue.mark(keys[i+1]);});
  const orphan={},partner={};
  queue.add(orphan,()=>{unreachableWrites++;queue.mark(partner);});
  queue.add(partner,()=>{unreachableWrites++;queue.mark(orphan);});
  queue.mark(keys[0]);
  assert.equal(queue.drain(),true);
  assert.equal(writes,count);
  assert.equal(unreachableWrites,0);
  for(const key of keys)queue.mark(key);
  assert.equal(queue.drain(),false);
  assert.equal(writes,count);
  // Entries discovered after their key and multiple entries for one key work too.
  queue.add(keys[3],()=>{writes++;});queue.add(keys[3],()=>{writes++;});
  queue.drain();assert.equal(writes,count+2);
});

test('production copy plan drains indexed entries awakened by native weak-map scalar values', () => {
  const instance = new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){return null;}};`).content));
  instance.start(null);
  const runtime=instance as any;
  runtime.loaded.enter(runtime.context,()=>{
    const effects=runtime.loaded.effects, key=runtime.loaded.record(),symbol=runtime.loaded.read(runtime.context.globals,'Symbol')('from-native-weak-value');
    const indexed=new effects.WeakMap();indexed.set(symbol,Object.assign(runtime.loaded.record(),{answer:42}));
    const native=new (runtime.loaded.read(runtime.context.globals,'WeakMap'))();native.set(key,symbol);
    const root=Object.assign(runtime.loaded.record(),{key,native,indexed});
    const copy=effects.prepareCopy(root)();
    assert.equal(copy.indexed.get(copy.native.get(copy.key)).answer,42);
    assert.notStrictEqual(copy.key,key);
    assert.notStrictEqual(copy.indexed.get(symbol),indexed.get(symbol));
  });
});
