import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

test('entry consumers retain native primitive diagnostics through IO and branches', async () => {
  async function run(_setup: unknown, io: any) {
    await io.call({port: 'step', input: null});
    const result: unknown[] = [];
    const observe = (call: () => unknown) => {
      try { call(); return ['ok']; }
      catch (error) { return [(error as Error).name, (error as Error).message]; }
    };
    for (const value of [0, false, 1n, Symbol('s'), '', 'x'])
      result.push(observe(() => Object.fromEntries(value as any)));
    for (const entry of [0, false, null, undefined, 'x', Symbol('s')]) {
      result.push(observe(() => Object.fromEntries([entry] as any)));
      result.push(observe(() => new Map([entry] as any)));
      result.push(observe(() => new WeakMap([entry] as any)));
    }
    return result;
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  const expected = await run(null, {call: async () => null});
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('primitive iterable constructor and Promise failures survive IO branches', async () => {
  async function run(_setup: unknown, io: any) {
    await io.call({port: 'step', input: null});
    const result: unknown[] = [];
    const reads: string[] = [];
    const observe = (call: () => unknown) => {
      try { call(); return null; }
      catch (error) { return [(error as Error).name, (error as Error).message]; }
    };
    for (const value of [0, false, 1n, Symbol('s'), undefined, null]) {
      result.push(observe(() => new Map(value as any)));
      result.push(observe(() => new Set(value as any)));
      result.push(observe(() => new WeakMap(value as any)));
      result.push(observe(() => new WeakSet(value as any)));
      result.push(observe(() => new AggregateError(value as any)));
      try { await Promise.all(value as any); result.push(null); }
      catch (error) { result.push([(error as Error).name, (error as Error).message]); }
    }
    for (const method of [undefined, 0]) {
      const value = {get [Symbol.iterator]() { reads.push(String(method)); return method; }};
      result.push(observe(() => new Map(value as any)));
      result.push(observe(() => new Set(value as any)));
      result.push(observe(() => new WeakMap(value as any)));
      result.push(observe(() => new WeakSet(value as any)));
      result.push(observe(() => new AggregateError(value as any)));
      try { await Promise.all(value as any); result.push(null); }
      catch (error) { result.push([(error as Error).name, (error as Error).message]); }
    }
    return {result, reads};
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  const expected = await run(null, {call: async () => null});
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('iterator protocol failures retain native stages through IO branches', async () => {
  async function run(_setup: unknown, io: any) {
    await io.call({port: 'step', input: null});
    const results: unknown[] = [];
    for (const stage of ['missingMethod', 'primitiveIterator', 'invalidNext', 'primitiveResult']) {
      for (const consumer of ['map', 'set', 'weakMap', 'weakSet', 'aggregate', 'entries', 'objectGroup', 'mapGroup', 'arrayFrom', 'promiseAll']) {
        const trace: string[] = [];
        const source = stage === 'missingMethod'
          ? {get [Symbol.iterator]() { trace.push('iterator'); return 0; }}
          : stage === 'primitiveIterator'
            ? {[Symbol.iterator]() { trace.push('iterator'); return 0; }}
            : stage === 'invalidNext'
              ? {[Symbol.iterator]() { trace.push('iterator'); return {get next() { trace.push('next'); return 0; }}; }}
              : {[Symbol.iterator]() { trace.push('iterator'); return {next() { trace.push('next'); return 0; }}; }};
        let failure: unknown = null;
        try {
          if (consumer === 'map') new Map(source as any);
          else if (consumer === 'set') new Set(source as any);
          else if (consumer === 'weakMap') new WeakMap(source as any);
          else if (consumer === 'weakSet') new WeakSet(source as any);
          else if (consumer === 'aggregate') new AggregateError(source as any);
          else if (consumer === 'entries') Object.fromEntries(source as any);
          else if (consumer === 'objectGroup') (Object as any).groupBy(source as any, () => 0);
          else if (consumer === 'mapGroup') (Map as any).groupBy(source as any, () => 0);
          else if (consumer === 'arrayFrom') Array.from(source as any);
          else await Promise.all(source as any);
        } catch (error) { failure = [(error as Error).name, (error as Error).message]; }
        results.push({stage, consumer, trace, failure});
      }
    }
    return results;
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  const expected = await run(null, {call: async () => null});
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('noncallable exotic primitive methods retain native diagnostics through IO branches', async () => {
  async function run(_setup: unknown, io: any) {
    await io.call({port: 'step', input: null});
    const result: unknown[] = [];
    class NamedValue { get [Symbol.toPrimitive]() { return 1; } }
    for (const constructor of [Number, String, RegExp, Error, TypeError, RangeError,
      SyntaxError, ReferenceError, EvalError, URIError, ArrayBuffer]) {
      for (const named of [false, true]) {
        const trace: string[] = [];
        const value = named ? Object.defineProperty(new NamedValue(), Symbol.toPrimitive,
          {get() { trace.push('exotic'); return 1; }})
          : {get [Symbol.toPrimitive]() { trace.push('exotic'); return 1; }};
        let failure: unknown = null;
        try { new (constructor as any)(value); }
        catch (error) { failure = [(error as Error).name, (error as Error).message]; }
        result.push({constructor: constructor.name, named, trace, failure});
      }
    }
    for (const operation of ['unary', 'add', 'compare', 'key']) {
      const trace: string[] = [];
      const value = {get [Symbol.toPrimitive]() { trace.push('exotic'); return 1; }};
      let failure: unknown = null;
      try {
        if (operation === 'unary') +(value as any);
        else if (operation === 'add') (value as any) + 0;
        else if (operation === 'compare') (value as any) < 2;
        else ({[value as any]: 1});
      } catch (error) { failure = [(error as Error).name, (error as Error).message]; }
      result.push({operation, trace, failure});
    }
    return result;
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  const expected = await run(null, {call: async () => null});
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('descriptor validation failures preserve native errors and single reads through IO branches', async () => {
  async function run(_setup: unknown, io: any) {
    await io.call({port: 'step', input: null});
    const results: unknown[] = [];
    class NamedDescriptor { get get() { return function() {}; } }
    for (const method of ['define', 'reflect', 'table', 'create']) {
      for (const kind of ['missing', 'null', 'number', 'string', 'invalidGet', 'invalidSet', 'mixedGet', 'mixedSet', 'inheritedMixed']) {
        const trace: string[] = [];
        const descriptor = kind === 'missing' ? undefined
          : kind === 'null' ? null
          : kind === 'number' ? 0
          : kind === 'string' ? 'x'
          : kind === 'invalidGet' ? {get: 1}
          : kind === 'invalidSet' ? {set: 0}
          : kind === 'mixedGet' ? {get() {}, value: 1}
          : kind === 'mixedSet' ? {set(_value: unknown) {}, writable: true}
          : Object.assign(Object.defineProperty(new NamedDescriptor(), 'get',
            {get() { trace.push('get'); return function() {}; }}), {value: 1});
        let failure: unknown = null;
        try {
          if (method === 'define') Object.defineProperty({}, 'x', descriptor as any);
          else if (method === 'reflect') Reflect.defineProperty({}, 'x', descriptor as any);
          else if (method === 'table') Object.defineProperties({}, descriptor as any);
          else Object.create(null, descriptor as any);
        } catch (error) { failure = [(error as Error).name, (error as Error).message]; }
        results.push({method, kind, trace, failure});
      }
    }
    return results;
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  const expected = await run(null, {call: async () => null});
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('legacy accessor callbacks are checked before key coercion through IO branches', async () => {
  async function run(_setup: unknown, io: any) {
    await io.call({port: 'step', input: null});
    const results: unknown[] = [];
    for (const method of ['__defineGetter__', '__defineSetter__']) {
      for (const invalid of [undefined, null, 0, false, 'x', {}]) {
        const trace: string[] = [];
        const key = {[Symbol.toPrimitive]() { trace.push('key'); return 'x'; }};
        const target: any = {};
        let failure: unknown = null;
        try { target[method](key, invalid); }
        catch (error) { failure = [(error as Error).name, (error as Error).message]; }
        results.push({method, trace, failure});
      }
    }
    return results;
  }
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  assert.equal(parent.result.status, 0);
  const fork = parent.fork(), restored = parent.fresh();
  restored.restore(parent.snapshot());
  const expected = await run(null, {call: async () => null});
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected);
    instance.dispose();
  }
});

test('invalid property targets fail with native diagnostics before later operands after IO and branching',async()=>{
  async function run(_setup:unknown,io:any){
    await io.call({port:'step',input:null});
    const trace:string[]=[];
    const key={[Symbol.toPrimitive](){trace.push('key');return 'x';}};
    const descriptor={get value(){trace.push('descriptor');return 1;}};
    const table={get x(){trace.push('table');return descriptor;}};
    const receiver={get x(){trace.push('receiver');return 1;}};
    const calls=[
      ()=>Object.create(7 as any,table),
      ()=>Object.defineProperty(null as any,key as any,descriptor),
      ()=>Reflect.defineProperty(7 as any,key as any,descriptor),
      ()=>Object.defineProperties(undefined as any,table),
      ()=>Reflect.get(null as any,key as any,receiver),
      ()=>Reflect.set(7 as any,key as any,1,receiver),
    ];
    const errors=calls.map(call=>{try{call();return null;}catch(error){return [(error as Error).name,(error as Error).message];}});
    return {trace,errors};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  const expected=await run(null,{call:async()=>null});
  assert.deepEqual(expected.trace,[]);
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
  }
});

test('invalid native call targets fail before reading lists and iterators after IO and branching',async()=>{
  async function run(_setup:unknown,io:any){
    await io.call({port:'step',input:null});
    const trace:string[]=[];
    const list={get length(){trace.push('length');return 0;}};
    const items={get [Symbol.iterator](){trace.push('iterator');return [1][Symbol.iterator];}};
    const calls=[
      ()=>Reflect.apply(Function.prototype.call,7,[1]),
      ()=>Reflect.apply(Function.prototype.apply,7,[null,list]),
      ()=>Reflect.apply(7 as any,null,list),
      ()=>Reflect.construct(7 as any,list as any,Array),
      ()=>Reflect.construct(Array,list as any,7 as any),
      ()=>Reflect.apply(Function.prototype.bind,7,[null]),
      ()=>Function.prototype.bind.call(7 as any,null),
      ()=>Array.from(items,7 as any),
    ];
    const errors=calls.map(call=>{try{call();return null;}catch(error){return [(error as Error).name,(error as Error).message];}});
    return {trace,errors};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  const expected=await run(null,{call:async()=>null});
  assert.deepEqual(expected.trace,[]);
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
  }
});

for (const method of ['slice', 'splice', 'flat']) test(`${method} cannot install a shared result constructor during argument conversion`, () => {
  const { instance } = execution(`
    const values=[1,2];
    const start={valueOf(){values.constructor={ [Symbol.species]:function(){return Object;} };return 0;}};
    return values.${method}(start);
  `);
  assert.equal(instance.result.status, 2);
  assert.match(String(instance.result.value), /custom array species/);
  assert.equal(Object.hasOwn(Object, '0'), false);
});

function execution(body: string) {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){${body}}};`).content);
  const instance = new ProgramExecution(artifact); instance.start(null);
  return { instance, artifact };
}

test('native coercion entry points cannot invoke ambient functions outside the Context', () => {
  const calls = [
    'Object.getOwnPropertyDescriptor({0:1},key)', 'Reflect.getOwnPropertyDescriptor({0:1},key)',
    'Object.hasOwn({0:1},key)', 'Reflect.get({0:1},key)', 'Reflect.set({},key,1)',
    'Reflect.has({0:1},key)', 'Reflect.deleteProperty({0:1},key)',
    'Object.prototype.hasOwnProperty.call({0:1},key)',
    'Object.prototype.propertyIsEnumerable.call({0:1},key)',
    'Object.prototype.__lookupGetter__.call({},key)',
    'Object.prototype.__lookupSetter__.call({},key)',
    'Object.prototype.__defineGetter__.call({},key,()=>1)',
    'Object.prototype.__defineSetter__.call({},key,()=>{})',
    'Object.defineProperty({},key,{value:1})', 'Reflect.defineProperty({},key,{value:1})',
    'Array.prototype.at.call([1],key)', 'Array.prototype.copyWithin.call([1],key,0)',
    'Array.prototype.fill.call([1],1,key)', 'Array.prototype.includes.call([1],1,key)',
    'Array.prototype.indexOf.call([1],1,key)', 'Array.prototype.lastIndexOf.call([1],1,key)',
    'Array.prototype.toSpliced.call([1],key,0)', 'Array.prototype.with.call([1],key,2)',
    'Array.prototype.slice.call([1],key)', 'Array.prototype.splice.call([1],key,0)',
    'Array.prototype.flat.call([[1]],key)', 'String.prototype.at.call("x",key)',
    'String.prototype.padStart.call("x",key)',
    'String.prototype.startsWith.call("x","x",key)', 'String.prototype.indexOf.call("x","x",key)',
    'Number.prototype.toFixed.call(1,key)', 'BigInt.asIntN(key,1n)', 'Symbol.for(key)',
    'new ArrayBuffer(key)', 'new DataView(new ArrayBuffer(8),key)',
    'new DataView(new ArrayBuffer(8)).getInt8(key)',
    'new DataView(new ArrayBuffer(8)).setInt8(key,1)',
    'new Uint8Array(2).at(key)', 'new Uint8Array(2).fill(1,key)',
    'new Uint8Array(2).with(key,1)', 'new Uint8Array(2).set([1],key)',
    'new Uint8Array(2).slice(key)',
    "'x'.padEnd(3,key)", "'x'.replace('x',key)",
    "'x'.replaceAll('x',key)", "'x'.repeat(key)",
    'String.raw({raw:{0:key,length:1}})',
    '/x/.exec(key)', 'RegExp.prototype.test.call(/x/,key)',
    'Math.max(key,2)',
  ];
  for (const expression of calls) {
    const setup=`let visits=0;const key={[Symbol.toPrimitive](){visits++;Date.now();return '0'}};`;
    // The reference must exercise ToPrimitive; otherwise a successful
    // controlled run would say nothing about the implicit native call path.
    const nativeVisits=Function(`${setup}try{${expression};}catch(error){}return visits;`)();
    assert.ok(nativeVisits>0,`V8 did not convert the key: ${expression}`);
    const {instance:parent,artifact}=execution(`${setup}await io.call({port:'step',input:null});${expression};return visits;`);
    assert.equal(parent.result.status,0,expression);
    const fork=parent.fork(),restored=new ProgramExecution(artifact);
    restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      instance.resume(null);
      assert.equal(instance.hostViolation,true,expression);
      assert.equal(instance.result.status,2,expression);
      instance.dispose();
    }
  }
});

test('flat charges each visited slot, including holes and nested arrays', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(){
    const nested=Array(1000);
    return [nested].flat(2).length;
  }};`).content);
  const bounded = new ProgramExecution(artifact, 100);
  assert.throws(() => bounded.start(null), /budget exceeded/);
  const sufficient = new ProgramExecution(artifact, 3000);
  sufficient.start(null);
  assert.equal(sufficient.result.status, 1, String(sufficient.result.value));
  assert.equal(sufficient.result.value, 0);
});

test('flat retains native depth conversion, sparse traversal and nested getter order', () => {
  const {instance} = execution(`
    const trace=[];
    const nested=[,3];
    Object.defineProperty(nested,0,{get(){trace.push('nested');return 2;}});
    const depth={valueOf(){trace.push('depth');return 2;}};
    return {values:[1,nested,[4]].flat(depth),trace};
  `);
  assert.equal(instance.result.status, 1, String(instance.result.value));
  assert.deepEqual(instance.result.value, {values:[1,2,3,4],trace:['depth','nested']});
});

test('missing environment names resolve only against the instance global', () => {
  const hostNavigator = globalThis.navigator;
  const { instance } = execution(`
    const before=typeof navigator;
    let direct;
    try { navigator.userAgent; } catch (error) { direct=error.name; }
    globalThis.navigator={userAgent:'instance-only'};
    return [before,direct,navigator.userAgent];
  `);
  assert.equal(instance.result.status, 1, String(instance.result.value));
  assert.deepEqual(instance.result.value, ['undefined','ReferenceError','instance-only']);
  assert.strictEqual(globalThis.navigator, hostNavigator);
});

test('Node-backed globals cannot become an undeclared IO path', () => {
  const { instance } = execution('URL.revokeObjectURL("blob:missing"); return 1;');
  assert.equal(instance.result.status, 2);
  assert.match(String(instance.result.value), /ReferenceError: URL is not defined/);
});

test('strict author functions cannot reveal the host call stack across IO', () => {
  const {instance:parent,artifact}=execution(`
    function outer(){return inner();}
    function inner(){
      const values=[];
      for(const name of ['caller','arguments']){
        try{values.push(inner[name]);}catch(error){values.push(error.name);}
      }
      return values;
    }
    const before=outer();
    await io.call({port:'step',input:before});
    return [before,outer()];
  `);
  const expected=['TypeError','TypeError'];
  assert.equal(parent.result.status,0,String(parent.result.value));
  assert.deepEqual(parent.io.callData.input,expected);
  const fork=parent.fork(),restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,[expected,expected]);
  }
});

test('error cause access follows the instance context across IO, fork and restore', () => {
  const { instance: parent, artifact } = execution(`
    const marker=await io.call({port:'step',input:null});
    const trace=[];
    const options={get cause(){trace.push('cause');return {marker};}};
    const message={toString(){trace.push('message');return 'x';}};
    const error=new TypeError(message,options);
    return {message:error.message,cause:error.cause,trace};
  `);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  const fork = parent.fork(), restored = new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for (const [instance, marker] of [[parent, 3], [fork, 4], [restored, 5]] as const) {
    instance.resume(marker);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, {message:'x',cause:{marker},trace:['message','cause']});
  }
});

test('ArrayBuffer slice species calls retain guarded callbacks and branch-local state', () => {
  const {instance: parent, artifact} = execution(`
    const trace=[];
    const buffer=new ArrayBuffer(4);
    new Uint8Array(buffer).set([1,2,3,4]);
    buffer.constructor={get [Symbol.species](){
      trace.push('species');
      return function(length){trace.push(['construct',length]);return new ArrayBuffer(length);};
    }};
    const marker=await io.call({port:'step',input:null});
    const output=buffer.slice(1,3);
    return {marker,trace,bytes:Array.from(new Uint8Array(output))};
  `);
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for(const [instance,marker] of [[parent,1],[fork,2],[restored,3]] as const){
    instance.resume(marker);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,{marker,trace:['species',['construct',2]],bytes:[2,3]});
  }
  for(const species of [
    'get [Symbol.species](){Date.now();return ArrayBuffer}',
    '[Symbol.species]:function(length){Date.now();return new ArrayBuffer(length)}',
  ]){
    const {instance}=execution(`
      const buffer=new ArrayBuffer(4);
      buffer.constructor={${species}};
      buffer.slice(0);
      return 'ambient call escaped';
    `);
    assert.equal(instance.result.status,2,species);
    assert.equal(instance.hostViolation,true,species);
  }
});

test('descriptor results reject unsupported nested native functions before IO', () => {
  for (const expression of [
    "Object.getOwnPropertyDescriptor(Number.prototype,'toLocaleString')",
    "Reflect.getOwnPropertyDescriptor(Number.prototype,'toLocaleString')",
    'Object.getOwnPropertyDescriptors(Number.prototype)',
  ]) {
    const {instance} = execution(`const descriptor=${expression};await io.call({port:'step',input:null});return descriptor;`);
    assert.equal(instance.result.status, 2, expression);
    assert.match(String(instance.result.value), /not whitelisted/, expression);
  }
});

test('reflective descriptor keys cannot call ambient functions after IO or restoration', () => {
  const {instance: parent, artifact} = execution(`
    await io.call({port:'step',input:null});
    const key={[Symbol.toPrimitive]:Date.now};
    Reflect.getOwnPropertyDescriptor({x:1},key);
    return 'ambient key conversion ran';
  `);
  assert.equal(parent.result.status, 0);
  const fork=parent.fork(), restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status, 2);
    assert.match(String(instance.result.value), /Ambient or dynamic execution/);
  }
});

test('reflective descriptor keys retain one native string-hint conversion', () => {
  const {instance}=execution(`
    const trace=[];
    const key={[Symbol.toPrimitive](hint){trace.push(hint);return 'x';}};
    const descriptor=Reflect.getOwnPropertyDescriptor({x:7},key);
    return [descriptor.value,trace];
  `);
  assert.equal(instance.result.status,1,String(instance.result.value));
  assert.deepEqual(instance.result.value,[7,['string']]);
});

test('Function identity matches V8 and remains stable across IO, fork and restore', () => {
  const {instance: parent, artifact} = execution(`
    const constructor=Function;
    const before=[constructor.name,constructor.length,constructor===Function.prototype.constructor];
    const reply=await io.call({port:'step',input:before});
    return {before,after:[constructor.name,constructor.length,constructor===Function.prototype.constructor],reply};
  `);
  assert.equal(parent.result.status, 0, String(parent.result.value));
  assert.deepEqual(parent.io.callData.input, ['Function',1,true]);
  const fork=parent.fork(), restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for (const [instance,reply] of [[parent,3],[fork,4],[restored,5]] as const) {
    instance.resume(reply);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value,{before:['Function',1,true],after:['Function',1,true],reply});
  }
  const denied=execution(`const constructor=Function;constructor('return 1');return 1;`).instance;
  assert.equal(denied.result.status, 2);
  assert.match(String(denied.result.value), /not admitted/);
});

test('dynamic function constructor identities remain readable but cannot execute after IO or branching', () => {
  const expected=[async function(){}, function*(){}, async function*(){}]
    .map(value=>[value.constructor.name,value.constructor.length,value instanceof value.constructor,
      value.constructor===Object.getPrototypeOf(value).constructor]);
  const {instance:parent,artifact}=execution(`
    const values=[async function(){},function*(){},async function*(){}];
    const inspect=()=>values.map(value=>[value.constructor.name,value.constructor.length,
      value instanceof value.constructor,value.constructor===Object.getPrototypeOf(value).constructor]);
    const before=inspect();
    await io.call({port:'step',input:null});
    const blocked=values.map(value=>{try{Reflect.apply(value.constructor,undefined,['return 1']);return false;}
      catch(error){return error instanceof TypeError;}});
    return {before,after:inspect(),blocked};
  `);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const fork=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,{before:expected,after:expected,blocked:[true,true,true]});
  }
});

