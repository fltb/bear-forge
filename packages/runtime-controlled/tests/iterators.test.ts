import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

test('borrowed iterator methods retain V8 invalid-receiver diagnostics after IO and branching',async()=>{
  async function run(_setup:unknown,io:any){
    await io.call({port:'step',input:null});
    let reads=0;
    const bad={get [Symbol.toStringTag](){reads++;throw Error('unread tag');}};
    const methods=[
      [Array.prototype.values,null],[Array.prototype.keys,undefined],
      [Map.prototype.keys,bad],[Map.prototype.entries,null],
      [Set.prototype.values,bad],[Set.prototype.entries,null],
      [Uint8Array.prototype.values,bad],
      [Object.getPrototypeOf([][Symbol.iterator]()).next,bad],
      [Object.getPrototypeOf(''[Symbol.iterator]()).next,bad],
      [Object.getPrototypeOf(new Map().keys()).next,bad],
      [Object.getPrototypeOf(new Set().keys()).next,bad],
      [Object.getPrototypeOf(/x/g[Symbol.matchAll]('')).next,bad],
    ];
    const errors=methods.map(([method,receiver])=>{try{method.call(receiver);return null;}catch(error){return [(error as Error).name,(error as Error).message];}});
    return {errors,reads};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  const expected=await run(null,{call:async()=>null});
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
    instance.dispose();
  }
});
test('string iteration retains Unicode position and exhaustion through IO, fork and restore', () => {
  const text = 'A😀\ud800B';
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(text,io){
    const iterator=text[Symbol.iterator]();const first=iterator.next();
    await io.call({port:'step',input:first.value});
    const tail=[];for(const char of iterator)tail.push(char);
    return [first,tail,iterator.next(),iterator.next()];
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(text);
  const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
  const native=text[Symbol.iterator](),first=native.next(),tail=[...native];
  const expected=[first,tail,native.next(),native.next()];
  for(const current of [parent,branch,restored]){
    current.resume(null);assert.equal(current.result.status,1);assert.deepEqual(current.result.value,expected);
  }
});
test('borrowed string iteration guards receiver coercion before entering its cursor',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
  const source={toString:Date.now};
  await io.call({port:'step',input:null});
  return String.prototype[Symbol.iterator].call(source).next();
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 const fork=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 for(const current of [parent,fork,restored]){
  current.resume(null);
  assert.equal(current.result.status,2);
  assert.equal(current.hostViolation,true);
 }
});
test('typed cursors read internal length while borrowed array cursors use array-like length',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
  const values=new Uint8Array([1,2,3]);Object.defineProperty(values,'length',{value:1});
  const typed=values.values(),generic=Array.prototype.values.call(values);
  const empty=Array.prototype.values.call({0:'unused'});
  const first=typed.next().value;await io.call({port:'step',input:first});values[1]=9;
  return [[...typed],[...generic],empty.next()];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 for(const current of [parent,branch,restored]){current.resume(null);assert.equal(current.result.status,1,String(current.result.value));assert.deepEqual(current.result.value,[[9,3],[1],{done:true,value:undefined}]);}
});

test('generic array cursor length cannot invoke ambient coercion after IO or restoration',()=>{
 for(const mode of ['keys','values','entries']){
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const values={0:7,length:{valueOf:Date.now}};
    const cursor=Array.prototype.${mode}.call(values);
    await io.call({port:'step',input:null});
    return cursor.next();
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,mode);
  const fork=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
  for(const current of [parent,fork,restored]){
   current.resume(null);
   assert.equal(current.result.status,2,mode);
   assert.equal(current.hostViolation,true,mode);
   assert.throws(()=>current.snapshot(),/not saveable/,mode);
  }
 }
});

test('generic array cursor observes length conversion and indexed values in native order',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
  const trace=[],size={valueOf(){trace.push('coerce');return 2;}};
  const values={get length(){trace.push('length');return size;},
    get 0(){trace.push('zero');return 'a';},get 1(){trace.push('one');return 'b';}};
  const cursor=Array.prototype.entries.call(values),first=cursor.next();
  await io.call({port:'step',input:first.value});
  return [first,cursor.next(),cursor.next(),trace];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 assert.deepEqual(parent.io.callData.input,[0,'a']);
 const fork=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 const expected=[{done:false,value:[0,'a']},{done:false,value:[1,'b']},
   {done:true,value:undefined},['length','coerce','zero','length','coerce','one','length','coerce']];
 for(const current of [parent,fork,restored]){
  current.resume(null);
  assert.equal(current.result.status,1,String(current.result.value));
  assert.deepEqual(current.result.value,expected);
 }
});

