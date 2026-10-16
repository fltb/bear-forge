import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('a loaded Program does not retain a disposed Instance global', () => {
  const source = `
    import { compileJavaScript } from '@bear-forge/compiler';
    import { ProgramExecution, decode } from './src/execution.ts';
    import { setImmediate } from 'node:timers/promises';
    const artifact = decode(compileJavaScript(
      'export const program={schemas:{},async run(_,io){await io.call({port:"step",input:null});return 1}};'
    ).content);
    function pausedGlobals() {
      const instance = new ProgramExecution(artifact);
      instance.start(null);
      if (instance.result.status !== 0) throw Error('Expected an IO wait');
      const branch = instance.fork();
      const restored = new ProgramExecution(artifact);
      restored.restore(instance.snapshot());
      const globals = [instance, branch, restored].map(value => new WeakRef(value.context.globals));
      const program = instance.loaded;
      instance.dispose();
      branch.dispose();
      restored.dispose();
      return { globals, program };
    }
    const retained = pausedGlobals();
    for (let attempt = 0; attempt < 20 && retained.globals.some(value => value.deref()); attempt++) {
      await setImmediate();
      globalThis.gc();
      new Array(10000).fill(attempt);
    }
    if (!retained.program || retained.globals.some(value => value.deref()))
      throw Error('Program retained a disposed Instance global');
  `;
  const child = spawnSync(process.execPath,
    ['--expose-gc', '--experimental-strip-types', '--input-type=module', '-e', source],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message || 'Child failed');
});

test('live Context releases transient identities while retained branches survive native GC',()=>{
  const source=`
    import assert from 'node:assert/strict';
    import {compileJavaScript} from '@bear-forge/compiler';
    import {ProgramExecution,decode} from './src/execution.ts';
    import {setImmediate} from 'node:timers/promises';
    const code=decode(compileJavaScript(\`export const program={schemas:{},async run(_,io){
      const state={value:3},bytes=new Uint8Array([4]);state.self=state;
      const map=new Map([[state,bytes]]),weak=new WeakMap([[state,bytes]]);
      const read=()=>state.value;
      const iterator=(function*(){yield state.value;yield map.get(state)[0];})();iterator.next();
      for(let round=0;round<24;round++){
        for(let index=0;index<128;index++){const temporary={value:index};if(temporary.value!==index)throw Error();}
        const reply=await io.call({port:'step',input:round});
        state.value=reply;bytes[0]=reply+1;
      }
      return [read(),map.get(state)[0],weak.get(state)[0],iterator.next().value,state.self===state];
    }};\`).content);
    const parent=new ProgramExecution(code,10000000);parent.start(null);
    const child=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    const instances=[parent,child,restored];
    for(let round=0;round<24;round++){
      await setImmediate();globalThis.gc();await setImmediate();await setImmediate();
      for(const [index,instance]of instances.entries()){
        assert.equal(instance.io.callData.input,round);
        assert.ok(instance.context.objects.states.size<200,'Transient object records accumulated');
        assert.ok(instance.context.intrinsicSlots.size<200,'Transient internal-slot records accumulated');
        instance.resume(index+5);
      }
    }
    for(const [index,instance]of instances.entries()){
      assert.deepEqual(instance.result.value,[index+5,index+6,index+6,index+6,true]);
      const context=instance.context;instance.dispose();
      assert.equal(context.objects.states.size,0);
      assert.equal(context.intrinsicSlots.size,0);
      assert.equal(context.memory.records.size,0);
      assert.equal(context.collectionMemory.records.size,0);
      assert.equal(context.weakMemory.roots.size,0);
      assert.equal(context.jobs.length,0);
    }
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--experimental-strip-types','--input-type=module','-e',source],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr||child.error?.message||'GC child failed');
});

test('logical property replacement releases a configurable native shell baseline',()=>{
  const source=`
    import assert from 'node:assert/strict';
    import {CowHeap} from './src/cow-heap.ts';
    import {setImmediate} from 'node:timers/promises';
    const heap=new CowHeap();
    function create(){
      const payload={bytes:new Uint8Array(1000000)},holder={payload};
      heap.register(holder);
      heap.defineProperty(holder,'payload',{value:null});
      return {holder,reference:new WeakRef(payload)};
    }
    const retained=create();
    for(let attempt=0;attempt<30;attempt++){
      await setImmediate();globalThis.gc();await setImmediate();
      if(retained.reference.deref()===undefined)break;
    }
    assert.equal(retained.reference.deref(),undefined);
    assert.equal(heap.getOwnPropertyDescriptor(retained.holder,'payload').value,null);
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--experimental-strip-types','--input-type=module','-e',source],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr||child.error?.message||'GC child failed');
});

