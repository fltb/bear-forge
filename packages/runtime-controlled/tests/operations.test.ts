import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

test('native iterable and apply failures preserve V8 value categories after IO and branching', async () => {
  async function run(_setup: unknown, io: {call(input: unknown): Promise<unknown>}) {
    await io.call({port:'step',input:null});
    const failures: [string, string][] = [];
    const source = function source() {}, target = () => 1;
    const attempts: (() => unknown)[] = [
      () => Object.fromEntries(source as any),
      () => (Object as any).groupBy(source, () => 1),
      () => new Map(source as any), () => new Set(source as any),
    ];
    for (const list of [0, false, 'x', 1n, Symbol('list')]) {
      attempts.push(() => target.apply(null, list as any));
      attempts.push(() => Reflect.apply(target, null, list as any));
      attempts.push(() => Reflect.construct(Array, list as any));
    }
    for (const attempt of attempts) {
      try { attempt(); failures.push(['', '']); }
      catch (error) { failures.push([(error as Error).name, (error as Error).message]); }
    }
    return failures;
  }
  const expected = await run(null, {call: async () => null});
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('primitive receiver failures from toString match V8 after IO and branch restoration', () => {
  const source = `export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});
    const failures=[];
    for(const method of [Error.prototype.toString,RegExp.prototype.toString])
      for(const receiver of [1,'x',true,Symbol('s')]){
        try{method.call(receiver);failures.push(null)}
        catch(error){failures.push([error.name,error.message])}
      }
    return failures;
  }};`;
  const expected: (string[] | null)[] = [];
  for (const method of [Error.prototype.toString, RegExp.prototype.toString])
    for (const receiver of [1, 'x', true, Symbol('s')]) {
      try { Reflect.apply(method, receiver, []); expected.push(null); }
      catch (error) { expected.push([(error as Error).name, (error as Error).message]); }
    }
  const artifact = decode(compileJavaScript(source).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('branded native methods fail before parameter conversion after IO and branch restoration', () => {
  const source = `export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});
    const typed=Object.getPrototypeOf(Uint8Array.prototype);
    const methods=[RegExp.prototype[Symbol.match],RegExp.prototype[Symbol.matchAll],
      RegExp.prototype[Symbol.replace],RegExp.prototype[Symbol.search],RegExp.prototype[Symbol.split],
      ArrayBuffer.prototype.slice,typed.filter,typed.map,typed.slice,typed.subarray];
    const result=[];
    for(const method of methods)for(const receiver of [null,undefined,1,'x',true,Symbol('s')]){
      let conversions=0;
      const argument={toString(){conversions++;return 'x'},valueOf(){conversions++;return 1}};
      try{method.call(receiver,argument,argument);result.push(null)}
      catch(error){result.push([error.name,error.message,conversions])}
    }
    return result;
  }};`;
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const methods = [RegExp.prototype[Symbol.match], RegExp.prototype[Symbol.matchAll],
    RegExp.prototype[Symbol.replace], RegExp.prototype[Symbol.search], RegExp.prototype[Symbol.split],
    ArrayBuffer.prototype.slice, typed.filter, typed.map, typed.slice, typed.subarray];
  const expected: (null | [string, string, number])[] = [];
  for (const method of methods) for (const receiver of [null, undefined, 1, 'x', true, Symbol('s')]) {
    let conversions = 0;
    const argument = {toString() { conversions++; return 'x'; }, valueOf() { conversions++; return 1; }};
    try { Reflect.apply(method, receiver, [argument, argument]); expected.push(null); }
    catch (error) { expected.push([(error as Error).name, (error as Error).message, conversions]); }
  }
  const artifact = decode(compileJavaScript(source).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('nullish typed-array set source preserves offset conversion after IO and branching', () => {
  const source = `export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});
    const result=[];
    for(const source of [null,undefined]){
      const trace=[],target=new Uint8Array([4,5]);
      const offset={valueOf(){trace.push('offset');return 1}};
      let failure=null;
      try{target.set(source,offset)}catch(error){failure=[error.name,error.message]}
      result.push({trace,failure,target:[...target]});
    }
    return result;
  }};`;
  const expected = [null, undefined].map(source => {
    const trace: string[] = [], target = new Uint8Array([4, 5]);
    const offset = { valueOf() { trace.push('offset'); return 1; } };
    let failure: [string, string] | null = null;
    try { (target as any).set(source, offset); }
    catch (error) { failure = [(error as Error).name, (error as Error).message]; }
    return {trace, failure, target: [...target]};
  });
  const artifact = decode(compileJavaScript(source).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('long primitive property keys exhaust budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    const key='x'.repeat(4096),object={};object[key]=7;
    await io.call({port:'step',input:null});
    if(setup.method==='noop')return true;
    return object[key];
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+2;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start({method:'read'});assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('property-key coercion keeps V8 read/write timing across IO and branches',()=>{
  const source=`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const trace=[],object={x:1};
    const key={[Symbol.toPrimitive](){trace.push('key');return 'x';}};
    const rhs=()=>{trace.push('rhs');return 2;};
    if(setup.method==='simple')object[key]=rhs();
    else if(setup.method==='compound')object[key]+=rhs();
    else object[key]++;
    return [trace,object.x];
  }};`;
  const artifact=decode(compileJavaScript(source).content);
  for(const [method,expected] of [
    ['simple',[['rhs','key'],2]],
    ['compound',[['key','rhs','key'],3]],
    ['update',[['key','key'],2]],
  ] as const){
    const parent=new ProgramExecution(artifact);
    parent.start({method});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      instance.resume(null);
      assert.equal(instance.result.status,1);
      assert.deepEqual(instance.result.value,expected);
      instance.dispose();
    }
  }
});

test('computed class names charge retained text after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    const key=Symbol('x'.repeat(4096));
    await io.call({port:'step',input:null});
    if(setup.method==='noop')return true;
    return ({[key]:class {}})[key].name.length;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+2;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start({method:'class'});assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('typeof inherited instance global avoids duplicate membership work after IO',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    let prototype={inherited:7};
    for(let index=0;index<2048;index++)prototype=Object.create(prototype);
    Object.setPrototypeOf(globalThis,prototype);
    if(setup.method==='noop')return true;
    return typeof inherited;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+300;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start({method:'typeof'});assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,1,`status=${String(instance.result.status)} value=${String(instance.result.value)}`);
    assert.equal(instance.result.value,'number');
    instance.dispose();
  }
});

test('construction charges inherited newTarget lookup after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    function Target(){}
    const bound=Target.bind(null);
    let prototype={prototype:Array.prototype};
    for(let index=0;index<2048;index++)prototype=Object.create(prototype);
    Object.setPrototypeOf(bound,prototype);
    if(setup.method==='noop')return true;
    return Reflect.construct(Array,[],bound).length;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start({method:'construct'});assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true,`${String(instance.result.status)} ${String(instance.result.value)}`);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('implicit constructor prototype getter cannot call ambient time',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    function Target(){}
    const bound=Target.bind(null);
    Object.setPrototypeOf(bound,Object.defineProperty({},'prototype',{get(){return Date.now();}}));
    return Reflect.construct(Array,[],bound).length;
  }};`).content);
  const parent=new ProgramExecution(artifact,100_000);
  parent.start(null);assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,2);
    assert.match(String(instance.result.value),/Ambient or dynamic execution is not admitted/);
    instance.dispose();
  }
});

test('legacy descriptor lookup exhausts budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const root={};Object.defineProperty(root,'field',{get(){return 1;},set(value){}});
    let leaf=root;for(let index=0;index<2048;index++)leaf=Object.create(leaf);
    if(setup.method==='noop')return true;
    if(setup.method==='get')return Object.prototype.__lookupGetter__.call(leaf,'field')!==undefined;
    return Object.prototype.__lookupSetter__.call(leaf,'field')!==undefined;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['get','set']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,`${method}: ${String(instance.result.status)} ${String(instance.result.value)}`);
      assert.notEqual(instance.result.status,1);
      instance.dispose();
    }
  }
});

test('prototype membership queries exhaust budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    function Top(){}
    const top=setup.method==='instanceof'?Top.prototype:{};let leaf=top;
    for(let index=0;index<2048;index++)leaf=Object.create(leaf);
    if(setup.method==='noop')return true;
    if(setup.method==='instanceof')return leaf instanceof Top;
    return Object.prototype.isPrototypeOf.call(top,leaf);
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['query','instanceof']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,`${method}: ${String(instance.result.status)} ${String(instance.result.value)} remaining=${String((instance as any).context.remaining)}`);
      assert.notEqual(instance.result.status,1);
      instance.dispose();
    }
  }
});

test('inherited property access exhausts budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const top={x:1};let leaf=top;
    for(let index=0;index<2048;index++)leaf=Object.create(leaf);
    if(setup.method==='noop')return true;
    if(setup.method==='get')return leaf.x;
    if(setup.method==='has')return 'x' in leaf;
    if(setup.method==='set')return leaf.x=2;
    if(setup.method==='reflectGet')return Reflect.get(leaf,'x');
    if(setup.method==='reflectHas')return Reflect.has(leaf,'x');
    return Reflect.set(leaf,'x',2);
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['get','has','set','reflectGet','reflectHas','reflectSet']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,`${method}: ${String(instance.result.status)} ${String(instance.result.value)} remaining=${String((instance as any).context.remaining)}`);
      assert.notEqual(instance.result.status,1);
      instance.dispose();
    }
  }
});

test('sparse array absence checks exhaust budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    let prototype=Array.prototype;
    for(let index=0;index<2048;index++)prototype=Object.create(prototype);
    const source=new Array(1);
    Object.setPrototypeOf(source,prototype);
    source.constructor=Array;
    if(setup.method==='noop')return true;
    if(setup.method==='slice')return Array.prototype.slice.call(source).length;
    if(setup.method==='flat')return Array.prototype.flat.call(source).length;
    return Array.prototype.map.call(source,value=>value).length;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['slice','flat','map']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,`${method}: ${String(instance.result.status)} ${String(instance.result.value)}`);
      assert.notEqual(instance.result.status,1);
      instance.dispose();
    }
  }
});

test('missing instance globals exhaust deep-chain budget after IO',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    let prototype={};
    for(let index=0;index<2048;index++)prototype=Object.create(prototype);
    Object.setPrototypeOf(globalThis,prototype);
    if(setup.method==='noop')return true;
    return typeof absentFromInstance;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start({method:'lookup'});assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true,`${String(instance.result.status)} ${String(instance.result.value)}`);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('native admission checks exhaust deep-chain budget after IO',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const regexp=/x/;let regexpPrototype=RegExp.prototype;
    for(let index=0;index<2048;index++)regexpPrototype=Object.create(regexpPrototype);
    Object.setPrototypeOf(regexp,regexpPrototype);
    const array=[1];let arrayPrototype=Array.prototype;
    for(let index=0;index<2048;index++)arrayPrototype=Object.create(arrayPrototype);
    Object.setPrototypeOf(array,arrayPrototype);
    if(setup.method==='noop')return true;
    if(setup.method==='regexp')return RegExp.prototype[Symbol.match].call(regexp,'x')[0];
    return Array.prototype.map.call(array,value=>value)[0];
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['regexp','array']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,`${method}: ${String(instance.result.status)} ${String(instance.result.value)}`);
      assert.notEqual(instance.result.status,1);
      instance.dispose();
    }
  }
});

test('prototype mutation cycle checks exhaust budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const target={};let prototype=setup.method==='cycle'?target:{};
    for(let index=0;index<2048;index++)prototype=Object.create(prototype);
    if(setup.method==='noop')return true;
    try{
      if(setup.method==='object'||setup.method==='cycle')Object.setPrototypeOf(target,prototype);
      else Reflect.setPrototypeOf(target,prototype);
      return 'success';
    }catch(error){return 'caught';}
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['object','reflect','cycle']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,`${method}: ${String(instance.result.status)} ${String(instance.result.value)}`);
      assert.notEqual(instance.result.status,1);
      instance.dispose();
    }
  }
});

test('function binding charges its internal prototype mutation after IO',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    function target(){}
    let prototype=Function.prototype;
    for(let index=0;index<2048;index++)prototype=Object.create(prototype);
    Object.setPrototypeOf(target,prototype);
    const bind=Function.prototype.bind;
    await io.call({port:'step',input:null});
    if(setup.method==='noop')return true;
    return typeof Reflect.apply(bind,target,[null]);
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start({method:'bind'});assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true,`${String(instance.result.status)} ${String(instance.result.value)}`);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('binding a function with a long name exhausts budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    function target(){}
    Object.defineProperty(target,'name',{value:'x'.repeat(4096)});
    await io.call({port:'step',input:null});
    if(setup.method==='noop')return true;
    return target.bind(null).name.length;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+2;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start({method:'bind'});assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('object literal prototype initialization exhausts budget after IO',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    let prototype={x:1};
    for(let index=0;index<2048;index++)prototype=Object.create(prototype);
    if(setup.method==='noop')return true;
    const value={__proto__:prototype};
    return value.x;
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  const parent=new ProgramExecution(artifact,allowance);
  parent.start({method:'literal'});assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
    assert.equal(instance.fault,true,`${String(instance.result.status)} ${String(instance.result.value)}`);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('object integrity queries exhaust budget after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    const value={};
    for(let index=0;index<2048;index++)value['k'+index]=index;
    Object.freeze(value);
    await io.call({port:'step',input:null});
    if(setup.method==='noop')return true;
    return Object[setup.method](value);
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start({method:'noop'});baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['isFrozen','isSealed']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start({method});assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,method);
      assert.notEqual(instance.result.status,1,method);
      instance.dispose();
    }
  }
});

test('native string and RegExp scans exhaust the budget after IO on every branch', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const source=setup.source;
    if(setup.method==='noop') return source.length>0;
    if(setup.method==='includes') return source.includes('y');
    if(setup.method==='indexOf') return source.indexOf('y');
    if(setup.method==='lastIndexOf') return source.lastIndexOf('y');
    if(setup.method==='trim') return source.trim();
    if(setup.method==='split') return source.split('never');
    if(setup.method==='exec') return /y/.exec(source);
    return source.search(/y/);
  }};`).content);
  for (const method of ['includes', 'indexOf', 'lastIndexOf', 'trim', 'split', 'exec', 'search']) {
    const source = (method === 'trim' ? ' ' : 'x').repeat(409600);
    const baseline = new ProgramExecution(artifact, 1_000_000);
    baseline.start({method:'noop', source}); baseline.resume(null);
    assert.equal(baseline.result.status, 1);
    const allowance = 1_000_000 - (baseline as any).context.remaining + 100;
    baseline.dispose();
    const parent = new ProgramExecution(artifact, allowance); parent.start({method, source});
    assert.equal(parent.result.status, 0);
    const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
    for (const instance of [parent, fork, restored]) {
      try { instance.resume(null); } catch (error) { assert.match(String(error), /budget exceeded/); }
      assert.equal(instance.fault, true, `${method}: ${instance.result.status} ${String(instance.result.value)}`);
      assert.notEqual(instance.result.status, 1, method);
      instance.dispose();
    }
  }
});

test('RegExp construction exhausts pattern-work budget after IO on every branch', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    if(setup.method==='noop') return setup.pattern.length>0;
    if(setup.method==='call') return RegExp(setup.pattern).source.length;
    return new RegExp(setup.pattern).source.length;
  }};`).content);
  const pattern = 'x'.repeat(409600);
  const baseline = new ProgramExecution(artifact, 1_000_000);
  baseline.start({method:'noop', pattern}); baseline.resume(null);
  assert.equal(baseline.result.status, 1);
  const allowance = 1_000_000 - (baseline as any).context.remaining + 100;
  baseline.dispose();
  for (const method of ['call', 'construct']) {
    const parent = new ProgramExecution(artifact, allowance); parent.start({method, pattern});
    assert.equal(parent.result.status, 0);
    const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
    for (const instance of [parent, fork, restored]) {
      try { instance.resume(null); } catch (error) { assert.match(String(error), /budget exceeded/); }
      assert.equal(instance.fault, true, method);
      assert.notEqual(instance.result.status, 1, method);
      instance.dispose();
    }
  }
});

test('binary construction charges fresh backing storage after IO on every branch', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    const source=new Uint8Array(409600);
    await io.call({port:'step',input:null});
    if(setup.method==='buffer') return new ArrayBuffer(409600).byteLength;
    if(setup.method==='length') return new Uint8Array(409600).byteLength;
    if(setup.method==='copy') return new Uint8Array(source).byteLength;
    return new Uint8Array(source.buffer).byteLength;
  }};`).content);
  for (const method of ['buffer', 'length', 'copy', 'view']) {
    const probe = new ProgramExecution(artifact, 1_000_000); probe.start({method});
    assert.equal(probe.result.status, 0);
    const startCost = 1_000_000 - (probe as any).context.remaining;
    probe.dispose();
    const parent = new ProgramExecution(artifact, startCost + 100); parent.start({method});
    assert.equal(parent.result.status, 0);
    const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
    for (const instance of [parent, fork, restored]) {
      try { instance.resume(null); } catch (error) {
        if (method === 'view') throw error;
        assert.match(String(error), /budget exceeded/);
      }
      if (method === 'view') {
        assert.equal(instance.result.status, 1, String(instance.result.value));
        assert.equal(instance.result.value, 409600);
      } else {
        assert.equal(instance.fault, true, method);
        assert.notEqual(instance.result.status, 1, method);
      }
      instance.dispose();
    }
  }
});

