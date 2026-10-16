import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';
import { spawnSync } from 'node:child_process';

test('NaN payload bytes and authored view aliases survive execution fork and restore', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    const buffer=new ArrayBuffer(8),data=new DataView(buffer),view=new Float64Array(buffer);
    const key=Symbol('view');
    data.setBigUint64(0,0x7ff8000000000123n,true);
    Object.defineProperty(view,'01',{value:data});
    Object.defineProperty(view,key,{value:view});
    Object.defineProperty(data,'0',{value:view});
    await io.call({port:'step',input:null});
    return [data.getBigUint64(0,true)===0x7ff8000000000123n,
      view.buffer===buffer,view['01']===data,view[key]===view,data['0']===view];
  }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const execution of [parent, parent.fork(), restored]) {
    execution.resume(null);
    assert.equal(execution.result.status, 1, String(execution.result.value));
    assert.deepEqual(execution.result.value, [true, true, true, true, true]);
  }
});

test('inherited intrinsic prototypes remain shared through IO, fork and restore', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    const held=Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    const before=held===Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    const reply=await io.call({port:'step',input:null});
    return [before,held===Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),reply];
  }};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const branch = parent.fork();
  const snapshot = parent.snapshot();
  const restored = new ProgramExecution(artifact);
  restored.restore(snapshot);
  for (const [current, reply] of [[parent, 1], [branch, 2], [restored, 3]] as const) {
    current.resume(reply);
    assert.equal(current.result.status, 1, String(current.result.value));
    assert.deepEqual(current.result.value, [true, true, reply]);
  }
  const source = `import {ProgramExecution} from ${JSON.stringify(new URL('../src/execution.ts', import.meta.url).href)};
    let input='';for await(const chunk of process.stdin)input+=chunk;
    const [artifact,snapshot]=JSON.parse(input);
    const execution=new ProgramExecution(artifact);execution.restore(snapshot);execution.resume(4);
    console.log(JSON.stringify({status:execution.result.status,value:execution.result.value}));`;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], {
    input: JSON.stringify([artifact, snapshot]), encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { status: 1, value: [true, true, 4] });
});