test('local identities survive IO, fork and restore without permitting ambient calls', () => {
  const {instance: parent, artifact} = execution(`
    const values=[Date, Date.now, Proxy, Math, Math.random];
    const describe=()=>[
      Date.name, Proxy.name, Math.random.name,
      values[0]===Date, values[1]===Date.now, values[2]===Proxy,
      values[3]===Math, values[4]===Math.random, Math===globalThis.Math,
      typeof navigator, typeof URL, typeof File, typeof atob, typeof btoa,
      globalThis.navigator===undefined
    ];
    const before=describe();
    const reply=await io.call({port:'step',input:before});
    return {before,after:describe(),reply};
  `);
  const expected=['Date','Proxy','random',...Array(6).fill(true),
    'undefined','undefined','undefined','undefined','undefined',true];
  assert.equal(parent.result.status, 0, String(parent.result.value));
  assert.deepEqual(parent.io.callData.input, expected);
  const fork=parent.fork(), restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  for (const [instance,reply] of [[parent,3],[fork,4],[restored,5]] as const) {
    instance.resume(reply);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value,{before:expected,after:expected,reply});
  }
  for (const expression of ['Date.now()', 'Math.random()', 'new Date()', 'new Proxy({}, {})']) {
    const denied=execution(`${expression};return 1;`).instance;
    assert.equal(denied.result.status, 2, expression);
    assert.match(String(denied.result.value), /not admitted/, expression);
  }
  for (const expression of ['new URL("https://example.com")', 'new File([], "x")', 'atob("YQ==")', 'btoa("a")']) {
    const denied=execution(`${expression};return 1;`).instance;
    assert.equal(denied.result.status, 2, expression);
    assert.match(String(denied.result.value), /ReferenceError/, expression);
  }
});

