import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

const artifact = (source: string) => decode(compileJavaScript(source).content);
test('production fork shares state roots and first advance does not enumerate the retained heap',()=>{
  const code=artifact(`export const program={schemas:{},async run(size,io){
    const data=Array.from({length:size},(_,index)=>({index,value:0}));
    const reply=await io.call({port:'step',input:data.length});
    data[0].value=reply;
    await io.call({port:'step',input:data[0].value});
    return [data.length,data[0].value,data[data.length-1].index];
  }};`);
  for(const size of [32,4096]){
    const parent=new ProgramExecution(code,10_000_000);parent.start(size);
    assert.equal(parent.result.status,0,String(parent.result.value));
    const runtime=parent as any,effects=parent.loaded.effects;
    const prepare=effects.prepareCopy,write=effects.S.write,ownKeys=runtime.context.objects.ownKeys;
    const forbidden=()=>{throw Error('fork/first advance traversed retained state');};
    effects.prepareCopy=forbidden;effects.S.write=forbidden;runtime.context.objects.ownKeys=forbidden;
    let child: ProgramExecution | undefined;
    try{
      child=parent.fork();const branch=child as any;
      assert.strictEqual(parent.loaded,child.loaded);
      assert.strictEqual(runtime.context.objects.states.root,branch.context.objects.states.root);
      assert.strictEqual(runtime.context.intrinsicSlots.root,branch.context.intrinsicSlots.root);
      assert.strictEqual(runtime.context.memory.records.root,branch.context.memory.records.root);
      assert.strictEqual(runtime.context.globals,branch.context.globals);
      branch.context.objects.ownKeys=forbidden;
      child.resume(9);
      branch.context.objects.ownKeys=ownKeys;
      runtime.context.objects.ownKeys=ownKeys;
      assert.equal(child.io.callData.input,9);
      assert.equal(parent.io.callData.input,size);
      runtime.context.objects.ownKeys=forbidden;
      parent.resume(4);
      runtime.context.objects.ownKeys=ownKeys;
      assert.equal(parent.io.callData.input,4);
    }finally{
      effects.prepareCopy=prepare;effects.S.write=write;runtime.context.objects.ownKeys=ownKeys;
    }
    child!.resume(null);parent.resume(null);
    assert.deepEqual(child!.result.value,[size,9,size-1]);
    assert.deepEqual(parent.result.value,[size,4,size-1]);
    child!.dispose();parent.dispose();
  }
});
test('an unused static export enlarges Program code without enlarging a paused Context', () => {
  const snapshots: string[] = [];
  const codeBytes: number[] = [];
  for (const size of [0, 65_536]) {
    const marker = 'STATIC_ONLY_' + 'x'.repeat(size);
    const code = artifact(`export const unused=${JSON.stringify(marker)};
      export const program={schemas:{},async run(_,io){await io.call({port:'step',input:null});return 7}};`);
    codeBytes.push(Buffer.byteLength(code.code));
    const execution = new ProgramExecution(code);
    execution.start(null);
    assert.equal(execution.result.status, 0);
    const snapshot = execution.snapshot();
    assert.equal(snapshot.includes(marker), false);
    snapshots.push(snapshot);
    const branch = execution.fork();
    branch.resume(null);
    assert.equal(branch.result.value, 7);
    branch.dispose();
    execution.dispose();
  }
  assert.ok(codeBytes[1]! - codeBytes[0]! > 65_536);
  assert.equal(Buffer.byteLength(snapshots[0]!), Buffer.byteLength(snapshots[1]!));
});
test('external data keys named __proto__ remain own data across IO, fork and restore', () => {
  const code = artifact(`function inspect(value){return [
    Object.hasOwn(value,'__proto__'),Object.getPrototypeOf(value)===Object.prototype,value.__proto__.tag,
    Object.hasOwn(value.values,'__proto__'),Object.getPrototypeOf(value.values)===Array.prototype,
    value.values.__proto__.tag,value.values[0]];}
    export const program={schemas:{},async run(setup,io){
      const before=inspect(setup),reply=await io.call({port:'step',input:null});
      return [before,inspect(reply)];}};`);
  function data(tag: string) {
    const value = JSON.parse(`{"__proto__":{"tag":"${tag}"},"values":[7]}`);
    Object.defineProperty(value.values, '__proto__', {
      value: { tag: tag + '-array' }, enumerable: true, writable: true, configurable: true
    });
    return value;
  }
  const parent = new ProgramExecution(code); parent.start(data('setup'));
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const [instance, tag] of [[parent, 'parent'], [fork, 'fork'], [restored, 'restore']] as const) {
    instance.resume(data(tag));
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, [
      [true, true, 'setup', true, true, 'setup-array', 7],
      [true, true, tag, true, true, tag + '-array', 7]
    ]);
  }
});
test('compiler function flags agree with runtime flags without sharing semantic bits', () => {
  const scope = createRequire(import.meta.url)('@effectful/core/v2/scope');
  const execution = new ProgramExecution(artifact('export const program={schemas:{},run(){return 0}}'));
  const flags = execution.loaded.effects.State.Flag;
  const allocated = new Set<number>();
  for (const [name, value] of Object.entries(flags)) {
    if (typeof value !== 'number') continue;
    assert.equal(value > 0 && (value & (value - 1)) === 0, true, name);
    assert.equal(allocated.has(value), false, name);
    allocated.add(value);
    if (Object.hasOwn(scope, name + '_FLAG')) assert.equal(scope[name + '_FLAG'], value, name);
  }
  assert.notEqual(scope.METHOD_FUNCTION_FLAG, flags.EXCEPTION_BOUNDARY);
});
test('projected export namespaces preserve inherited state and extensibility through repeated restoration', () => {
  const code = artifact(`export const holder=Object.create({x:41});
    export const program={schemas:{},async run(n,io){
      await io.call({port:'step',input:0});return [holder.x,Object.isExtensible(holder)];}};
    Object.preventExtensions(holder);`);
  const parent = new ProgramExecution(code); parent.start(null);
  const branch = parent.fork(), restored = new ProgramExecution(code);
  restored.restore(parent.snapshot());
  const again = new ProgramExecution(code); again.restore(restored.snapshot());
  for (const execution of [parent, branch, restored, again]) {
    execution.resume(null);
    assert.equal(execution.result.status, 1);
    assert.deepEqual(execution.result.value, [41,false]);
  }
});
test('Program registration is shared; fork/restore copy Context without initializing source or serializing unused exports', () => {
  const code = artifact(`let count=0;export const unused={marker:'unused-export-must-not-be-in-snapshot'};
    export const program={schemas:{},async run(n,io){count++;let shared={n};const alias=shared;
      shared.self=shared;const response=await io.call({port:'step',input:count});
      alias.n+=response;return [count,shared.n,shared===alias,shared.self===shared];}};`);
  const a = new ProgramExecution(code), b = new ProgramExecution(code);
  assert.strictEqual(a.loaded, b.loaded);
  assert.equal(a.loaded.statistics.initializations, 0);
  a.start(3); b.start(9);
  assert.equal(a.loaded.statistics.initializations, 2);
  const snapshot = a.snapshot();
  assert.doesNotMatch(snapshot, /unused-export-must-not-be-in-snapshot/);
  assert.deepEqual(Object.keys(JSON.parse(snapshot)).sort(), ['context', 'layout']);
  // Fork may not fall back to persistent text serialization.
  a.snapshot = () => { throw Error('fork used persistence'); };
  a.loaded.initializeContext = () => { throw Error('fork/restore initialized source'); };
  const branch = a.fork(), restored = new ProgramExecution(code);
  restored.restore(snapshot);
  assert.strictEqual(branch.loaded, a.loaded);
  assert.strictEqual(restored.loaded, a.loaded);
  assert.equal(a.loaded.statistics.initializations, 2);
  for (const [execution, reply, expected] of [[a,1,4],[b,2,11],[branch,4,7],[restored,5,8]] as const) {
    execution.resume(reply);
    assert.deepEqual(execution.result.value, [1,expected,true,true]);
  }
  assert.equal(a.loaded.statistics.initializations, 2);
});

