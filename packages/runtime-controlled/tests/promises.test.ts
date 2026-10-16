/// <reference lib="es2024.promise" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

test('Promise settlement charges every pending listener across IO and branches',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const gate=Promise.withResolvers();
    for(let index=0;index<400;index++)gate.promise.then();
    await io.call({port:'step',input:null});
    gate.resolve(1);return 7;
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
    assert.equal(instance.fault,true,'settlement moved pending listeners without charging them');
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('direct await reads a thenable method once with V8 promise assimilation',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(){
    let reads=0;
    const first={get then(){reads++;return resolve=>resolve(7);}};
    const value=await first;
    const second={get then(){reads++;return undefined;}};
    return [value,(await second)===second,reads];
  }};`).content);
  const execution=new ProgramExecution(artifact);execution.start(null);
  assert.equal(execution.result.status,1,String(execution.result.value));
  assert.deepEqual(execution.result.value,[7,true,2]);
});

test('direct await cannot invoke an ambient then method after IO, fork or restore',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});
    await {then:Date.now};
    return 'ambient then ran';
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for(const current of [parent,fork,restored]){
    current.resume(null);
    assert.equal(current.result.status,2);
    assert.match(String(current.result.value),/Ambient or dynamic execution/);
  }
  const caughtArtifact=decode(compileJavaScript(`export const program={schemas:{},async run(){
    try{await {then:Date.now};}catch(error){}return 'caught';
  }};`).content);
  const caught=new ProgramExecution(caughtArtifact);caught.start(null);
  assert.equal(caught.result.status,1);
  assert.equal(caught.hostViolation,true);
});

test('await of an intrinsic Promise ignores an overridden instance then after restoration',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const promise=Promise.resolve(7);
    Object.defineProperty(promise,'then',{get(){throw Error('overridden then was read');}});
    await io.call({port:'step',input:null});
    return await promise;
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for(const current of [parent,fork,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.equal(current.result.value,7);
  }
});

test('direct thenable await retains its resolution callback through IO branches',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const value=await {then(resolve){io.call({port:'step',input:4}).then(resolve);}};
    return value+1;
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0);
  assert.deepEqual(parent.io.callData,{port:'step',input:4});
  const fork=parent.fork(),restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for(const [current,reply] of [[parent,5],[fork,6],[restored,7]] as const){
    current.resume(reply);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.equal(current.result.value,reply+1);
  }
});

test('generic Promise.catch keeps its guarded then call across IO, fork and restore',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const trace=[];
    const receiver={get then(){trace.push('get');return function(yes,no){
      trace.push(this===receiver);return no(io.call({port:'step',input:1}));
    };}};
    const result=await Promise.prototype.catch.call(receiver,async value=>{
      trace.push('catch');return (await value)+2;
    });
    return {trace,result};
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const restored=parent.fresh();restored.restore(parent.snapshot());
  for(const [index,instance]of[parent,parent.fork(),restored].entries()){
    instance.resume(index+3);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,{trace:['get',true,'catch'],result:index+5});
  }
});

test('Promise intrinsic and generated callback metadata match V8 across IO, fork and restore',async()=>{
  async function program(_input:unknown,io:any){
    const gate=Promise.withResolvers<number>(),callbacks:Function[]=[];
    const capture={constructor:undefined,then(yes:Function,no:Function){callbacks.push(yes,no);return 0;}};
    Promise.prototype.finally.call(capture as any,()=>0);
    for(const method of ['all','allSettled','any','race'] as const){
      const value=Promise.resolve(1);
      Object.defineProperty(value,'then',{value(yes:Function,no:Function){callbacks.push(yes,no);yes(1);}});
      Reflect.apply(Promise[method],Promise,[[value]]);
    }
    function metadata(fn:Function){
      let constructable=false;
      try{Reflect.construct(function(){},[],fn);constructable=true;}catch(error){if(!(error instanceof TypeError))throw error;}
      return [fn.name,fn.length,Object.hasOwn(fn,'prototype'),constructable,...['name','length'].map(key=>{
        const d=Object.getOwnPropertyDescriptor(fn,key)!;return [d.writable,d.enumerable,d.configurable];
      })];
    }
    const functions=[Promise,Promise.prototype.then,Promise.prototype.catch,Promise.prototype.finally,
      ...(['all','allSettled','any','race','resolve','reject','withResolvers'] as const).map(key=>Promise[key]),
      Object.getOwnPropertyDescriptor(Promise,Symbol.species)!.get!,gate.resolve,gate.reject,...callbacks];
    const before=functions.map(metadata);
    const shared={value:1};Object.assign(gate.resolve,{shared});Object.assign(gate.reject,{shared});
    const reply=await io.call({port:'step',input:before});
    (gate.resolve as any).shared.value=reply;
    gate.resolve(reply);
    return {before,after:functions.map(metadata),result:await gate.promise,
      alias:(gate.resolve as any).shared===(gate.reject as any).shared,value:(gate.reject as any).shared.value};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${program.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const [index,instance]of[parent,fork,restored].entries()){
    const reply=index+4,expected=await program(null,{call:async()=>reply});
    assert.deepEqual(instance.io.callData.input,expected.before);
    instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
  }
});

async function run(mode: string, io: any) {
  const log: string[]=[];
  const gate=Promise.withResolvers<number>();
  const waiting=io.call({port:'step',input:mode}).then((value: number)=>{log.push('reply');gate.resolve(value);});
  let result: any;
  if(mode==='all') result=Promise.all([gate.promise,7]);
  else if(mode==='settled') result=Promise.allSettled([gate.promise,Promise.reject('failed')]);
  else if(mode==='race') result=Promise.race([gate.promise]);
  else if(mode==='any') result=Promise.any([Promise.reject('first'),gate.promise]);
  else result=Promise.any([Promise.reject('first'),gate.promise.then(()=>{throw 'second';})])
    .catch(error=>[error instanceof AggregateError,error.name,error.errors]);
  const value=await result.finally(()=>{log.push('finally');return Promise.resolve();});
  await waiting;
  return [value,log];
}

for(const mode of ['all','settled','race','any','rejected'])test(`Promise ${mode} retains pending combinator and finally state across fork and restore`,async()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(mode);
  assert.equal(parent.io.callData.input,mode);
  const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
  const again=new ProgramExecution(artifact);again.restore(restored.snapshot());
  for(const [index,current]of [parent,branch,restored,again].entries()){
    const reply=index+4;
    const expected=await run(mode,{call:async()=>reply});
    current.resume(reply);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,expected);
  }
});

async function resolution(_input: unknown, _io: unknown){
  const log: string[]=[];
  const thenable={then(resolve: any,reject: any){log.push('adopt');resolve(3);reject('ignored');resolve(8);}};
  const first=new Promise(resolve=>{resolve(thenable);resolve(99);log.push('executor');});
  log.push('synchronous');
  const value=await first;
  const identity=Promise.resolve(first)===first;
  const gate=Promise.withResolvers();gate.resolve(gate.promise);
  const self=await gate.promise.catch(error=>error instanceof TypeError);
  const final=await Promise.reject('original').finally(()=>Promise.reject('replacement')).catch(error=>error);
  const empty=await Promise.all([]);
  return [value,identity,self,final,empty,log];
}
test('Promise resolution locks, thenable ordering, self resolution and finally rejection match native execution',async()=>{
  const expected=await resolution(null,null);
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${resolution.toString()}};`).content);
  const execution=new ProgramExecution(artifact);execution.start(null);
  assert.equal(execution.result.status,1,String(execution.result.value));
  assert.deepEqual(execution.result.value,expected);
});