test('copying typed-array methods exhaust the budget after IO on every branch', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    const source=new Uint8Array(409600);
    await io.call({port:'step',input:null});
    if(setup.method==='toReversed') return source.toReversed().byteLength;
    if(setup.method==='toSorted') return source.toSorted().byteLength;
    if(setup.method==='with') return source.with(0,1).byteLength;
    return source.subarray().byteLength;
  }};`).content);
  for (const method of ['toReversed', 'toSorted', 'with', 'subarray']) {
    const probe = new ProgramExecution(artifact, 1_000_000); probe.start({method});
    assert.equal(probe.result.status, 0);
    const startCost = 1_000_000 - (probe as any).context.remaining;
    probe.dispose();
    const parent = new ProgramExecution(artifact, startCost + 100); parent.start({method});
    assert.equal(parent.result.status, 0);
    const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
    for (const instance of [parent, fork, restored]) {
      try { instance.resume(null); } catch (error) {
        if (method === 'subarray') throw error;
        assert.match(String(error), /budget exceeded/);
      }
      if (method === 'subarray') {
        assert.equal(instance.result.status, 1, String(instance.result.value));
        assert.equal(instance.result.value, 409600);
      } else {
        assert.equal(instance.fault, true, method);
        assert.notEqual(instance.result.status, 1, method);
      }
      instance.dispose();
    }
  }
});

test('typed-array slice with reused species storage charges copying after IO on every branch', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const source=new Uint8Array(409600),destination=new Uint8Array(409600);
    source.constructor={[Symbol.species]:function(length){if(length!==409600)throw Error('length');return destination;}};
    await io.call({port:'step',input:null});
    return source.slice(0).byteLength;
  }};`).content);
  const probe = new ProgramExecution(artifact, 1_000_000); probe.start(null);
  assert.equal(probe.result.status, 0);
  const startCost = 1_000_000 - (probe as any).context.remaining;
  probe.dispose();
  const parent = new ProgramExecution(artifact, startCost + 100); parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const instance of [parent, fork, restored]) {
    try { instance.resume(null); } catch (error) { assert.match(String(error), /budget exceeded/); }
    assert.equal(instance.fault, true);
    assert.notEqual(instance.result.status, 1);
    instance.dispose();
  }
});