test('setup and IO reply retain the program intrinsic prototypes across fork and restore', () => {
  const code = artifact(`export const program={schemas:{},async run(setup,io){
    const before=[setup instanceof Object,setup.list instanceof Array,
      Object.getPrototypeOf(setup)===Object.prototype,Object.getPrototypeOf(setup.list)===Array.prototype];
    const reply=await io.call({port:'step',input:before});
    return [...before,reply instanceof Object,reply.list instanceof Array,
      Object.getPrototypeOf(reply)===Object.prototype,Object.getPrototypeOf(reply.list)===Array.prototype];}};`);
  const parent = new ProgramExecution(code);
  parent.start({list:[1]});
  assert.deepEqual(parent.io.callData.input,[true,true,true,true]);
  const branch=parent.fork(),restored=new ProgramExecution(code);
  restored.restore(parent.snapshot());
  for(const execution of [parent,branch,restored]){
    execution.resume({list:[2]});
    assert.deepEqual(execution.result.value,[true,true,true,true,true,true,true,true]);
  }
});

test('instances sharing one Program keep mutable global bindings in their own Context', () => {
  const code = artifact(`export const program={schemas:{},async run(setup,io){
    globalThis.marker={value:setup};
    await io.call({port:'step',input:globalThis.marker.value});
    globalThis.marker.value+=1;
    return globalThis.marker.value;
  }};`);
  const first = new ProgramExecution(code), second = new ProgramExecution(code);
  assert.strictEqual(first.loaded, second.loaded);
  first.start(2); second.start(7);
  assert.equal(first.io.callData.input, 2);
  assert.equal(second.io.callData.input, 7);
  const branch = first.fork(), restored = new ProgramExecution(code);
  restored.restore(first.snapshot());
  for (const [execution, expected] of [[first, 3], [second, 8], [branch, 3], [restored, 3]] as const) {
    execution.resume(null);
    assert.equal(execution.result.status, 1);
    assert.equal(execution.result.value, expected);
  }
});