test('Promise subclass and custom species are outside the supported profile',()=>{
  for(const body of [
    `class Custom extends Promise{};return new Custom(resolve=>resolve(1));`,
    `const promise=Promise.resolve(1);promise.constructor={};return promise.then(value=>value);`,
    `const promise=Promise.resolve(1);Object.defineProperty(promise,'constructor',{get(){throw Error('getter ran');}});return promise.finally(()=>0);`,
  ]){
    const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(){${body}}};`).content);
    const execution=new ProgramExecution(artifact);execution.start(null);
    assert.equal(execution.result.status,2);
    assert.match(String(execution.result.value),/Unsupported Promise/);
  }
});

test('invalid Promise then receivers leave constructor getters unread across IO branches', async () => {
  async function run(_setup: unknown, io: any) {
    await io.call({port: 'step', input: null});
    let reads = 0;
    const receiver = Object.defineProperty({}, 'constructor', {
      get() { reads++; throw Error('constructor read'); }
    });
    let name = '';
    try { Promise.prototype.then.call(receiver as Promise<unknown>, () => 1); }
    catch (error) { name = (error as Error).name; }
    return {name, reads};
  }
  const expected = await run(null, {call: async () => null});
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.result.status, 0);
  const branch = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const instance of [parent, branch, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('Promise combinators guard iterator and then reads and preserve abrupt close ordering',async()=>{
  async function run(input:{method:'all'|'allSettled'|'any'|'race';phase:string}){
    const trace:string[]=[], marker=Error('marker');
    const value=Promise.resolve(7);
    Object.defineProperty(value,'then',{get(){trace.push('then');throw marker;}});
    const iterable={get [Symbol.iterator](){trace.push('iterator-get');return function(){return {
      get next(){trace.push('next-get');return function(){trace.push('next');if(input.phase==='next')throw marker;return {
        get done(){trace.push('done');if(input.phase==='done')throw marker;return false;},
        get value(){trace.push('value');if(input.phase==='value')throw marker;return value;}};};},
      return(){trace.push('close');throw Error('secondary');}
    };};}};
    let caught=false;
    try{await Reflect.apply(Promise[input.method],Promise,[iterable]);}catch(error){caught=error===marker;}
    return {trace,caught};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  for(const method of ['all','allSettled','any','race'] as const)for(const phase of ['next','done','value','then']){
    const input={method,phase},expected=await run(input);
    const instance=new ProgramExecution(artifact);instance.start(input);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected,method+':'+phase);
  }
});

test('budget exhausted inside a queued callback exits exception dispatch and cannot be saved',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(){
    await Promise.resolve(1).then(()=>{try{while(true){}}catch{}return 7;});
    return 9;
  }};`).content);
  const instance=new ProgramExecution(artifact,1000);
  assert.throws(()=>instance.start(null),/budget exceeded/);
  assert.equal(instance.fault,true);
  assert.throws(()=>instance.snapshot(),/not saveable/);
});