test('generator frames are private and author properties cannot redirect either branch',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
  function* values(){yield 1;yield 2;return 3;}
  const iterator=values(),keys=Object.keys(iterator);iterator._frame={goto:999};
  const first=iterator.next();await io.call({port:'step',input:0});
  return [keys,first,iterator.next(),iterator.next(),iterator._frame.goto];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 for(const current of [parent,branch,restored]){current.resume(null);assert.equal(current.result.status,1,String(current.result.value));assert.deepEqual(current.result.value,[[],{value:1,done:false},{value:2,done:false},{value:3,done:true},999]);}
});

test('async generator frames remain private while the generator waits for external IO',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
  async function* values(){yield 1;const reply=await io.call({port:'step',input:0});yield reply;}
  const iterator=values(),keys=Object.keys(iterator);iterator._frame={goto:999};
  const first=await iterator.next(),second=await iterator.next();
  return [keys,first,second,await iterator.next(),iterator._frame.goto];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 for(const [index,current]of [parent,branch,restored].entries()){current.resume(index+2);assert.equal(current.result.status,1,String(current.result.value));assert.deepEqual(current.result.value,[[],{value:1,done:false},{value:index+2,done:false},{value:undefined,done:true},999]);}
});

test('generator internals cannot be constructed with a supplied execution frame',()=>{
 for(const [body, expected] of [
  [`async function* values(){yield 1;}const iterator=values();return new iterator.constructor(Object);`, /not a constructor/],
  [`function* values(){yield 1;}return Object.getPrototypeOf(values).constructor('yield 1');`, /^TypeError: /],
 ] as const){
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(){${body}}};`).content);
  const execution=new ProgramExecution(artifact);execution.start(null);
  assert.equal(execution.result.status,2);assert.match(String(execution.result.value),expected);
  assert.equal(Object.hasOwn(Object,'flags'),false);
 }
});
test('persistent array iterators and bound closures survive suspension without host prototype patches', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    let total=n;function add(value){total+=value;return total;}
    const bound=add.bind(null,2);const iter=[3,4].values();
    for(const value of [1,2])total+=value+await io.call({port:'step',input:bound()});
    return [total,iter.next().value,iter.next().value,bound()];
  }};`).content);
  const normal = new ProgramExecution(artifact);
  let restored = new ProgramExecution(artifact);
  normal.start(0);
  restored.start(0);
  for (const reply of [5, 6]) {
    const snapshot = restored.snapshot();
    restored = new ProgramExecution(artifact);
    restored.restore(snapshot);
    assert.deepEqual(restored.io.callData, normal.io.callData);
    normal.resume(reply);
    restored.resume(reply);
  }
  assert.equal(normal.result.status, 1);
  assert.equal(restored.result.status, 1);
  assert.deepEqual(normal.result.value, [14, 3, 4, 16]);
  assert.deepEqual(restored.result.value, normal.result.value);
});
test('yield delegation retains the array iterator across a saved outer await', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    function* values(){yield* [2,3];}const iterator=values();const first=iterator.next().value;
    const reply=await io.call({port:'step',input:first});return [first,iterator.next().value,iterator.next().done,reply];
  }};`).content);
  const original = new ProgramExecution(artifact);
  original.start(0);
  const restored = new ProgramExecution(artifact);
  restored.restore(original.snapshot());
  original.resume(7);
  restored.resume(7);
  assert.equal(restored.result.status, 1);
  assert.deepEqual(original.result.value, [2, 3, true, 7]);
  assert.deepEqual(restored.result.value, original.result.value);
});

test('Map/Set cursors retain native deletion, insertion and exhaustion semantics on fork and restore', () => {
  for (const type of ['Map', 'Set']) {
    const source = `export const program={schemas:{},async run(n,io){
      const table=new ${type}(${type === 'Map' ? '[[1,10],[2,20],[3,30]]' : '[1,2,3]'});
      const key='values';const iterator=table[key]();const first=iterator.next().value;
      const amount=await io.call({port:'step',input:first});
      table.delete(1);table.delete(2);
      ${type === 'Map' ? 'table.set(2,amount);table.set(4,40);' : 'table.add(amount);table.add(4);'}
      const rest=Array.from(iterator);table.clear();
      ${type === 'Map' ? 'table.set(5,50);' : 'table.add(5);'}
      return [first,rest,iterator.next().done,Array.from(table.values())];
    }};`;
    const artifact = decode(compileJavaScript(source).content);
    const parent = new ProgramExecution(artifact); parent.start(0);
    const branch = parent.fork(), restored = new ProgramExecution(artifact);
    restored.restore(parent.snapshot());
    parent.resume(7); branch.resume(8); restored.resume(7);
    const result = (n: number) => type === 'Map' ? [10, [30, n, 40], true, [50]] : [1, [3, n, 4], true, [5]];
    assert.equal(parent.result.status, 1, String(parent.result.value));
    assert.equal(branch.result.status, 1, String(branch.result.value));
    assert.equal(restored.result.status, 1, String(restored.result.value));
    assert.deepEqual(parent.result.value, result(7));
    assert.deepEqual(branch.result.value, result(8));
    assert.deepEqual(restored.result.value, result(7));
  }
});

test('author properties cannot expose or overwrite iterator internal slots', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    const array=[1,2],iterator=array.values();
    const before=Object.keys(iterator);iterator.index=100;iterator.array=[];iterator.done=true;
    const first=iterator.next().value;
    await io.call({port:'step',input:first});
    const second=iterator.next().value;iterator.next();array.push(3);
    return [before,first,second,iterator.next().done,iterator.index];
  }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  const branch = parent.fork(), restored = new ProgramExecution(artifact); restored.restore(parent.snapshot());
  for (const instance of [parent,branch,restored]) {
    instance.resume(null);
    assert.deepEqual(instance.result.value,[[],1,2,true,100]);
  }
});

test('invalid native iterable consumers fail before iterator access after IO and branching',async()=>{
  async function run(_setup:unknown,io:any){
    await io.call({port:'step',input:null});
    let reads=0;
    const input={get [Symbol.iterator](){reads++;throw Error('iterator read');}};
    const calls=[
      ()=>Object.fromEntries(null as any),
      ()=>(Object as any).groupBy(null,()=>0),
      ()=>(Map as any).groupBy(undefined,()=>0),
      ()=>(Object as any).groupBy(input,null),
      ()=>(Map as any).groupBy(input,0),
    ];
    const errors=calls.map(call=>{try{call();return null;}catch(error){return [(error as Error).name,(error as Error).message];}});
    return {errors,reads};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  const expected=await run(null,{call:async()=>null});
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
  }
});

for(const kind of ['Map','Set'] as const)test(`${kind} iterator creation avoids table traversal across IO and branches`,()=>{
  const add=kind==='Map'?'table.set(index,index);':'table.add(index);';
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const table=new ${kind}();for(let index=0;index<400;index++)${add}
    await io.call({port:'step',input:null});table.keys();return 1;
  }};`).content);
  const probe=new ProgramExecution(artifact,1_000_000);probe.start(null);
  assert.equal(probe.result.status,0);
  const startCost=1_000_000-(probe as any).context.remaining;
  probe.dispose();
  const parent=new ProgramExecution(artifact,startCost+100);parent.start(null);
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,false,'operation exceeded its bounded budget');
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.equal(instance.result.value,1);
    instance.dispose();
  }
});