test('Proxy construction routes remain denied after IO on every branch',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(method,io){
    await io.call({port:'step',input:null});
    if(method==='constructor')return new Proxy({},{});
    return Proxy.revocable({},{});
  }};`).content);
  for(const method of ['constructor','revocable']){
    const parent=new ProgramExecution(artifact);
    parent.start(method);assert.equal(parent.result.status,0,method);
    const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
    for(const instance of [parent,fork,restored]){
      instance.resume(null);
      assert.equal(instance.result.status,2,method);
      assert.match(String(instance.result.value),/not admitted|not whitelisted/,method);
      instance.dispose();
    }
  }
});

test('callback result conversion preserves captured state after IO and independent restoration',async()=>{
  async function run(io:any){
    const trace:unknown[]=[];
    let direction=1;
    function compare(a:number,b:number){
      return Object.freeze({[Symbol.toPrimitive](hint:string){trace.push(['compare',a,b,hint]);return direction*(a-b);}}) as any;
    }
    function map(value:number){
      return Object.freeze({valueOf(){trace.push(['map',value]);return value+direction;}}) as any;
    }
    direction=await io.call({port:'step',input:null});
    const normal=[3,1,2].sort(compare);
    const copied=[3,1,2].toSorted(compare);
    const typed=new Uint8Array([3,1,2]).sort(compare);
    const typedCopy=new Uint8Array([3,1,2]).toSorted(compare);
    const mapped=new Uint8Array([3,1,2]).map(map);
    const from=Uint8Array.from([3,1,2],map);
    return {normal,copied,typed:Array.from(typed),typedCopy:Array.from(typedCopy),mapped:Array.from(mapped),from:Array.from(from),trace};
  }
  const {instance:parent}=execution(`const run=${run.toString()};return await run(io);`);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot(),fork=parent.fork(),restored=parent.fresh();restored.restore(snapshot);
  for(const [index,instance]of[parent,fork,restored].entries()){
    const reply=index-1,expected=await run({call:async()=>reply});
    instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
  }
});

test('frozen array-like length coercion preserves captures and original aliases across fork and restore', async () => {
  async function run(io: any) {
    const trace: unknown[] = [];
    let count = 3;
    const length = Object.freeze({[Symbol.toPrimitive](hint: string) {trace.push([hint,count]);return count;}});
    const source: any = Object.freeze({0:7,2:9,length,[Symbol.isConcatSpreadable]:true});
    const mapped = Array.prototype.map.call(source, (_value: unknown,_index: number,array: unknown) => array);
    count = await io.call({port:'step',input:mapped.length});
    return {alias:mapped[0]===source&&mapped[2]===source,
      values:Array.prototype.map.call(source,(value: number,_index: number,array: unknown) => {
        if (array !== source) throw Error('View leaked');
        return value;
      }), concat:[1].concat(source), trace};
  }
  const {instance:parent} = execution(`const run=${run.toString()};return await run(io);`);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot(),fork=parent.fork(),restored=parent.fresh();
  restored.restore(snapshot);
  for(const [index,instance] of [parent,fork,restored].entries()) {
    const reply=index+1;
    const expected=await run({call:async()=>reply});
    instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
  }
});

test('native join recursion, coercion and abrupt cleanup retain V8 semantics across fork and restore', async () => {
  async function run(io: {call:(value:unknown)=>Promise<number>}) {
    const trace:string[]=[], direct:any[]=['a'], nested:any[]=['b'];
    direct.push(direct);nested.push(direct);direct.push(nested);
    let label='before';
    const custom:any[]=[];
    custom.push(custom);
    custom.toString=function(){trace.push('custom:'+label);return label;};
    const marker={};let throwing=true;
    const abrupt=[{toString(){trace.push('coerce');if(throwing)throw marker;return label;}}];
    function read(){
      const outputs=[direct.join(','),String(direct),''+nested,custom.join('|')];
      try{abrupt.join(',');}catch(error){trace.push(error===marker?'marker':'wrong');}
      throwing=false;outputs.push(abrupt.join(','));
      const sparse={length:3,0:label,get 2(){trace.push('get:2');return direct;}};
      outputs.push(Array.prototype.join.call(sparse,':'));
      const mutated=['x','y'];
      outputs.push(mutated.join({toString(){trace.push('separator');mutated.push('z');mutated[1]=label;return '|';}} as any));
      return outputs;
    }
    const before=read();
    label=String(await io.call({port:'step',input:before}));throwing=true;
    return {before,after:read(),trace,aliases:[direct[1]===direct,direct[2]===nested,nested[1]===direct,custom[0]===custom]};
  }
  const {instance,artifact}=execution(`return await (${run.toString()})(io);`);
  assert.equal(instance.result.status,0,String(instance.result.value));
  const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  for(const [branch,reply] of [[instance,3],[fork,7],[restored,5]] as const){
    const expected=await run({async call(){return reply;}});
    assert.deepEqual(branch.io.callData.input,expected.before);
    branch.resume(reply);
    assert.equal(branch.result.status,1,String(branch.result.value));
    assert.deepEqual(branch.result.value,expected);
  }
});

test('instanceof custom hooks obey write protection and managed-bound constructor semantics', async () => {
  const { instance } = execution(`return Object instanceof {[Symbol.hasInstance]:Object.freeze};`);
  assert.equal(instance.result.status, 2); assert.match(String(instance.result.value), /shared intrinsic/);
  assert.equal(Object.isFrozen(Object), false);
  async function run() {
    function Item(this: { value: number }, value: number) { this.value = value; }
    const Bound = Item.bind(null as any, 3) as unknown as { new(): { value: number } };
    const item = new Bound();
    const gate = { [Symbol.hasInstance](value: unknown) { return value === item; } };
    return [item instanceof Item, item instanceof Bound, item instanceof gate, {} instanceof gate, item.value];
  }
  const expected = await run(), result = execution(`const run=${run.toString()};return await run();`).instance;
  assert.equal(result.result.status, 1, String(result.result.value)); assert.deepEqual(result.result.value, expected);
});

test('compiler-generated delegation cannot bypass native mutation guards', () => {
  const { instance } = execution(`
    const delegate={ [Symbol.iterator](){return this;},next(){return {done:false,value:1};},return:Object.freeze };
    function* values(){yield* delegate;}
    const iterator=values();iterator.next();return iterator.return(Object);
  `);
  assert.equal(instance.result.status, 2); assert.match(String(instance.result.value), /shared intrinsic/);
  assert.equal(Object.isFrozen(Object), false);
});

test('delegated return uses the delegate completion value', async () => {
  async function run() {
    const calls: unknown[] = [];
    const delegate = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; },
      return(value: number) { calls.push(value); return { done: true, value: value + 1 }; } };
    function* values() { return yield* delegate; }
    const iterator = values(); iterator.next();
    return [iterator.return(5), calls];
  }
  const expected = await run(), { instance } = execution(`const run=${run.toString()};return await run();`);
  assert.equal(instance.result.status, 1, String(instance.result.value)); assert.deepEqual(instance.result.value, expected);
});

test('string symbol dispatch cannot bypass intrinsic write protection', () => {
  for (const [method, symbol] of [['replace', 'replace'], ['replaceAll', 'replace'], ['split', 'split']] as const) {
    const key = '__bearImplicitWrite';
    try {
      const { instance } = execution(`return String.prototype.${method}.call(Object,
        {[Symbol.${symbol}]:Object.assign},{${key}:1});`);
      assert.equal(instance.result.status, 2, method);
      assert.match(String(instance.result.value), /shared intrinsic/, method);
      assert.equal(Object.hasOwn(Object, key), false, method);
    } finally { Reflect.deleteProperty(Object, key); }
  }
});

test('implicit symbol calls and regexp replacement callbacks obey the same native whitelist', () => {
  for (const expression of [
    `'x'.search({[Symbol.search]:Number.prototype.toLocaleString})`,
    `'x'.replace(/x/,Number.prototype.toLocaleString)`,
    `RegExp.prototype[Symbol.replace].call(/x/,'x',Number.prototype.toLocaleString)`,
    `[1].toLocaleString()`,
    `new Uint8Array([1]).map(Number.prototype.toLocaleString)`,
  ]) {
    const { instance } = execution(`return ${expression};`);
    assert.equal(instance.result.status, 2, expression);
    assert.match(String(instance.result.value), /not whitelisted/, expression);
  }
});

test('implicit V8 method dispatch cannot execute an ambient function', () => {
  for (const [receiver, expression] of [
    [`{toString:Date.now}`, `Object.prototype.toLocaleString.call(value)`],
    [`{join:Math.random}`, `Array.prototype.toString.call(value)`],
  ] as const) {
    const { instance: parent, artifact } = execution(`
      const value=${receiver};
      await io.call({port:'step',input:null});
      return ${expression};
    `);
    assert.equal(parent.result.status, 0, expression);
    const fork = parent.fork(), restored = new ProgramExecution(artifact);
    restored.restore(parent.snapshot());
    for (const instance of [parent, fork, restored]) {
      instance.resume(null);
      assert.equal(instance.result.status, 2, expression);
      assert.match(String(instance.result.value), /Ambient or dynamic execution/, expression);
    }
  }
});

test('generic array algorithms guard receiver length conversion after IO and restoration',()=>{
  for(const [method,args] of [
    ['at','0'],['includes','7'],['map','value=>value'],['sort',''],
    ['slice','0'],['splice','0,0'],['flat',''],['join',''],['concat','[]'],
  ] as const){
    const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
      const values={0:7,length:{valueOf:Date.now},[Symbol.isConcatSpreadable]:true};
      await io.call({port:'step',input:null});
      return Array.prototype.${method}.call(values${args?','+args:''});
    }};`).content);
    const parent=new ProgramExecution(artifact);parent.start(null);
    assert.equal(parent.result.status,0,method);
    const fork=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
    for(const current of [parent,fork,restored]){
      current.resume(null);
      assert.equal(current.hostViolation,true,method);
      assert.equal(current.result.status,2,method);
    }
  }
});