test('replaced nonconfigurable writable native fields release obsolete branch payloads',()=>{
  const source=`
    import assert from 'node:assert/strict';
    import {CowHeap} from './src/cow-heap.ts';
    import {setImmediate} from 'node:timers/promises';
    function create(callable){
      const heap=new CowHeap(),payload={bytes:new Uint8Array(1000000)};
      const holder=callable?function Example(){}:{},key=callable?'prototype':'payload';
      Object.defineProperty(holder,key,{value:payload,writable:true,configurable:false});
      heap.register(holder);const child=heap.fork();
      assert.equal(heap.set(holder,key,null,holder,Reflect.apply),true);
      assert.strictEqual(child.getOwnPropertyDescriptor(holder,key).value,payload);
      child.clear();
      return {heap,holder,key,reference:new WeakRef(payload)};
    }
    const retained=[create(false),create(true)];
    for(let attempt=0;attempt<30;attempt++){
      await setImmediate();globalThis.gc();await setImmediate();
      if(retained.every(item=>item.reference.deref()===undefined))break;
    }
    for(const item of retained){
      assert.ok(item.reference.deref()===undefined,'Native shell retained replaced writable reference');
      assert.equal(item.heap.getOwnPropertyDescriptor(item.holder,item.key).value,null);
    }
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--experimental-strip-types','--input-type=module','-e',source],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr||child.error?.message||'GC child failed');
});

test('controlled Object.create releases replaced prototypes after the last old branch closes',()=>{
  const source=`
    import assert from 'node:assert/strict';
    import {CowHeap} from './src/cow-heap.ts';
    import {createOperations} from '@bear-forge/runtime';
    import {setImmediate} from 'node:timers/promises';
    function create(){
      const heap=new CowHeap(),prototype={payload:new Uint8Array(1000000)};
      heap.register(prototype);
      const ops=createOperations({objects:()=>heap,allocate:value=>heap.register(value)});
      const holder=ops.invoke(Object.create,Object,[prototype]);
      const child=heap.fork();
      assert.equal(heap.setPrototypeOf(holder,null),true);
      assert.strictEqual(child.getPrototypeOf(holder),prototype);
      assert.equal(child.get(holder,'payload',holder,Reflect.apply).length,1000000);
      child.clear();
      return {heap,holder,reference:new WeakRef(prototype)};
    }
    const retained=create();
    for(let attempt=0;attempt<30;attempt++){
      await setImmediate();globalThis.gc();await setImmediate();
      if(retained.reference.deref()===undefined)break;
    }
    assert.ok(retained.reference.deref()===undefined,'Native prototype retained an obsolete branch payload');
    assert.equal(retained.heap.getPrototypeOf(retained.holder),null);
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--experimental-strip-types','--input-type=module','-e',source],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr||child.error?.message||'GC child failed');
});