test('default native debug stacks and recapture are excluded from author programs',()=>{
 for(const initialization of [`const error=new Error('saved');`]){
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
   ${initialization} await io.call({port:'step',input:0});return error.stack;
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
  for(const current of [parent,branch,restored]){
   current.resume(null);assert.equal(current.result.status,2);assert.match(String(current.result.value),/Unsupported default Error.stack/);
  }
 }
 for(const expression of ['Error.captureStackTrace(new Error())','Error.captureStackTrace({})']){
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(){return ${expression};}};`).content);
  const instance=new ProgramExecution(artifact);instance.start(null);
  assert.equal(instance.result.status,2);assert.match(String(instance.result.value),/not admitted/);
 }
});

test('inheriting a builtin prototype does not manufacture its internal slots on restore',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
  const fakeMap=Object.create(Map.prototype),fakeArray=Object.create(Array.prototype),fakeNumber=Object.create(Number.prototype);
  const fakeWeak=Object.create(WeakMap.prototype),fakePromise=Object.create(Promise.prototype);
  await io.call({port:'step',input:0});
  let rejected=0;for(const operation of [()=>Map.prototype.get.call(fakeMap,'x'),()=>Number.prototype.valueOf.call(fakeNumber),
   ()=>WeakMap.prototype.get.call(fakeWeak,{}),()=>Promise.prototype.then.call(fakePromise)]){try{operation();}catch(error){rejected++;}}
  return [Array.isArray(fakeArray),rejected,Object.getPrototypeOf(fakeMap)===Map.prototype];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 for(const current of [parent,branch,restored]){current.resume(null);assert.equal(current.result.status,1,String(current.result.value));assert.deepEqual(current.result.value,[false,4,true]);}
});

test('ordinary properties cannot select serializer behavior or execute during saving',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
  let calls=0;const value={get $$typeof(){calls++;return 'custom';}};
  await io.call({port:'step',input:0});const before=calls;const tag=value.$$typeof;return [before,tag,calls];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 for(const current of [parent,branch,restored]){current.resume(null);assert.equal(current.result.status,1);assert.deepEqual(current.result.value,[0,'custom',1]);}
});

test('boxed primitives and explicit error stack values retain internal slots and aliases',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
  const symbol=Symbol('saved'),boxed=[Object(-0),Object('abc'),Object(false),Object(9n),Object(symbol)];
  boxed[0].valueOf=function(){throw Error('custom valueOf ran');};
  const anchor={value:3};class Problem extends Error{};const error=new Problem('failed');error.stack=anchor;
  Object.preventExtensions(anchor);Object.freeze(boxed[1]);
  await io.call({port:'step',input:0});
  return [Object.is(Number.prototype.valueOf.call(boxed[0]),-0),String.prototype.valueOf.call(boxed[1]),
   Boolean.prototype.valueOf.call(boxed[2]),BigInt.prototype.valueOf.call(boxed[3])===9n,
   Symbol.prototype.valueOf.call(boxed[4])===symbol,error instanceof Problem,error.stack===anchor,
   Object.isExtensible(anchor),Object.isFrozen(boxed[1])];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 const again=new ProgramExecution(artifact);again.restore(restored.snapshot());
 for(const current of [parent,branch,restored,again]){current.resume(null);assert.equal(current.result.status,1,String(current.result.value));assert.deepEqual(current.result.value,[true,'abc',false,true,true,true,true,false,true]);}
});

test('byte views preserve shared backing storage, descriptors and custom prototypes through persistence',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
   const bytes=new Uint8Array([1,2,3,4]),buffer=bytes.buffer;
   const view=new Uint8Array(buffer,1,2);view.extra={value:7};
   Object.defineProperty(view,'buffer',{get(){throw Error('buffer getter ran');}});
   Object.setPrototypeOf(view,null);
   await io.call({port:'step',input:0});view[0]+=await io.call({port:'step',input:bytes[1]});
   return [bytes[1],view[0],view.extra.value,bytes.buffer===buffer];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 for(const current of [parent,branch,restored]){
  current.resume(null);assert.equal(current.io.callData.input,2);current.resume(3);
  assert.equal(current.result.status,1,String(current.result.value));assert.deepEqual(current.result.value,[5,5,7,true]);
 }
});

test('alternate newTarget preserves native internal slots and chosen prototypes across persistence',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
   const values=[Reflect.construct(RegExp,['a'],Object),Reflect.construct(Map,[],Object),
     Reflect.construct(Set,[],Object),Reflect.construct(ArrayBuffer,[4],Object),
     Reflect.construct(Error,['x'],Object)];
   await io.call({port:'step',input:null});
   return values.map((value,index)=>[
     Object.getPrototypeOf(value)===Object.prototype,
     Object.prototype.toString.call(value),
     index===0?RegExp.prototype.exec.call(value,'a')?.[0]
       :index===1?Object.getOwnPropertyDescriptor(Map.prototype,'size').get.call(value)
       :index===2?Object.getOwnPropertyDescriptor(Set.prototype,'size').get.call(value)
       :index===3?Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(value)
       :value.message
   ]);
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 assert.equal(parent.result.status,0,String(parent.result.value));
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 const expected=[[true,'[object RegExp]','a'],[true,'[object Object]',0],
   [true,'[object Object]',0],[true,'[object Object]',4],[true,'[object Error]','x']];
 for(const current of [parent,branch,restored]){
   current.resume(null);
   assert.equal(current.result.status,1,String(current.result.value));
   assert.deepEqual(current.result.value,expected);
 }
});

test('native construction keeps an authored newTarget prototype accessor in Context',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
   let calls=0;
   const target=(function Base(){}).bind(null);
   Object.defineProperty(target,'prototype',{get(){calls++;return Object.prototype;}});
   const value=Reflect.construct(RegExp,['a'],target);
   await io.call({port:'step',input:calls});
   return [calls,Object.getPrototypeOf(value)===Object.prototype,
     RegExp.prototype.exec.call(value,'a')?.[0]];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 assert.equal(parent.result.status,0,String(parent.result.value));
 assert.equal(parent.io.callData.input,1);
 const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
 for(const current of [parent,branch,restored]){
   current.resume(null);
   assert.equal(current.result.status,1,String(current.result.value));
   assert.deepEqual(current.result.value,[1,true,'a']);
 }
});

test('resizable buffers are refused before an unsupported backing store is created',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(){
   const Constructor=new Uint8Array().buffer.constructor;return new Constructor(4,{maxByteLength:8});
 }};`).content);
 const execution=new ProgramExecution(artifact);execution.start(null);
 assert.equal(execution.result.status,2);assert.match(String(execution.result.value),/Unsupported resizable ArrayBuffer/);
});