test('typed-array native scan and in-place mutation charge work after IO on every branch', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    const source=new Uint8Array(409600);
    await io.call({port:'step',input:null});
    if(setup.method==='fill') return source.fill(1).byteLength;
    return source.includes(255);
  }};`).content);
  for (const method of ['fill', 'includes']) {
    const probe = new ProgramExecution(artifact, 1_000_000); probe.start({method});
    assert.equal(probe.result.status, 0);
    const startCost = 1_000_000 - (probe as any).context.remaining;
    probe.dispose();
    const parent = new ProgramExecution(artifact, startCost + 100); parent.start({method});
    assert.equal(parent.result.status, 0);
    const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
    for (const instance of [parent, fork, restored]) {
      try { instance.resume(null); } catch (error) { assert.match(String(error), /budget exceeded/); }
      assert.equal(instance.fault, true, method);
      assert.notEqual(instance.result.status, 1, method);
      instance.dispose();
    }
  }
});

test('native text expansion exhausts the budget after IO on every branch', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    if(setup.method==='repeat') return 'x'.repeat(409600);
    if(setup.method==='padStart') return 'x'.padStart(409600,'y');
    return 'x'.padEnd(409600,'y');
  }};`).content);
  for (const method of ['repeat', 'padStart', 'padEnd']) {
    const probe = new ProgramExecution(artifact, 1_000_000); probe.start({method});
    assert.equal(probe.result.status, 0);
    const startCost = 1_000_000 - (probe as any).context.remaining;
    probe.dispose();
    const parent = new ProgramExecution(artifact, startCost + 100); parent.start({method});
    assert.equal(parent.result.status, 0);
    const fork = parent.fork(), restored = parent.fresh(); restored.restore(parent.snapshot());
    for (const instance of [parent, fork, restored]) {
      try { instance.resume(null); } catch (error) { assert.match(String(error), /budget exceeded/); }
      assert.equal(instance.fault, true, method);
      assert.notEqual(instance.result.status, 1, method);
      instance.dispose();
    }
  }
});