test('higher-order builtins cannot invoke ambient callbacks after IO or restoration',()=>{
  for(const expression of [
    'Array.from([1],Date.now)',
    'Object.groupBy([1],Date.now)',
    'Map.groupBy([1],Date.now)',
    '[1].map(Date.now)',
    '[2,1].sort(Date.now)',
    'new Uint8Array([1]).map(Date.now)',
    'Uint8Array.from([1],Date.now)',
    'new Map([[1,2]]).forEach(Date.now)',
    'new Set([1]).forEach(Date.now)',
    '"x".replace("x",Date.now)',
    '/x/[Symbol.replace]("x",Date.now)',
    'JSON.parse("1",Date.now)',
    'JSON.stringify(1,Date.now)',
    'JSON.stringify({toJSON(){return Date.now()}})',
    'Object.assign({}, {get x(){return Date.now()}})',
    'Reflect.get({get x(){return Date.now()}},"x",{})',
    'Reflect.set({set x(value){Date.now()}},"x",1,{})',
    'Reflect.construct(Map,[],Object.defineProperty((function(){}).bind(null),"prototype",{get(){return Date.now()}}))',
    '"ab".split({[Symbol.split]:Date.now})',
    '"ab".match({[Symbol.match]:Date.now})',
  ]){
    const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
      await io.call({port:'step',input:null});
      return ${expression};
    }};`).content);
    const parent=new ProgramExecution(artifact);parent.start(null);
    assert.equal(parent.result.status,0,expression);
    const fork=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
    for(const current of [parent,fork,restored]){
      current.resume(null);
      assert.equal(current.hostViolation,true,expression);
      assert.equal(current.result.status,2,expression);
    }
  }
});

test('descriptor fields and keys remain guarded after IO, fork and restore',()=>{
  for(const expression of [
    'Object.defineProperty({},"x",{get value(){return Date.now()}})',
    'Object.defineProperty({},"x",Object.create({get value(){return Date.now()}}))',
    'Object.defineProperties({}, {get x(){return {value:Date.now()}}})',
    'Object.create(null, {get x(){return {value:Date.now()}}})',
    'Object.defineProperty({}, {[Symbol.toPrimitive]:Date.now},{value:1})',
  ]){
    const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
      await io.call({port:'step',input:null});
      return ${expression};
    }};`).content);
    const parent=new ProgramExecution(artifact);parent.start(null);
    assert.equal(parent.result.status,0,expression);
    const fork=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
    for(const current of [parent,fork,restored]){
      current.resume(null);
      assert.equal(current.hostViolation,true,expression);
      assert.equal(current.result.status,2,expression);
    }
  }
});