test('namespace aliases and compound assignment use the restored Context, including computed access', () => {
  for (const access of ['holder.counter','alias.counter', 'holder[key]']) {
    const code = artifact(`const key='counter',holder={counter:0},alias=holder;export const program={schemas:{},async run(n,io){
      ${access}=n;${access}+=await io.call({port:'step',input:n});return ${access};}};`);
    const parent = new ProgramExecution(code);parent.start(3);
    const branch = parent.fork(), restored = new ProgramExecution(code);restored.restore(parent.snapshot());
    parent.resume(1);branch.resume(4);restored.resume(8);
    assert.equal(parent.result.value,4);assert.equal(branch.result.value,7);assert.equal(restored.result.value,11);
  }
});

test('a run method using its receiver retains that data and its aliases across the boundary', () => {
  const code = artifact(`export const program={schemas:{},count:0,async run(n,io){
    this.count=n;this.count+=await io.call({port:'step',input:n});return [this.count,this===program];}};`);
  const parent = new ProgramExecution(code);parent.start(3);
  const branch = parent.fork();branch.resume(4);parent.resume(1);
  assert.deepEqual(parent.result.value,[4,true]);assert.deepEqual(branch.result.value,[7,true]);
});


test('rebound module state stays in each Context rather than the shared factory closure', () => {
  const code = artifact(`let state;export const program={schemas:{},async run(n,io){state={counter:n};
    const answer=await io.call({port:'step',input:n});state.counter+=answer;return state.counter;}};`);
  const a=new ProgramExecution(code),b=new ProgramExecution(code);a.start(3);b.start(9);
  const branch=a.fork();b.resume(10);a.resume(1);branch.resume(4);
  assert.equal(a.result.value,4);assert.equal(b.result.value,19);assert.equal(branch.result.value,7);
});