test('shared Program releases constructed instances and their prototypes when all branches close',()=>{
  const source=`
    import assert from 'node:assert/strict';
    import {compileJavaScript} from '@bear-forge/compiler';
    import {ProgramExecution,decode} from './src/execution.ts';
    import {setImmediate} from 'node:timers/promises';
    const code=decode(compileJavaScript(\`export const program={schemas:{},async run(_,io){
      function make(){function C(){} C.prototype.payload=new Uint8Array(1000000);return new C();}
      globalThis.saved=make();await io.call({port:'step',input:null});return null;
    }};\`).content);
    function create(){
      const parent=new ProgramExecution(code,10000000);parent.start(null);
      assert.equal(parent.result.status,0);
      const holder=parent.loaded.enter(parent.context,()=>parent.loaded.read(parent.context.globals,'saved'));
      const prototype=parent.context.objects.getPrototypeOf(holder);
      const child=parent.fork();
      assert.strictEqual(child.context.objects.getPrototypeOf(holder),prototype);
      const references=[holder,prototype].map(value=>new WeakRef(value));
      parent.dispose();child.dispose();
      return {program:parent.loaded,references};
    }
    const retained=create();
    for(let attempt=0;attempt<30;attempt++){
      await setImmediate();globalThis.gc();await setImmediate();
      if(retained.references.every(reference=>reference.deref()===undefined))break;
    }
    assert.ok(retained.program);
    assert.ok(retained.references.every(reference=>reference.deref()===undefined),
      'Shared Program retained a disposed constructor instance or prototype');
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--experimental-strip-types','--input-type=module','-e',source],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr||child.error?.message||'GC child failed');
});

for(const restored of [false,true]) for(const [label,constructor] of [
  ['ordinary','function C(){}'],
  ['literal','function C(){return {__proto__:C.prototype};}'],
  ...['Array','Map','Set','WeakMap','WeakSet','Number','String','Boolean','RegExp','Error','SyntaxError','ArrayBuffer','Uint8Array']
    .map(base=>[base,'class C extends '+base+' {}']),
  ['DataView','class C extends DataView {constructor(){super(new ArrayBuffer(8));}}'],
]) test('live '+label+' instances release replaced prototypes after old branches close (restored '+restored+')',()=>{
  const source=`
    import assert from 'node:assert/strict';
    import {compileJavaScript} from '@bear-forge/compiler';
    import {ProgramExecution,decode} from './src/execution.ts';
    import {setImmediate} from 'node:timers/promises';
    const code=decode(compileJavaScript(\`export const program={schemas:{},async run(_,io){
      function make(){${constructor} C.prototype.payload=new Uint8Array(1000000);return new C();}
      const holder=make();globalThis.saved=holder;await io.call({port:'step',input:null});
      Object.setPrototypeOf(holder,null);await io.call({port:'step',input:null});return null;
    }};\`).content);
    function create(){
      let parent=new ProgramExecution(code,10000000);parent.start(null);
      assert.equal(parent.result.status,0);
      if(${restored}){
        const next=parent.fresh();next.restore(parent.snapshot());parent.dispose();parent=next;
      }
      const holder=parent.loaded.enter(parent.context,()=>parent.loaded.read(parent.context.globals,'saved'));
      const prototype=parent.context.objects.getPrototypeOf(holder),reference=new WeakRef(prototype);
      const child=parent.fork();parent.resume(null);
      assert.equal(parent.result.status,0);
      assert.equal(parent.context.objects.getPrototypeOf(holder),null);
      assert.strictEqual(child.context.objects.getPrototypeOf(holder),prototype);
      const payload=child.loaded.enter(child.context,()=>child.loaded.read(holder,'payload'));
      assert.equal(child.context.memory.view(payload).byteLength,1000000);
      child.dispose();return {parent,holder,reference};
    }
    const retained=create();
    for(let attempt=0;attempt<30;attempt++){
      await setImmediate();globalThis.gc();await setImmediate();
      if(retained.reference.deref()===undefined)break;
    }
    assert.ok(retained.reference.deref()===undefined,'Constructed identity retained its obsolete prototype');
    assert.equal(retained.parent.context.objects.getPrototypeOf(retained.holder),null);
    retained.parent.dispose();
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--experimental-strip-types','--input-type=module','-e',source],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr||child.error?.message||'GC child failed');
});

test('Program cache does not retain code after all execution handles are released',()=>{
  const source=`
    import assert from 'node:assert/strict';
    import {compileJavaScript} from '@bear-forge/compiler';
    import {ProgramExecution,decode} from './src/execution.ts';
    import {setImmediate} from 'node:timers/promises';
    const code=decode(compileJavaScript('export const program={schemas:{},async run(_,io){await io.call({port:"step",input:null});return null;}};').content);
    function create(){
      const parent=new ProgramExecution(code);parent.start(null);
      assert.equal(parent.result.status,0);
      const child=parent.fork();assert.strictEqual(child.loaded,parent.loaded);
      const reference=new WeakRef(parent.loaded);
      child.dispose();parent.dispose();return reference;
    }
    const reference=create();
    for(let attempt=0;attempt<30;attempt++){
      await setImmediate();globalThis.gc();await setImmediate();
      if(reference.deref()===undefined)break;
    }
    assert.ok(reference.deref()===undefined,'Program cache retained unused code');
    const next=new ProgramExecution(code);next.start(null);
    assert.equal(next.result.status,0);next.dispose();
  `;
  const child=spawnSync(process.execPath,['--expose-gc','--experimental-strip-types','--input-type=module','-e',source],
    {cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr||child.error?.message||'GC child failed');
});

test('a missing-property cache does not retain a replaced mutable prototype', () => {
  const source = `
    import assert from 'node:assert/strict';
    import {CowHeap} from './src/cow-heap.ts';
    import {setImmediate} from 'node:timers/promises';
    const invoke=(fn,self,args)=>Reflect.apply(fn,self,args);
    function prepare(){
      const heap=new CowHeap(),prototype=heap.create(),object=heap.create(prototype),cache={slots:[]};
      assert.equal(heap.get(object,'missing',object,invoke,cache),undefined);
      const reference=new WeakRef(prototype);
      heap.setPrototypeOf(object,null);
      return {heap,object,cache,reference};
    }
    const retained=prepare();
    for(let attempt=0;attempt<20&&retained.reference.deref();attempt++){
      await setImmediate();globalThis.gc();new Array(10000).fill(attempt);
    }
    assert.equal(retained.reference.deref(),undefined,'cached prototype remains strongly reachable');
    assert.equal(retained.heap.get(retained.object,'missing',retained.object,invoke,retained.cache),undefined);
  `;
  const child = spawnSync(process.execPath,
    ['--expose-gc', '--experimental-strip-types', '--input-type=module', '-e', source],
    {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000});
  assert.equal(child.status, 0, child.stderr || child.error?.message || 'Child failed');
});