for(const kind of ['Map','Set'] as const)test(`${kind} clear replaces the collection root without scanning iterator history`,()=>{
  const add=kind==='Map'?'table.set(index,index);':'table.add(index);';
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const table=new ${kind}();for(let index=0;index<400;index++)${add}
    table.keys();await io.call({port:'step',input:null});table.clear();return 1;
  }};`).content);
  const probe=new ProgramExecution(artifact,1_000_000);probe.start(null);
  assert.equal(probe.result.status,0);
  const startCost=1_000_000-(probe as any).context.remaining;
  probe.dispose();
  const parent=new ProgramExecution(artifact,startCost+100);parent.start(null);
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,false,'operation exceeded its bounded budget');
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.equal(instance.result.value,1);
    instance.dispose();
  }
});

for(const kind of ['Map','Set'] as const)test(`${kind} cursor seeks past deleted entries without scanning their history`,()=>{
  const add=kind==='Map'?'table.set(index,index);':'table.add(index);';
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const table=new ${kind}();for(let index=0;index<400;index++)${add}
    const cursor=table.keys();for(let index=0;index<400;index++)table.delete(index);
    await io.call({port:'step',input:null});cursor.next();return 1;
  }};`).content);
  const probe=new ProgramExecution(artifact,1_000_000);probe.start(null);
  assert.equal(probe.result.status,0);
  const startCost=1_000_000-(probe as any).context.remaining;
  probe.dispose();
  const parent=new ProgramExecution(artifact,startCost+100);parent.start(null);
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,false,'operation exceeded its bounded budget');
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.equal(instance.result.value,1);
    instance.dispose();
  }
});