test('Map/Set internal slots survive prototype changes and snapshots never execute author iterators', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    let touched=0;const item={n:1},map=new Map([['x',item]]),set=new Set([item]);
    map[Symbol.iterator]=function*(){touched++;yield ['x',{n:99}];};
    set[Symbol.iterator]=function*(){touched++;yield {n:99};};
    Object.setPrototypeOf(map,null);Object.setPrototypeOf(set,null);
    await io.call({port:'step',input:0});item.n+=await io.call({port:'step',input:touched});
    return [Map.prototype.get.call(map,'x').n,Set.prototype.has.call(set,item),touched];
  }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  const branch = parent.fork(), restored = new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  const again = new ProgramExecution(artifact); again.restore(restored.snapshot());
  for (const [index, execution] of [parent, branch, restored, again].entries()) {
    execution.resume(null);
    assert.equal(execution.io.callData.input, 0);
    execution.resume(index + 1);
    assert.equal(execution.result.status, 1);
    assert.deepEqual(execution.result.value, [index + 2, true, 0]);
  }
});

test('RegExp snapshots preserve brand, aliases and lastIndex without calling shadowing accessors', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    const re=/a/g,alias=re;re.lastIndex=1;
    Object.defineProperty(re,'source',{get(){throw Error('source getter ran');}});
    Object.defineProperty(re,'flags',{get(){throw Error('flags getter ran');}});
    Object.setPrototypeOf(re,null);
    await io.call({port:'step',input:0});
    const match=RegExp.prototype.exec.call(re,'baab');return [match.index,re.lastIndex,re===alias];
  }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  const branch = parent.fork(), restored = new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for (const execution of [parent, branch, restored]) {
    execution.resume(null);
    assert.equal(execution.result.status, 1);
    assert.deepEqual(execution.result.value, [1, 2, true]);
  }
});