test('typed-array bulk set charges byte-copy work after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const source=new Uint8Array(409600),target=new Uint8Array(409600);
    await io.call({port:'step',input:null});target.set(source);return 1;
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
    assert.equal(instance.fault,true,'copied 400 KiB with only 100 steps left');
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('ArrayBuffer slice charges byte-copy work after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const source=new ArrayBuffer(409600);
    await io.call({port:'step',input:null});source.slice(0);return 1;
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
    assert.equal(instance.fault,true,'copied 400 KiB with only 100 steps left');
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

for(const method of ['freeze','seal'] as const)
test(`Object.${method} charges own-property mutation after IO on every branch`,()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const value={};for(let index=0;index<400;index++)value['k'+index]=index;
    await io.call({port:'step',input:null});Object.${method}(value);return 1;
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
    assert.equal(instance.fault,true,`${method} processed 400 properties with only 100 steps left`);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

for(const method of ['keys','getOwnPropertyNames','getOwnPropertySymbols','ownKeys'] as const)
test(`${method} charges returned keys after IO on every branch`,()=>{
  const call=method==='ownKeys'?'Reflect.ownKeys(source)':`Object.${method}(source)`;
  const source=method==='getOwnPropertySymbols'
    ? `for(let index=0;index<400;index++)source[Symbol('k'+index)]=index;`
    : `for(let index=0;index<400;index++)source['k'+index]=index;`;
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const source={};${source}
    await io.call({port:'step',input:null});${call};return 1;
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
    assert.equal(instance.fault,true,`${method} returned 400 keys with only 100 steps left`);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('filtered own-key listings charge hidden keys after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(setup,io){
    await io.call({port:'step',input:null});
    const source={};
    for(let index=0;index<2048;index++)Object.defineProperty(source,'k'+index,{value:index});
    if(setup==='noop')return true;
    return Object[setup](source);
  }};`).content);
  const baseline=new ProgramExecution(artifact,1_000_000);
  baseline.start('noop');baseline.resume(null);
  assert.equal(baseline.result.status,1);
  const allowance=1_000_000-(baseline as any).context.remaining+100;
  baseline.dispose();
  for(const method of ['keys','getOwnPropertySymbols']){
    const parent=new ProgramExecution(artifact,allowance);
    parent.start(method);assert.equal(parent.result.status,0);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      try{instance.resume(null);}catch(error){assert.match(String(error),/budget exceeded/);}
      assert.equal(instance.fault,true,method);
      assert.notEqual(instance.result.status,1,method);
      instance.dispose();
    }
  }
});

for(const method of ['defineProperties','create'] as const)
test(`Object.${method} charges descriptor-table traversal after IO on every branch`,()=>{
  const invoke=method==='create'?'Object.create(null,table)':'Object.defineProperties({},table)';
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const table={};for(let index=0;index<400;index++)table['k'+index]={value:index};
    await io.call({port:'step',input:null});${invoke};return 1;
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
    assert.equal(instance.fault,true,`${method} traversed 400 descriptors with only 100 steps left`);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

test('borrowed RegExp exec and test preserve V8 receiver errors and input conversion order',async()=>{
  async function run(_setup:unknown,io:any){
    await io.call({port:'step',input:null});
    const cases=[
      [RegExp.prototype.exec,{}],
      [RegExp.prototype.exec,0],
      [RegExp.prototype.test,{}],
      [RegExp.prototype.test,0],
    ] as const;
    return cases.map(([method,receiver])=>{
      const trace:string[]=[];
      const input={toString(){trace.push('input');return 'x';}};
      try{Reflect.apply(method,receiver,[input]);return {trace,error:null};}
      catch(error){return {trace,error:[(error as Error).name,(error as Error).message]};}
    });
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

test('non-global RegExp failures in replaceAll and matchAll read flags once and keep V8 diagnostics',async()=>{
  async function run(_setup:unknown,io:any){
    await io.call({port:'step',input:null});
    return (['replaceAll','matchAll'] as const).map(method=>{
      const trace:string[]=[];
      const pattern=/x/;
      Object.defineProperty(pattern,'flags',{get(){trace.push('flags');return {toString(){trace.push('flags-string');return 'i';}};}});
      Object.defineProperty(pattern,method==='replaceAll'?Symbol.replace:Symbol.matchAll,{get(){trace.push('hook');return ()=>null;}});
      try{Reflect.apply(String.prototype[method],'x',[pattern,'y']);return {trace,error:null};}
      catch(error){return {trace,error:[(error as Error).name,(error as Error).message]};}
    });
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

for(const method of ['assign','values','entries','getOwnPropertyDescriptors'] as const)
test(`Object.${method} charges visited properties after IO on every branch`,()=>{
  const call=method==='assign'?'Object.assign({},source)':`Object.${method}(source)`;
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    const source={};for(let index=0;index<400;index++)source['k'+index]=index;
    await io.call({port:'step',input:null});${call};return 1;
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
    assert.equal(instance.fault,true,`${method} traversed 400 keys with only 100 steps left`);
    assert.notEqual(instance.result.status,1);
    instance.dispose();
  }
});

function execution(body: string) {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(input,io){${body}}};`).content);
  const instance = new ProgramExecution(artifact);
  instance.start(null);
  return { instance, artifact };
}

test('generic ToObject failure messages survive IO, fork and restore', () => {
  const expressions = [
    'String.raw(null)', 'String.raw({raw:null})',
    'Array.prototype.join.call(null)', 'Array.prototype.splice.call(null)',
    'Array.prototype.slice.call(null)', 'Array.prototype.flat.call(null)',
    'Object.assign(null,{})', 'Object.entries(null)', 'Object.values(null)',
    'Array.prototype.toString.call(null)',
    'String.prototype.concat.call(null)', 'String.prototype.replace.call(null)',
    'String.prototype.match.call(null)', 'String.prototype.split.call(null)',
    'Array.prototype.map.call(null)', 'Object.prototype.toLocaleString.call(null)',
    'RegExp.prototype.exec.call(null)', 'RegExp.prototype.test.call(null)',
    'RegExp.prototype[Symbol.match].call(null)', 'RegExp.prototype[Symbol.matchAll].call(null)',
    'RegExp.prototype.toString.call(null)', 'Error.prototype.toString.call(null)',
    'String.prototype[Symbol.iterator].call(null)',
  ];
  const expected = expressions.map(expression => {
    try { Function(expression)(); return null; }
    catch (error) { return [(error as Error).name, (error as Error).message]; }
  });
  const body = `await io.call({port:'step',input:null});const errors=[];
    ${expressions.map(expression => `try{${expression}}catch(error){errors.push([error.name,error.message])}`).join(';')}
    return errors;`;
  const { instance, artifact } = execution(body);
  assert.equal(instance.result.status, 0);
  const fork = instance.fork(), restored = new ProgramExecution(artifact);
  restored.restore(instance.snapshot());
  for (const current of [instance, fork, restored]) {
    current.resume(null);
    assert.equal(current.result.status, 1, String(current.result.value));
    assert.deepEqual(current.result.value, expected);
    current.dispose();
  }
});

test('runtime-provided error accessors cannot carry mutable state between instances', () => {
  const { instance, artifact } = execution(`
    const setter=Object.getOwnPropertyDescriptor(new Error(),'stack').set;
    setter.__sharedState=17;return 0;
  `);
  assert.equal(instance.result.status, 2);
  assert.match(String(instance.result.value), /shared intrinsic/);
  const second = new ProgramExecution(artifact); second.start(null);
  assert.equal(second.result.status, 2);
  assert.match(String(second.result.value), /shared intrinsic/);
});

test('array result constructors outside the supported profile are rejected before author hooks or native writes', () => {
  for (const operation of [
    `const a=[7];a.constructor={[Symbol.species]:function(){return Object;}};a.map(x=>x);`,
    `const a=[7];Object.defineProperty(a,'constructor',{get(){Object.__speciesProbe=1;return Array;}});a.slice();`,
    `Array.from.call(function(){return Object;},[7]);`,
    `Array.of.call(function(){return Object;},7);`,
  ]) {
    const { instance } = execution(operation + 'return 0;');
    assert.equal(instance.result.status, 2);
    assert.match(String(instance.result.value), /Unsupported native operation/);
    assert.equal(Object.hasOwn(Object, '0'), false);
    assert.equal(Object.hasOwn(Object, '__speciesProbe'), false);
  }
  const { instance } = execution('return [1,2].map(x=>x+1);');
  assert.equal(instance.result.status, 1);
  assert.deepEqual(instance.result.value, [2,3]);
});

test('invalid array callbacks fail before species inspection after IO on every branch', async () => {
  async function run(_setup: unknown, io: any) {
    await io.call({port: 'step', input: null});
    const result: unknown[] = [];
    for (const name of ['map', 'filter', 'flatMap'] as const) {
      const trace: string[] = [], source = [1, 2];
      Object.defineProperty(source, 'constructor', {
        get() { trace.push('constructor'); return Array; }
      });
      try { (source as any)[name](undefined); result.push(null); }
      catch (error) { result.push([(error as Error).name, (error as Error).message, trace]); }
    }
    return result;
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const expected = await run(null, {call: async () => null});
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.result.status, 0);
  const branch = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  for (const instance of [parent, branch, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('apply argument-list conversion never introduces a species or iterator call', () => {
  const { instance } = execution(`
    const args=[3,4];args.constructor={[Symbol.species]:function(){throw Error('unexpected species');}};
    args[Symbol.iterator]=function(){throw Error('unexpected iteration');};
    function add(a,b){return a+b;}
    return [add.apply(null,args),Reflect.apply(add,null,args)];
  `);
  assert.equal(instance.result.status, 1);
  assert.deepEqual(instance.result.value, [7,7]);
});

test('native methods absent from the whitelist fail through direct and indirect calls', () => {
  for (const operation of [
    '(123).toLocaleString()',
    'Number.prototype.toLocaleString.call(123)',
    'Reflect.apply(Number.prototype.toLocaleString,123,[])',
    'Number.prototype.toLocaleString.bind(123)()',
  ]) {
    const { instance } = execution(`return ${operation};`);
    assert.equal(instance.result.status, 2, operation);
    assert.match(String(instance.result.value), /not whitelisted/, operation);
  }
});

test('matchAll retains its iterator cursor across IO, fork and restore', () => {
  const {instance,artifact}=execution(`
    const pattern=/a/g;pattern.lastIndex=1;
    const iterator='baaa'.matchAll(pattern);
    const first=iterator.next().value;
    await io.call({port:'step',input:[first[0],first.index,pattern.lastIndex]});
    const second=iterator.next().value,third=iterator.next().value,last=iterator.next();
    return [[first[0],first.index],[second[0],second.index],[third[0],third.index],
      last.done,pattern.lastIndex,Object.prototype.toString.call(iterator)];
  `);
  assert.equal(instance.result.status,0,String(instance.result.value));
  assert.deepEqual(instance.io.callData.input,['a',1,1]);
  const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  for(const current of [instance,fork,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,[['a',1],['a',2],['a',3],true,1,'[object RegExp String Iterator]']);
  }
});

test('matchAll matches V8 for empty matches, Unicode and custom species', () => {
  const cases=[
    `function nonGlobal(){const it=/a/[Symbol.matchAll]('aba');return [it.next().value.index,it.next().done];}`,
    `function unicode(){return [[...'😀'.matchAll(/(?:)/gu)].map(m=>m.index),[...'😀'.matchAll(/(?:)/g)].map(m=>m.index)];}`,
    `function stringFallback(){return [...'aba'.matchAll('a')].map(m=>m.index);}`,
    `function regexFallback(){const re=/a/g;re[Symbol.matchAll]=null;return [...'aba'.matchAll(re)].map(m=>m.index);}`,
    `function customHook(){const pattern={[Symbol.matchAll](text){return [text];}};return 'abc'.matchAll(pattern)[0];}`,
    `function publicFlags(){const re=/a/;Object.defineProperty(re,'flags',{value:'g'});return [...re[Symbol.matchAll]('aba')].map(m=>m.index);}`,
    `function customSpecies(){
      const trace=[];
      class Matcher{
        constructor(rx,flags){this.pattern=new RegExp(rx,flags);this.lastIndex=0;trace.push('construct:'+flags);}
        exec(text){this.pattern.lastIndex=this.lastIndex;const match=this.pattern.exec(text);this.lastIndex=this.pattern.lastIndex;trace.push('exec:'+this.lastIndex);return match;}
      }
      const re=/a/g;re.constructor={[Symbol.species]:Matcher};
      const matches=[...re[Symbol.matchAll]('aba')].map(match=>[match[0],match.index]);
      return [matches,trace];
    }`,
  ];
  for(const source of cases){
    const run=new Function(`"use strict";return (${source})`)() as () => unknown;
    const expected=run();
    const {instance}=execution(`const run=${source};return run();`);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected,run.name);
  }
});

test('matchAll preserves a custom species matcher and its trace across branches', () => {
  const {instance,artifact}=execution(`
    const trace=[];
    class Matcher{
      constructor(rx,flags){this.pattern=new RegExp(rx,flags);this.lastIndex=0;trace.push('construct:'+flags);}
      exec(text){this.pattern.lastIndex=this.lastIndex;const match=this.pattern.exec(text);this.lastIndex=this.pattern.lastIndex;trace.push('exec:'+this.lastIndex);return match;}
    }
    const re=/a/g;re.constructor={[Symbol.species]:Matcher};
    const iterator=re[Symbol.matchAll]('aba'),first=iterator.next().value;
    await io.call({port:'step',input:[first.index,trace]});
    const second=iterator.next().value,done=iterator.next();
    return [first.index,second.index,done.done,trace];
  `);
  assert.equal(instance.result.status,0,String(instance.result.value));
  assert.deepEqual(instance.io.callData.input,[0,['construct:g','exec:1']]);
  const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  for(const current of [instance,fork,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,[0,2,true,['construct:g','exec:1','exec:3','exec:0']]);
  }
});

test('matchAll guards hooks, flags, species, index conversion and matcher exec', () => {
  for(const body of [
    `return 'a'.matchAll({[Symbol.matchAll]:Date.now});`,
    `const re=/a/g;Object.defineProperty(re,'flags',{get(){return Date.now()}});return re[Symbol.matchAll]('a');`,
    `const re=/a/g;re.constructor={[Symbol.species]:Date};return re[Symbol.matchAll]('a');`,
    `const re=/a/g;re.lastIndex={[Symbol.toPrimitive]:Date.now};return re[Symbol.matchAll]('a');`,
    `const re=/a/g;re.constructor={[Symbol.species]:class {constructor(){this.lastIndex=0;this.exec=Date.now;}}};return re[Symbol.matchAll]('a').next();`,
  ]){
    const {instance,artifact}=execution(`await io.call({port:'step',input:null});${body}`);
    assert.equal(instance.result.status,0,body);
    const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
    for(const current of [instance,fork,restored]){
      current.resume(null);
      assert.equal(current.result.status,2,body);
      assert.equal(current.hostViolation,true,body);
    }
  }
});

test('matchAll iterator method can escape and retain native reflection across restore', () => {
  const nativeSource=Function.prototype.toString.call('a'.matchAll(/a/g).next);
  const {instance,artifact}=execution(`
    const iterator='aba'.matchAll(/a/g),next=iterator.next;
    await io.call({port:'step',input:null});
    return [Function.prototype.toString.call(next),next.call(iterator).value.index,
      next.call(iterator).value.index,next.call(iterator).done];
  `);
  assert.equal(instance.result.status,0);
  const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  for(const current of [instance,fork,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,[nativeSource,0,2,true]);
  }
});

test('String match uses native Symbol.match dispatch and RegExpCreate fallback', () => {
  const cases=[
    `function direct(){return ['aba'.match(/a/g),'aba'.match(/b/)[0]];}`,
    `function hook(){const pattern={[Symbol.match](value){return [String(value),this===pattern];}};return String.prototype.match.call({toString(){return 'abc';}},pattern);}`,
    `function fallback(){const pattern=/a/g;pattern[Symbol.match]=null;return 'aba'.match(pattern);}`,
  ];
  for(const source of cases){
    const native=(new Function(`"use strict";return (${source})`)() as () => unknown)();
    const {instance}=execution(`const run=${source};return run();`);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,native,source);
  }
});

test('String match preserves a match result after IO, fork and restore', () => {
  const {instance,artifact}=execution(`
    const result='aba'.match(/b/);
    await io.call({port:'step',input:[result[0],result.index]});
    return [result[0],result.index,result.input,result.groups];
  `);
  assert.equal(instance.result.status,0);
  assert.deepEqual(instance.io.callData.input,['b',1]);
  const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  for(const current of [instance,fork,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,['b',1,'aba',undefined]);
  }
});

test('String search fallback stringifies a RegExp whose Symbol.search is null', () => {
  const body=`const re=/a/g;re[Symbol.search]=null;return 'aba'.search(re);`;
  const expected=new Function(`"use strict";${body}`)();
  const {instance}=execution(body);
  assert.equal(instance.result.status,1,String(instance.result.value));
  assert.equal(instance.result.value,expected);
});

test('native methods cannot become unchecked getters through descriptor APIs',()=>{
 for(const expression of [
  `Object.defineProperty({},'x',{get:Array.prototype.values})`,
  `Reflect.defineProperty({},'x',{get:Array.prototype.values})`,
  `Object.defineProperties({},{x:{get:Array.prototype.values}})`,
  `Object.create(null,{x:{get:Array.prototype.values}})`,
  `Object.prototype.__defineGetter__.call({},'x',Array.prototype.values)`,
 ]){
  const {instance}=execution(`return ${expression};`);
  assert.equal(instance.result.status,2);assert.match(String(instance.result.value),/Unsupported native function used as an accessor/);
 }
});

test('computed constructors and indirect invocation cannot execute dynamic code', () => {
  for (const expression of [
    'Object[key]("return 42")()',
    'Object[key].call(null,"return 42")()',
    'Object[key].apply(null,["return 42"])()',
    'Object[key].bind(null,"return 42")()()',
    'new (Object[key])("return 42")',
  ]) {
    const { instance } = execution(`const key="con"+"structor";return ${expression};`);
    assert.equal(instance.result.status, 2, expression);
    assert.match(String(instance.result.value), /not admitted/);
  }
});

test('shared intrinsic writes fail before mutating either branch or the host', () => {
  const key = '__bearOperationTest';
  assert.equal(Object.hasOwn(Object, key), false);
  for (const write of [
    `Object.${key}=amount`,
    `Object.assign(Object,{${key}:amount})`,
    `Object.assign.call(null,Object,{${key}:amount})`,
    `Object.assign.bind(null,Object)({${key}:amount})`,
    `Object.defineProperty(Object,"${key}",{value:amount})`,
    `Object.getPrototypeOf([]).${key}=amount`,
    `[amount].forEach(Object.assign.bind(null,Object,{${key}:amount}))`,
    `[{${key}:amount}].reduce(Object.assign,Object)`,
  ]) {
    const { instance } = execution(`const amount=await io.call({port:'step',input:0});${write};return amount;`);
    const branch = instance.fork();
    instance.resume(1); branch.resume(2);
    for (const current of [instance, branch]) {
      assert.equal(current.result.status, 2, write);
      assert.match(String(current.result.value), /shared intrinsic/);
    }
    assert.equal(Object.hasOwn(Object, key), false);
    assert.equal(Object.hasOwn(Array.prototype, key), false);
  }
});

test('compound references and method receivers preserve evaluation order across IO and fork', () => {
  const { instance, artifact } = execution(`
    let order='';const object={value:2,add(n){return this.value+n;}};
    function receiver(){order+='r';return object;}
    function key(){order+='k';return 'value';}
    receiver()[key()]+=await io.call({port:'step',input:order});
    const old=object.value++;const now=++object.value;
    return [object.add(3),old,now,order];
  `);
  assert.equal(instance.io.callData.input, 'rk');
  const branch = instance.fork(), restored = new ProgramExecution(artifact);
  restored.restore(instance.snapshot());
  instance.resume(4); branch.resume(8); restored.resume(4);
  assert.deepEqual(instance.result.value, [11, 6, 8, 'rk']);
  assert.deepEqual(restored.result.value, instance.result.value);
  assert.deepEqual(branch.result.value, [15, 10, 12, 'rk']);
});

test('collection constructors cannot call a mutating intrinsic through a subclass adder', () => {
  for (const type of ['Map', 'WeakMap']) {
    const { instance } = execution(`class Table extends ${type} {}
      Object.defineProperty(Table.prototype,'set',{value:Object.assign});
      return new Table([[Object,{__bearOperationTest:1}]]);`);
    assert.equal(instance.result.status, 2, type);
    assert.match(String(instance.result.value), /shared intrinsic/);
    assert.equal(Object.hasOwn(Object, '__bearOperationTest'), false);
  }
});

test('promise properties do not modify scheduler state and IO exposes no pending continuation', () => {
  const { instance } = execution(`
    const value=Promise.resolve(7);value.status=2;value.value=99;value.listeners=[];
    const answer=await value;
    io.pending=null;io.callData='author property';
    const reply=await io.call({port:'step',input:[answer,Object.keys(value),io.pending]});
    return [answer,reply];
  `);
  assert.deepEqual(instance.io.callData.input,[7,['status','value','listeners'],null]);
  const branch=instance.fork();branch.resume(3);instance.resume(4);
  assert.deepEqual(branch.result.value,[7,3]);assert.deepEqual(instance.result.value,[7,4]);
});

test('async and generator shared prototypes reject writes before affecting another instance', () => {
  for (const target of ['Object.getPrototypeOf(sync)', 'Object.getPrototypeOf(sync.prototype)',
    'Object.getPrototypeOf(sync).constructor', 'Object.getPrototypeOf(asynchronous)',
    'Object.getPrototypeOf(asynchronous.prototype)', 'Object.getPrototypeOf(asynchronous).constructor',
    'Object.getPrototypeOf(named)']) {
    const { instance, artifact } = execution(`
      function* sync(){} async function* asynchronous(){} async function named(){}
      const target=${target};
      if(Object.hasOwn(target,'leak'))throw new Error('state leaked');
      target.leak=17;
    `);
    assert.equal(instance.result.status, 2);
    assert.match(String(instance.result.value), /shared intrinsic/);
    const second = new ProgramExecution(artifact); second.start(null);
    assert.equal(second.result.status, 2);
    assert.match(String(second.result.value), /shared intrinsic/);
  }
});

test('compiled iterator prototypes stay protected without freezing author generator prototypes', () => {
  const {instance} = execution(`
    function* sequence(){yield 1;}
    async function* asynchronous(){yield 1;}
    const first=sequence(),second=asynchronous();
    const cursors=[[][Symbol.iterator](),''[Symbol.iterator](),new Map().entries(),new Set().values(),new Uint8Array().values()];
    const targets=[...cursors.map(cursor=>Object.getPrototypeOf(cursor)),
      Object.getPrototypeOf(Object.getPrototypeOf(first)),Object.getPrototypeOf(Object.getPrototypeOf(second))];
    const results=[];
    for(const target of targets){
      try{target.bearMutationProbe=1;results.push(false);}
      catch(error){if(!(error instanceof TypeError))throw error;results.push(true);}
    }
    const owned=Object.getPrototypeOf(first);owned.ownState=7;
    return [results,owned.ownState];
  `);
  assert.equal(instance.result.status,1,String(instance.result.value));
  assert.deepEqual(instance.result.value,[Array(7).fill(true),7]);
});