test('Context snapshots reject pre-start and failed executions and reject legacy layouts', () => {
  const code = artifact(`export const program={schemas:{},async run(n,io){
    await io.call({port:'step',input:n});throw new Error('failed');}};`);
  const instance = new ProgramExecution(code);
  assert.throws(() => instance.snapshot(), /not saveable/);
  instance.start(1);
  instance.resume(2);
  assert.throws(() => instance.snapshot(), /not saveable/);
  assert.throws(() => instance.restore('{}'), /Incompatible Context/);
  const legacy = { ...code } as any;
  delete legacy.contextLayout;
  assert.throws(() => decode(new TextEncoder().encode(JSON.stringify(legacy))), /Incompatible artifact/);
});


test('a module binding explicitly cleared to null or undefined survives fork and restore', () => {
  for (const literal of ['null', 'undefined']) {
    const code = artifact(`let state;export const program={schemas:{},async run(n,io){
      state=${literal};await io.call({port:'step',input:n});return state;}};`);
    const parent = new ProgramExecution(code);
    parent.start(1);
    const branch = parent.fork(), restored = new ProgramExecution(code);
    restored.restore(parent.snapshot());
    for (const execution of [parent, branch, restored]) {
      execution.resume(2);
      assert.strictEqual(execution.result.value, literal === 'null' ? null : undefined);
    }
  }
});

test('repeated restore replaces storage roots and failed decoding leaves the running Context intact',()=>{
  const code=artifact(`export const program={schemas:{},async run(_,io){
    const state={value:3},buffer=new Uint8Array([4,5]);
    const reply=await io.call({port:'step',input:state.value});
    return state.value+buffer[0]+reply;
  }};`);
  const instance=new ProgramExecution(code);instance.start(null);
  const snapshot=instance.snapshot(),runtime=instance as any;
  const sizes=()=>[runtime.context.objects.states.size,runtime.context.memory.records.size,
    runtime.context.intrinsicSlots.size];
  instance.restore(snapshot);const expected=sizes(),initializations=instance.loaded.statistics.initializations;
  for(let index=0;index<8;index++){
    const previous=runtime.context;
    instance.restore(snapshot);
    assert.notStrictEqual(runtime.context.objects,previous.objects);
    assert.notStrictEqual(runtime.context.intrinsicSlots,previous.intrinsicSlots);
    assert.deepEqual(sizes(),expected);
  }
  const previous=runtime.context;
  const invalid=instance.loaded.enter(previous,()=>instance.loaded.effects.S.write(instance.loaded.record()));
  assert.throws(()=>instance.restore(JSON.stringify({layout:'lexical-cells',context:invalid})),/Invalid Context/);
  assert.strictEqual(runtime.context,previous);
  assert.deepEqual(sizes(),expected);
  assert.equal(instance.loaded.statistics.initializations,initializations);
  instance.resume(6);assert.equal(instance.result.value,13);
  instance.dispose();
});

test('internal await reactions do not accumulate adoption listeners on the outer result',()=>{
  const code=artifact(`export const program={schemas:{},async run(_,io){
    let total=0;for(let round=0;round<64;round++)total+=await io.call({port:'step',input:round});return total;
  }};`);
  const parent=new ProgramExecution(code);parent.start(null);
  const branches=[parent,parent.fork(),parent.fresh()];branches[2]!.restore(parent.snapshot());
  for(const [index,instance] of branches.entries()){
    const runtime=instance as any;
    let smallest=Infinity,largest=0;
    for(let round=0;round<64;round++){
      instance.loaded.enter(runtime.context,()=>{
        assert.equal(instance.loaded.effects.stateOf(runtime.context.result).listeners,null,
          'An internal await reaction must not subscribe its unused child promise to the outer result');
      });
      const size=Buffer.byteLength(instance.snapshot());smallest=Math.min(smallest,size);largest=Math.max(largest,size);
      instance.resume(index+1);
    }
    assert.equal(instance.result.value,64*(index+1));
    assert.ok(largest-smallest<256,`Constant live state grew by ${largest-smallest} snapshot bytes`);
    instance.dispose();
  }
});