test('descriptor getters and inherited fields preserve their native order across branches',()=>{
  const {instance,artifact}=execution(`
    const trace=[];
    const descriptor=Object.create({get enumerable(){trace.push('enumerable');return true;}});
    Object.defineProperty(descriptor,'value',{get(){trace.push('value');return 7;}});
    const key={[Symbol.toPrimitive](hint){trace.push('key:'+hint);return 'x';}};
    const table={get y(){trace.push('table');return {value:9,enumerable:true};}};
    await io.call({port:'step',input:null});
    const target={};
    Object.defineProperty(target,key,descriptor);
    const created=Object.create(null,table);
    return [trace,Object.entries(target),Object.entries(created)];
  `);
  assert.equal(instance.result.status,0);
  const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  for(const current of [instance,fork,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,[['key:string','enumerable','value','table'],[['x',7]],[['y',9]]]);
  }
});

test('typed-array callbacks cannot mutate shared intrinsics through reduce', () => {
  try {
    const { instance } = execution('return new Uint8Array([7]).reduce(Object.assign,Object);');
    assert.equal(instance.result.status, 2);
    assert.match(String(instance.result.value), /shared intrinsic/);
    assert.equal(Object.hasOwn(Object, '0'), false);
  } finally { Reflect.deleteProperty(Object, '0'); }
});