async function pendingAdoption(mode:string,io:any){
  const log:string[]=[];
  const marker={value:1};
  const thenable={get then(){log.push('get');return function(this:unknown,resolve:any,reject:any){
    log.push(this===thenable?'receiver':'wrong');
    io.call({port:'step',input:mode}).then((reply:number)=>{
      marker.value+=reply;
      resolve({get then(){log.push('nested-get');return function(next:any){log.push('nested');next(marker);};}});
      reject('ignored');resolve('ignored');
    });
  };}};
  let promise;
  if(mode==='resolve')promise=Promise.resolve(thenable);
  else if(mode==='executor')promise=new Promise(resolve=>resolve(thenable));
  else if(mode==='withResolvers'){const gate=Promise.withResolvers();gate.resolve(thenable);promise=gate.promise;}
  else promise=Promise.resolve().then(()=>thenable);
  log.push('sync');
  const value=await promise;
  return {same:value===marker,value:marker.value,log};
}

for(const mode of ['resolve','executor','withResolvers','reaction'])test(`thenable ${mode} retains resolving locks, nested adoption and aliases across IO/fork/restore`,async()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${pendingAdoption.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(mode);
  assert.equal(parent.io.callData.input,mode);
  const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
  for(const [index,current]of [parent,branch,restored].entries()){
    const reply=index+3,expected=await pendingAdoption(mode,{call:async()=>reply});
    current.resume(reply);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,expected);
  }
});

test('thenable adoption cannot execute ambient callbacks after IO, fork or restore',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const value={then:Date.now};
    await io.call({port:'step',input:null});
    try{await Promise.resolve(value);}catch{}
    return 1;
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const branch=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
  for(const instance of [parent,branch,restored]){
    instance.resume(null);
    assert.equal(instance.hostViolation,true);
    assert.throws(()=>instance.snapshot(),/not saveable/);
  }
});

test('async parameter wrappers preserve callable identity and promise order through IO, fork and restore', async () => {
  async function program(_input: unknown, io: any) {
    const trace: unknown[] = [];
    let state = 1;
    async function ordinary() { return state; }
    async function suspended(this: any, x = (trace.push('parameter'), state)) {
      var x = x + 1;
      trace.push(['body', x, this.tag, arguments.length]);
      const reply = await io.call({ port: 'step', input: trace.slice() });
      state = reply;
      trace.push('resumed');
      return x + state;
    }
    const named = async function self(x: any = self): Promise<unknown> { var x = x; return [self === named, x === self]; };
    const arrow = (x = 3) => x;
    const asyncArrow = async (x = 3) => { var x = 4; return x; };
    const object = { async method(x = 5) { var x = 6; return [x, this === object]; } };
    class Example { async method(x = 7) { var x = 8; return [x, this instanceof Example]; } }
    async function broken(x = (() => { trace.push('failed parameter'); throw 'default error'; })()) { var x = x; return x; }
    const functions = [suspended, named, asyncArrow, object.method, Example.prototype.method, broken, arrow];
    function metadata(fn: Function) {
      let constructible = false;
      try { Reflect.construct(Object, [], fn); constructible = true; } catch {}
      return [fn.name, fn.length, constructible, Object.hasOwn(fn, 'prototype'),
        Object.getPrototypeOf(fn) === Object.getPrototypeOf(ordinary)];
    }
    const before = functions.map(metadata);
    const pending = suspended.call({ tag: 'receiver' }, undefined);
    const observed = pending.then(value => { trace.push('fulfilled'); return value; });
    const queued = Promise.resolve().then(() => { trace.push('queued'); });
    let rejection: Promise<unknown>;
    try { rejection = broken().catch(error => { trace.push('rejected'); return error; }); }
    catch { rejection = Promise.resolve('synchronous throw'); }
    trace.push('after start');
    const result = await observed;
    await queued;
    return { before, after: functions.map(metadata), trace, result, rejection: await rejection,
      named: await named(), arrow: arrow(), asyncArrow: await asyncArrow(), method: await object.method(), instance: await new Example().method() };
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${program.toString()}};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const [index, instance] of [parent, parent.fork(), restored].entries()) {
    const reply = index + 4;
    let deliver!: (reply: number) => void;
    const expected = program(null, { call: () => new Promise<number>(resolve => { deliver = resolve; }) });
    // Match the external IO boundary: settle pre-existing microtasks before
    // supplying input, rather than making the reference IO immediately ready.
    await new Promise<void>(resolve => setImmediate(resolve));
    deliver(reply);
    instance.resume(reply);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, await expected);
  }
});