test('standard error and byte constructors are consistent global bindings across fork and restore',()=>{
 const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
  const constructors={ReferenceError,SyntaxError,EvalError,URIError,ArrayBuffer,DataView,
   Uint8Array,Int8Array,Uint8ClampedArray,Uint16Array,Int16Array,Uint32Array,Int32Array,
   Float32Array,Float64Array,BigInt64Array,BigUint64Array};
  const buffer=new ArrayBuffer(32),words=new Uint16Array(buffer,0,4),view=new DataView(buffer);
  const errors=[new ReferenceError('reference'),new SyntaxError('syntax'),new EvalError('eval'),new URIError('uri')];
  const arrays=[new Int8Array([1]),new Uint8ClampedArray([1]),new Int16Array([1]),new Uint32Array([1]),
   new Int32Array([1]),new Float32Array([1]),new Float64Array([1]),new BigInt64Array([1n]),new BigUint64Array([1n])];
  words[0]=7;
  const reply=await io.call({port:'step',input:0});
  words[0]+=reply;view.setUint8(4,reply);
  return [Object.keys(constructors).every(key=>constructors[key]===globalThis[key]),
   words.buffer===buffer,view.buffer===buffer,words[0],view.getUint8(4)===new Uint8Array(buffer)[4],
   errors.map(e=>[e.name,e.message,e instanceof globalThis[e.name]]),
   arrays.map(a=>[a.constructor.name,String(a[0]),a instanceof globalThis[a.constructor.name]])];
 }};`).content);
 const parent=new ProgramExecution(artifact);parent.start(null);
 assert.equal(parent.result.status,0,String(parent.result.value));
 const restored=parent.fresh();restored.restore(parent.snapshot());
 for(const [index,current] of [parent,parent.fork(),restored].entries()){
  current.resume(index+1);assert.equal(current.result.status,1,String(current.result.value));
  assert.deepEqual(current.result.value,[true,true,true,index+8,true,
   [['ReferenceError','reference',true],['SyntaxError','syntax',true],['EvalError','eval',true],['URIError','uri',true]],
   ['Int8Array','Uint8ClampedArray','Int16Array','Uint32Array','Int32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array'].map(name=>[name,'1',true])]);
 }
});

test('native error state survives prototype removal, shadowing accessors and independent stack assignments', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    const error=new TypeError('invalid');
    const prototype=Object.getPrototypeOf(error);
    const symbols=Object.getOwnPropertySymbols(prototype);
    Object.defineProperty(error,'name',{get(){throw Error('shadow name read');}});
    Object.defineProperty(error,'message',{get(){throw Error('shadow message read');}});
    Object.setPrototypeOf(error,null);
    const state={error};error.stack=state;
    const reply=await io.call({port:'step',input:null});state.reply=reply;
    return [error.stack===state,state.error===error,state.reply,
      Object.getPrototypeOf(error)===null,symbols.every(key=>Object.getOwnPropertySymbols(prototype).includes(key))];
  }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const restored = parent.fresh(); restored.restore(parent.snapshot());
  const twice = parent.fresh(); twice.restore(restored.snapshot());
  for (const [index, current] of [parent, parent.fork(), restored, twice].entries()) {
    current.resume(index + 1);
    assert.equal(current.result.status, 1, String(current.result.value));
    assert.deepEqual(current.result.value, [true,true,index+1,true,true]);
  }
});

test('native preparation checks current prototypes and keeps forked collection state isolated',async()=>{
  const {Script}=await import('node:vm');
  const parent=new ProgramExecution(decode(compileJavaScript('export const program={schemas:{},async run(_,io){await io.call({port:"step",input:null});return null;}};').content));
  parent.start(null);
  const loaded=parent.loaded;let sibling:ProgramExecution|undefined;
  const values=new Script('({ordinary:{},array:[],map:new Map([[1,2]]),cursorPrototype:Object.getPrototypeOf([][Symbol.iterator]())})').runInContext(loaded.realm);
  const ops=loaded.effects.operations,native=loaded.effects.globals;
  const enter=(instance:ProgramExecution,fn:()=>void)=>loaded.enter((instance as any).context,fn);
  try {
    enter(parent,()=>{
      const heap=(parent as any).context.objects;
      heap.register(values.ordinary);
      for(const value of [values.ordinary,values.array]){
        ops.invoke(native.Object.prototype.valueOf,value,[]);
        ops.invoke(native.Object.prototype.valueOf,value,[]);
        if(value===values.ordinary)assert.equal(heap.nativePreparationUnneeded(value),true);
        Object.setPrototypeOf(value,values.cursorPrototype);
        assert.throws(()=>ops.invoke(native.Object.prototype.valueOf,value,[]),/Unsupported native iterator/);
      }
      ops.invoke(native.Object.prototype.valueOf,values.map,[]);
      assert.equal(heap.nativePreparationUnneeded(values.map),false,'native collection preparation is branch-specific');
    });
    sibling=parent.fork();
    enter(parent,()=>{ops.invoke(native.Map.prototype.set,values.map,[1,7]);});
    enter(sibling,()=>{
      ops.invoke(native.Object.prototype.valueOf,values.map,[]);
      assert.equal(ops.invoke(native.Map.prototype.get,values.map,[1]),2);
      ops.invoke(native.Map.prototype.set,values.map,[1,9]);
    });
    enter(parent,()=>assert.equal(ops.invoke(native.Map.prototype.get,values.map,[1]),7));
  } finally {parent.dispose();sibling?.dispose();}
});