test('legacy RegExp ambient accessors are excluded from direct, inherited and reflective reads', () => {
  for (const expression of [
    `RegExp.$1`, `RegExp['lastMatch']`, `Object.create(RegExp).$1`,
    `Reflect.get(RegExp,'$1')`,
    `Object.getOwnPropertyDescriptor(RegExp,'$1').get.call(RegExp)`,
    `Reflect.set(Object.create(RegExp),'input','new ambient value')`,
  ]) {
    const { instance } = execution(`return ${expression};`);
    assert.equal(instance.result.status, 2, expression);
    assert.match(String(instance.result.value), /Unsupported native/, expression);
  }
  // Legacy statics are non-enumerable: these operations read none of them.
  const { instance } = execution(`return [Object.assign({},RegExp),Object.values(RegExp),Object.entries(RegExp)];`);
  assert.equal(instance.result.status, 1); assert.deepEqual(instance.result.value, [{}, [], []]);
});

test('RegExp execution must not change host legacy match state across IO or restoration', () => {
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});
    /(inside)/.exec('inside');
    return 1;
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0);
  const fork=parent.fork(),restored=new ProgramExecution(artifact);restored.restore(parent.snapshot());
  for(const current of [parent,fork,restored]){
    /(outside)/.exec('outside');
    assert.equal(RegExp.$1,'outside');
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.equal(RegExp.$1,'outside','program RegExp mutated host match state');
  }
});

test('host intrinsic mutations must not enter a paused Program or its branches', () => {
  const key='__bear_host_mutation_probe__';
  assert.equal(Object.hasOwn(Object,key),false);
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});
    return Object.hasOwn(Object,'${key}');
  }};`).content);
  const parent=new ProgramExecution(artifact);
  parent.start(null);
  const fork=parent.fork(),restored=new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  try {
    Object.defineProperty(Object,key,{value:7,configurable:true});
    for(const current of [parent,fork,restored]) {
      current.resume(null);
      assert.equal(current.result.status,1,String(current.result.value));
      assert.equal(current.result.value,false,'program observed a host intrinsic mutation');
    }
  } finally {
    Reflect.deleteProperty(Object,key);
    parent.dispose(); fork.dispose(); restored.dispose();
  }
});

test('Promise catch uses the same invocation boundary for an overridden then', () => {
  const { instance, artifact } = execution(`
    const promise=Promise.resolve(1);promise[0]='a';promise[1]='b';promise.length=2;
    promise.then=Array.prototype.values;const iterator=promise.catch(null);
    await io.call({port:'step',input:iterator.next().value});return iterator.next().value;
  `);
  assert.equal(instance.io.callData.input, 'a');
  const branch = instance.fork(), restored = new ProgramExecution(artifact); restored.restore(instance.snapshot());
  for (const current of [instance, branch, restored]) {
    current.resume(null); assert.equal(current.result.status, 1, String(current.result.value)); assert.equal(current.result.value, 'b');
  }
});

test('generator return and throw do not dispatch through an author-owned next property', async () => {
  async function run() {
    const log: string[] = [];
    function* values() { try { yield 1; } catch (error) { log.push(String(error)); } finally { log.push('finally'); } }
    const one = values(), two = values(); one.next(); two.next();
    one.next = two.next = () => { throw Error('author next must not be called'); };
    return [one.return(7 as never), two.throw('caught'), log];
  }
  const expected = await run(), { instance } = execution(`const run=${run.toString()};return await run();`);
  assert.equal(instance.result.status, 1, String(instance.result.value)); assert.deepEqual(instance.result.value, expected);
});

test('guarded reflection and enumeration retain receiver, symbol and descriptor semantics', async () => {
  async function run() {
    const log: string[] = [], symbol = Symbol('entry');
    const source = { get a() { log.push('get a'); return 1; }, [symbol]: 2 };
    const receiver = { a: 4, b: 0 };
    const prototype = { get value() { return this.a; }, set value(value) { this.b = value; }, a: 0, b: 0 };
    const before = Reflect.get(prototype, 'value', receiver);
    const changed = Reflect.set(prototype, 'value', 9, receiver);
    const target = { set a(value: number) { log.push(`set ${value}`); } };
    const assigned = Object.assign(target, source, null);
    const frozen = Object.freeze({ value: 1 });
    return [before, changed, receiver.b, prototype.b, assigned === target, assigned[symbol],
      Reflect.set(frozen, 'value', 3), Object.entries(source), Object.values(source), log];
  }
  const expected = await run(), { instance } = execution(`const run=${run.toString()};return await run();`);
  assert.equal(instance.result.status, 1, String(instance.result.value)); assert.deepEqual(instance.result.value, expected);
});

test('RegExp native protocols reject custom exec, species and coercion races before using them', () => {
  for (const body of [
    `const re=/x/;re.exec=Array.prototype.values;return re[Symbol.match]('x');`,
    `const re=/x/;re.constructor={[Symbol.species]:function(){throw Error('species ran');}};return re[Symbol.split]('x');`,
    `const re=/x/;return re[Symbol.match]({toString(){re.exec=Array.prototype.values;return 'x';}});`,
    `const re=/x/g;Object.defineProperty(re,'global',{get(){throw Error('getter ran');}});return re[Symbol.match]('x');`,
    `const re=/x/;re.lastIndex={ [Symbol.toPrimitive]:Date.now };return re[Symbol.match]('x');`,
    `const re=/x/;re.lastIndex={ [Symbol.toPrimitive]:Date.now };return re[Symbol.replace]('x','y');`,
  ]) {
    const { instance } = execution(body);
    assert.equal(instance.result.status, 2, body);
    assert.match(String(instance.result.value), /Unsupported RegExp protocol/, body);
  }
});

test('RegExp split converts an object limit once through controlled operations across branches', () => {
  const {instance, artifact} = execution(`
    const trace=[];
    const limit={ [Symbol.toPrimitive](hint){trace.push(hint);return 2;} };
    await io.call({port:'step',input:0});
    return {parts:/,/[Symbol.split]('a,b,c',limit),trace};
  `);
  const branch=instance.fork(), restored=new ProgramExecution(artifact); restored.restore(instance.snapshot());
  for(const current of [instance,branch,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,{parts:['a','b'],trace:['number']});
  }
  const ambient=execution(`
    const limit={ [Symbol.toPrimitive]:Date.now };
    await io.call({port:'step',input:0});
    return /,/[Symbol.split]('a,b',limit);
  `);
  const forbidden=ambient.instance.fork(), recovered=new ProgramExecution(ambient.artifact);
  recovered.restore(ambient.instance.snapshot());
  for(const current of [ambient.instance,forbidden,recovered]){
    current.resume(null);
    assert.equal(current.result.status,2);
    assert.equal(current.hostViolation,true);
  }
});

test('RegExp search and split preserve an unused object lastIndex across IO branches', () => {
  const {instance,artifact}=execution(`
    const marker={ [Symbol.toPrimitive](){throw Error('lastIndex was converted');} };
    const search=/a/, split=/a/;
    search.lastIndex=marker; split.lastIndex=marker;
    await io.call({port:'step',input:0});
    return [search[Symbol.search]('aba'),search.lastIndex===marker,
      split[Symbol.split]('aba'),split.lastIndex===marker];
  `);
  const branch=instance.fork(), restored=new ProgramExecution(artifact); restored.restore(instance.snapshot());
  for(const current of [instance,branch,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,[0,true,['','b',''],true]);
  }
});

test('global RegExp match and replace reset object lastIndex without converting it', () => {
  const {instance,artifact}=execution(`
    const marker={ [Symbol.toPrimitive](){throw Error('lastIndex was converted');} };
    const match=/a/g, replace=/a/g;
    match.lastIndex=marker; replace.lastIndex=marker;
    await io.call({port:'step',input:0});
    return [match[Symbol.match]('aba'),match.lastIndex,
      replace[Symbol.replace]('aba','x'),replace.lastIndex];
  `);
  const branch=instance.fork(), restored=new ProgramExecution(artifact); restored.restore(instance.snapshot());
  for(const current of [instance,branch,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,[['a','a'],0,'xbx',0]);
  }
});

test('RegExp match and replace reject a public global loop with a non-global matcher', () => {
  for(const body of [
    `const re=/a/;Object.defineProperty(re,'global',{value:true});return re[Symbol.match]('b');`,
    `const re=/a/;Object.defineProperty(re,'global',{value:true});return re[Symbol.replace]('b','x');`,
  ]){
    const {instance}=execution(body);
    assert.equal(instance.result.status,2,body);
    assert.match(String(instance.result.value),/conflicting global flag/,body);
  }
  const {instance}=execution(`const re=/a/g;Object.defineProperty(re,'global',{value:true});
    return re[Symbol.match]('aba');`);
  assert.equal(instance.result.status,1,String(instance.result.value));
  assert.deepEqual(instance.result.value,['a','a']);
});

test('RegExp match and replace use one exec when the public global flag is false', () => {
  const native = () => {
    const match=/a/g,replace=/a/g;
    Object.defineProperty(match,'global',{value:false});
    Object.defineProperty(replace,'global',{value:false});
    match.lastIndex=replace.lastIndex=1;
    return [match[Symbol.match]('baaa'),match.lastIndex,
      replace[Symbol.replace]('baaa','X'),replace.lastIndex];
  };
  const expected=native();
  const {instance,artifact}=execution(`
    const match=/a/g,replace=/a/g;
    Object.defineProperty(match,'global',{value:false});
    Object.defineProperty(replace,'global',{value:false});
    match.lastIndex=replace.lastIndex=1;
    await io.call({port:'step',input:null});
    return [match[Symbol.match]('baaa'),match.lastIndex,
      replace[Symbol.replace]('baaa','X'),replace.lastIndex];
  `);
  assert.equal(instance.result.status,0);
  const branch=instance.fork(),restored=new ProgramExecution(artifact);
  restored.restore(instance.snapshot());
  for(const current of [instance,branch,restored]){
    current.resume(null);
    assert.equal(current.result.status,1,String(current.result.value));
    assert.deepEqual(current.result.value,expected);
  }
});

test('RegExp test routes custom exec through ordinary invocation', () => {
  const { instance, artifact } = execution(`const re=/x/;re.exec=Array.prototype.values;
    let iterator;const object={exec(text){iterator=Array.prototype.values.call([text,9]);return iterator;}};
    const found=RegExp.prototype.test.call(object,'x');
    await io.call({port:'step',input:found});return [iterator.next().value,iterator.next().value,re.test('ignored')];`);
  assert.equal(instance.io.callData.input, true);
  const branch = instance.fork(), restored = new ProgramExecution(artifact); restored.restore(instance.snapshot());
  for (const current of [instance, branch, restored]) {
    current.resume(null); assert.equal(current.result.status, 1, String(current.result.value));
    assert.deepEqual(current.result.value, ['x', 9, true]);
  }
});

test('canonical regex and typed-array methods agree with direct native execution', async () => {
  async function run() {
    const re = /a/g;
    const matches = re[Symbol.match]('aba');
    re.lastIndex = 1; const index = re[Symbol.search]('aba'), position = re.lastIndex;
    const replaced = 'aba'.replace(re, (value, index) => `${index}${value}`);
    const split = 'a,b,c'.split(/,/, 2);
    const bytes = new Uint8Array([3, 1, 2]);
    return [matches, index, position, replaced, split, bytes.map(x => x * 2).reduce((a, b) => a + b, 0)];
  }
  const expected = await run(), { instance } = execution(`const run=${run.toString()};return await run();`);
  assert.equal(instance.result.status, 1, String(instance.result.value)); assert.deepEqual(instance.result.value, expected);
});

test('implicit method results receive persistable iterator adapters', () => {
  for (const expression of [
    `'ignored'.split(source)`,
    `'ignored'.replace(source,'unused')`,
    `'ignored'.search(source)`,
    `Array.prototype.toString.call(source)`,
    `Object.prototype.toLocaleString.call(source)`,
  ]) {
    const { instance, artifact } = execution(`
      const source={0:'a',1:'b',length:2,[Symbol.split]:Array.prototype.values,
        [Symbol.replace]:Array.prototype.values,[Symbol.search]:Array.prototype.values,
        join:Array.prototype.values,toString:Array.prototype.values};
      const iterator=${expression}; const first=iterator.next().value;
      await io.call({port:'step',input:first});
      return [first,iterator.next().value,iterator.next().done];
    `);
    assert.equal(instance.io.callData.input, 'a', expression);
    const branch = instance.fork(), restored = new ProgramExecution(artifact);
    restored.restore(instance.snapshot());
    for (const current of [instance, branch, restored]) {
      current.resume(null);
      assert.equal(current.result.status, 1, String(current.result.value));
      assert.deepEqual(current.result.value, ['a', 'b', true], expression);
    }
  }
});

test('string dispatch reads hooks once, retains callback identity and preserves coercion order', async () => {
  async function run() {
    const log: string[] = [];
    const receiver = { toString() { log.push('receiver'); return 'aba'; } };
    const missing = {
      get [Symbol.replace]() { log.push('replace'); return undefined; },
      get [Symbol.split]() { log.push('split'); return undefined; },
      get [Symbol.search]() { log.push('search'); return undefined; },
      toString() { log.push('pattern'); return 'b'; },
    };
    const replacement = () => 'X';
    const custom = { [Symbol.replace](value: unknown, callback: unknown) {
      log.push('custom'); return [value === receiver, callback === replacement];
    } };
    const first = String.prototype.replace.call(receiver, custom as any, replacement);
    const second = String.prototype.replace.call(receiver, missing as any, replacement);
    const third = String.prototype.split.call(receiver, missing as any, { valueOf() { log.push('limit'); return 0; } } as any);
    const fourth = String.prototype.search.call(receiver, missing as any);
    const flags = { get [Symbol.match]() { log.push('match'); return true; },
      get flags() { log.push('flags'); return 'g'; },
      get [Symbol.replace]() { log.push('getAll'); return function(value: unknown) { return value === receiver; }; } };
    const fifth = String.prototype.replaceAll.call(receiver, flags as any, replacement);
    const errors: string[] = [];
    for (const operation of [() => 'x'.replaceAll(/x/, 'y'),
      () => String.prototype.replace.call(null, custom as any, replacement),
      () => 'x'.split(Symbol('x') as any), () => 'x'.replace({ [Symbol.replace]: 1 } as any, 'y')]) {
      try { operation(); } catch (error) { errors.push((error as Error).name); }
    }
    return [first, second, third, fourth, fifth, errors, log];
  }
  const expected = await run();
  const { instance } = execution(`const run=${run.toString()};return await run();`);
  assert.equal(instance.result.status, 1, String(instance.result.value));
  assert.deepEqual(instance.result.value, expected);
});

test('adapted iterable results and captured callbacks preserve aliases across IO, fork and restore', async () => {
  async function run(io: {call(value:unknown):Promise<number>}) {
    const values=[{score:1},{score:2},{score:3}], offset=5;
    const mapped=Array.from(values,(item,index)=>({item,index:index+offset}));
    const entries=Object.fromEntries(mapped.map(row=>[String(row.index),row.item]));
    const groups=(Object as any).groupBy(values,(item:{score:number})=>item.score%2);
    const map=(Map as any).groupBy(values,(item:{score:number})=>item.score%2);
    const amount=await io.call({port:'step',input:groups['1'].length});
    entries['5']!.score+=amount;
    return [Object.getPrototypeOf(groups)===null,mapped[0]!.item===entries['5'],map.get(1)[0]===entries['5'],
      groups['1'].map((item:{score:number})=>item.score),Array.from(map.keys()),mapped.map(row=>row.index)];
  }
  const expected=await run({async call(){return 7;}}), alternate=await run({async call(){return 9;}});
  const {instance,artifact}=execution(`return await (${run.toString()})(io);`);
  assert.equal(instance.io.callData.input,2);
  const fork=instance.fork(), restored=new ProgramExecution(artifact);
  restored.restore(instance.snapshot());
  instance.resume(7);fork.resume(9);restored.resume(7);
  for (const item of [instance,fork,restored]) assert.equal(item.result.status,1,String(item.result.value));
  assert.deepEqual(instance.result.value,expected);assert.deepEqual(restored.result.value,expected);
  assert.deepEqual(fork.result.value,alternate);
});

test('AggregateError iterable entries and cause retain aliases through IO, fork and restore', () => {
  const {instance,artifact}=execution(`
    const shared={value:7};
    const first=new AggregateError([shared,shared],'first',{cause:shared});
    const second=AggregateError([first,shared],'second',{cause:first});
    const amount=await io.call({port:'step',input:first.errors.length});
    first.errors[0].value+=amount;
    return [first instanceof AggregateError,second instanceof AggregateError,
      first.errors[0]===first.errors[1],first.cause===first.errors[0],second.errors[0]===first,
      second.cause===first,second.errors[1].value,Object.getOwnPropertyDescriptor(first,'errors').enumerable];
  `);
  assert.equal(instance.io.callData.input,2);
  const fork=instance.fork(), restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  instance.resume(3);fork.resume(5);restored.resume(3);
  for(const [item,value] of [[instance,10],[fork,12],[restored,10]] as const){
    assert.equal(item.result.status,1,String(item.result.value));
    assert.deepEqual(item.result.value,[true,true,true,true,true,true,value,false]);
  }
});

test('typed sequence construction retains captured callbacks and buffer aliases across IO and branches', () => {
  const {instance,artifact}=execution(`
    let offset=2;
    const values=[3,5];
    const arrayLike={length:2,get 0(){return values[0];},get 1(){return values[1];}};
    const from=Uint16Array.from(arrayLike,value=>value+offset);
    const constructed=new Uint16Array(values);
    const alias=new Uint16Array(from.buffer);
    const amount=await io.call({port:'step',input:from[0]+constructed[0]});
    offset+=amount;
    alias[0]+=amount;
    const later=Uint16Array.from(values,value=>value+offset);
    function collect(a,b){return [a,b];}
    return [from[0],constructed[0],later[0],alias.buffer===from.buffer,
      Reflect.apply(collect,null,arrayLike),collect.apply(null,arrayLike)];
  `);
  assert.equal(instance.io.callData.input,8);
  const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  instance.resume(3);fork.resume(7);restored.resume(3);
  for(const [item,value] of [[instance,8],[fork,12],[restored,8]] as const){
    assert.equal(item.result.status,1,String(item.result.value));
    assert.deepEqual(item.result.value,[value,3,value,true,[3,5],[3,5]]);
  }
});

test('guarded native array traversals retain original sources and results across IO/fork/restore', () => {
  const {instance,artifact}=execution(`
    const source=[3,1,2];
    const references=source.map((value,index,array)=>array);
    const sorted=source.sort((a,b)=>a-b);
    const plain={value:7};
    const combined=[].concat(plain,{0:source,length:1,[Symbol.isConcatSpreadable]:true});
    const flattened=source.flatMap(()=>[references]);
    const amount=await io.call({port:'step',input:source[0]});
    source[0]+=amount;plain.value+=amount;
    return [references[0]===source,references[1]===source,sorted===source,
      combined[0]===plain,combined[1]===source,flattened[0]===references,
      references[0][0],combined[0].value];
  `);
  assert.equal(instance.io.callData.input,1);
  const fork=instance.fork(),restored=new ProgramExecution(artifact);restored.restore(instance.snapshot());
  instance.resume(2);fork.resume(4);restored.resume(2);
  for(const [item,value] of [[instance,3],[fork,5],[restored,3]] as const){
    assert.equal(item.result.status,1,String(item.result.value));
    assert.deepEqual(item.result.value,[true,true,true,true,true,true,value,value+6]);
  }
});

test('RegExp index conversion keeps captures and mutations through IO fork and restore',async()=>{
  async function run(io:any){
    const trace:unknown[]=[];
    let start=0;
    const regexp=/a/g;
    const index={valueOf(){trace.push(['index',start,this===index,regexp.lastIndex===index as any]);return start;}};
    regexp.lastIndex=index as any;
    start=await io.call({port:'step',input:null});
    const match=regexp.exec('baab');
    const after=regexp.lastIndex;
    const nonglobal=/a/;
    nonglobal.lastIndex={valueOf(){nonglobal.lastIndex=19;return start;}} as any;
    const test=nonglobal.test('baab');
    return {match:match?{text:match[0],index:match.index}:null,after,test,nonGlobalIndex:nonglobal.lastIndex,trace};
  }
  const {instance:parent}=execution(`const run=${run.toString()};return await run(io);`);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot(),fork=parent.fork(),restored=parent.fresh();restored.restore(snapshot);
  for(const [index,instance]of[parent,fork,restored].entries()){
    const reply=[0,2,9][index]!,expected=await run({call:async()=>reply});instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);
  }
});
