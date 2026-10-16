import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {CowStore} from '../src/cow-store.ts';
import {createOperations} from '@bear-forge/runtime';
const require = createRequire(import.meta.url);

test('module initialization and schema boundaries read logical exports and return isolated branch data', async () => {
  const {compileJavaScript} = await import('@bear-forge/compiler');
  const {ProgramExecution,decode} = await import('../src/execution.ts');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const artifact=decode(compileJavaScript(`
    const schema={_zod:{def:{type:'unknown'}},parse(value){value.child.count++;return value;}};
    export const program={schemas:{setup:schema,result:schema,ports:{}},async run(){return -1;},
      get unused(){throw Error('must not inspect extras');}};
    program.run=async function(input){input.child.count=4;input.alias=input.child;input.self=input;delete input.old;return input;};
  `).content);
  const instance=new ProgramExecution(artifact),state=instance.loaded.effects.State.context;
  state.objects=new CowHeap();
  try {
    instance.admitSchemas();
    const input={child:{count:1},old:true};instance.start(input);
    assert.equal(instance.result.status,1,String(instance.result.value));
    const result=instance.result.value;
    assert.equal(result.child.count,4);assert.strictEqual(result.alias,result.child);assert.strictEqual(result.self,result);
    assert.equal('old' in result,false);assert.equal(input.child.count,1);
    const parsed=instance.boundarySchemas().setup.parse(input);
    assert.equal(parsed.child.count,2);assert.equal(input.child.count,1);
    parsed.child.count=99;assert.equal(instance.result.value.child.count,4);
  } finally { state.objects=undefined;instance.dispose(); }
});

test('logical boundary inspection rejects branch accessors without invoking them', async () => {
  const {copy,keys} = await import('@bear-forge/boundary');
  const {assertProgramModuleShape,assertProgramSchemasShape} = await import('@bear-forge/runtime');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects=require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:100000};
  const parent=new CowHeap();context.objects=parent;
  const port=ops.allocation({input:{},output:{}}),ports=ops.allocation({ask:port});
  const schemas=ops.allocation({setup:{},result:{},ports}),module=ops.allocation({schemas,run(){}});
  const child=parent.fork();context.objects=child;
  const inspection={getPrototypeOf:(value: object)=>child.has(value)?child.getPrototypeOf(value):Object.getPrototypeOf(value),
    getOwnPropertyDescriptor:(value: object,key: PropertyKey)=>child.has(value)?child.getOwnPropertyDescriptor(value,key):Object.getOwnPropertyDescriptor(value,key),
    ownKeys:(value: object)=>child.has(value)?child.ownKeys(value):Reflect.ownKeys(value)};
  let calls=0;
  ops.invoke(Object.defineProperty,Object,[port,'input',{get(){calls++;return {};},enumerable:true,configurable:true}]);
  assert.throws(()=>assertProgramSchemasShape(schemas,inspection),/data properties/);
  assert.throws(()=>keys(port,inspection),/data properties/);
  assert.throws(()=>copy(port,inspection),/data properties/);
  ops.invoke(Object.defineProperty,Object,[module,'run',{get(){calls++;return ()=>{};},enumerable:true,configurable:true}]);
  assert.throws(()=>assertProgramModuleShape(module,inspection),/Invalid ProgramModule/);
  assert.equal(calls,0);
  const parentInspection={getPrototypeOf:(value: object)=>parent.has(value)?parent.getPrototypeOf(value):Object.getPrototypeOf(value),
    getOwnPropertyDescriptor:(value: object,key: PropertyKey)=>parent.has(value)?parent.getOwnPropertyDescriptor(value,key):Object.getOwnPropertyDescriptor(value,key),
    ownKeys:(value: object)=>parent.has(value)?parent.ownKeys(value):Reflect.ownKeys(value)};
  assert.doesNotThrow(()=>assertProgramModuleShape(module,parentInspection));
  assert.doesNotThrow(()=>assertProgramSchemasShape(schemas,parentInspection));
});

test('schema admission follows branch definitions, lazy references and logical option arrays', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects=require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:100000};
  const parent=new CowHeap();context.objects=parent;
  const def=ops.allocation({type:'number'}),leaf=ops.allocation({_zod:ops.allocation({def})});
  let lazyReads=0;
  const lazy={_zod:{def:{type:'lazy',getter(){lazyReads++;return leaf;}}}};
  const options=ops.allocation([lazy]),union={_zod:{def:{type:'union',options}}};
  assert.doesNotThrow(()=>effects.admitSchema(union));assert.equal(lazyReads,1);
  context.objects=parent.fork();
  ops.set(ops.ref(def,'type'),'transform');
  assert.throws(()=>effects.admitSchema(union),/Value-changing/);
  ops.set(ops.ref(def,'type'),'number');
  ops.arrayAppend(options,{_zod:{def:{type:'default'}}});
  assert.throws(()=>effects.admitSchema(union),/Value-changing/);
  context.objects=parent;assert.doesNotThrow(()=>effects.admitSchema(union));
});

test('compiled spread argument buffers retain the parent prefix when a later operand branches', async () => {
  const {transformSync} = await import('@babel/core');
  const {guardedOperations} = await import('../../compiler/src/operations.ts');
  const {CowHeap} = await import('../src/cow-heap.ts');
  for (const expression of ['collect(...[1],checkpoint())','new Pair(...[1],checkpoint())']) {
    const effects = require('../dist/effects.cjs')(), context = effects.State.context;
    const ops = effects.installOperations(createOperations); context.active={remaining:100000};
    const parent=new CowHeap();context.objects=parent;
    const allocated: any[]=[];
    const instrumented={...ops,allocation(value: any){allocated.push(value);return ops.allocation(value);}};
    let buffer: any;
    const checkpoint=()=>{
      buffer=allocated.find(value=>Array.isArray(value)&&value.length===0&&ops.get(ops.ref(value,'length'))===1);
      assert.ok(buffer);context.objects=parent.fork();return 2;
    };
    const code=transformSync('function run(){return '+expression+';}',{configFile:false,babelrc:false,
      plugins:[[guardedOperations,{allocations:true}]]})!.code!;
    const result=Function('__bearOps','collect','Pair','checkpoint',code+';return run();')(
      instrumented,(...values: unknown[])=>values,function(this: any,...values: unknown[]){this.values=values;},checkpoint);
    assert.deepEqual(expression.startsWith('new')?result.values:result,[1,2]);
    assert.equal(ops.get(ops.ref(buffer,'length')),2);
    context.objects=parent;
    assert.equal(ops.get(ops.ref(buffer,'length')),1);
    assert.equal(ops.get(ops.ref(buffer,'1')),undefined);
  }
});

test('lexical bindings and iterator records isolate pending state and restore with cleanup stacks', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(), slots = new CowStore<any>(); context.objects=parent; context.intrinsicSlots=slots;
  const variable = ops.lexicalCreate(true), constant = ops.lexicalCreate(false);
  assert.throws(()=>ops.lexicalRead(variable),ReferenceError);
  const reference = ops.lexicalReference(variable), stack = ops.allocation([]);
  const record = ops.iteratorPush(stack,ops.allocation([1,2]));
  const child = parent.fork(), childSlots = slots.fork(); context.objects=child; context.intrinsicSlots=childSlots;
  ops.lexicalInitialize(variable,10); ops.lexicalInitialize(constant,3);
  ops.set(ops.ref(reference,'value'),11);
  assert.throws(()=>ops.lexicalWrite(constant,4),TypeError);
  assert.throws(()=>ops.lexicalInitialize(variable,0),/twice/);
  const copied = ops.lexicalCopy(variable); ops.lexicalWrite(copied,12);
  assert.equal(ops.lexicalRead(variable),11);
  assert.equal(ops.iteratorStep(record),1);
  const roots = {variable,constant,reference,stack,record,copied};
  const snapshot = effects.S.write(roots), copy = effects.prepareCopy(roots,null,null);
  for (const restore of [()=>effects.S.read(snapshot),copy]) {
    context.objects=new CowHeap(); context.intrinsicSlots=new CowStore<any>();
    const restored=restore();
    assert.equal(ops.get(ops.ref(restored.reference,'value')),11);
    ops.set(ops.ref(restored.reference,'value'),20);
    assert.equal(ops.lexicalRead(restored.variable),20);
    assert.equal(ops.lexicalRead(restored.copied),12);
    assert.throws(()=>ops.lexicalWrite(restored.constant,0),TypeError);
    assert.strictEqual(ops.get(ops.ref(restored.stack,'0')),restored.record);
    assert.equal(ops.iteratorStep(restored.record),2);
    ops.iteratorFinish(restored.stack,restored.record);
    assert.equal(ops.get(ops.ref(restored.stack,'length')),0);
    assert.equal(restored.record.done,true);
  }
  context.objects=child; context.intrinsicSlots=childSlots;
  ops.iteratorDrain(stack,0,false);
  assert.equal(record.done,true); assert.equal(ops.get(ops.ref(stack,'length')),0);
  context.objects=parent; context.intrinsicSlots=slots;
  assert.throws(()=>ops.lexicalRead(variable),ReferenceError);
  assert.throws(()=>ops.lexicalRead(constant),ReferenceError);
  assert.equal(record.done,false); assert.equal(ops.get(ops.ref(stack,'length')),1);
  assert.equal(ops.iteratorStep(record),1);
});

test('COW iterator cleanup preserves LIFO close order and abrupt-completion precedence', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active={remaining:100000};
  const parent=new CowHeap(),slots=new CowStore<any>();context.objects=parent;context.intrinsicSlots=slots;
  const closed: number[] = [], errors=[new Error('outer'),new Error('inner')];
  const stack=ops.allocation([]);
  for(let i=0;i<2;i++)ops.iteratorPush(stack,{[Symbol.iterator](){return {next(){return {done:false,value:i};},return(){closed.push(i);throw errors[i];}};}});
  const child=parent.fork(),childSlots=slots.fork();context.objects=child;context.intrinsicSlots=childSlots;
  assert.throws(()=>ops.iteratorDrain(stack,0,false),error=>error===errors[1]);
  assert.deepEqual(closed,[1,0]);assert.equal(ops.get(ops.ref(stack,'length')),0);
  context.objects=parent;context.intrinsicSlots=slots;closed.length=0;
  assert.equal(ops.get(ops.ref(stack,'length')),2);
  ops.iteratorDrain(stack,0,true);
  assert.deepEqual(closed,[1,0]);assert.equal(ops.get(ops.ref(stack,'length')),0);
});

test('array species admission reads current branch properties and inherited constructors', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active={remaining:100000};
  const parent=new CowHeap();context.objects=parent;
  const array=ops.allocation([1,2]),prototype=ops.allocation(Object.create(Array.prototype));
  ops.invoke(Object.setPrototypeOf,Object,[array,prototype]);
  context.objects=parent.fork();
  ops.set(ops.ref(prototype,'constructor'),function Custom(){});
  for(const method of [Array.prototype.slice,Array.prototype.map,Array.prototype.filter,Array.prototype.flat])
    assert.throws(()=>ops.invoke(method,array,[()=>true]),/species/);
  ops.invoke(Reflect.deleteProperty,Reflect,[prototype,'constructor']);
  let calls=0;
  ops.invoke(Object.defineProperty,Object,[array,'constructor',{get(){calls++;return Array;},configurable:true}]);
  assert.throws(()=>ops.invoke(Array.prototype.slice,array,[]),/constructor accessor/);
  assert.equal(calls,0);
  context.objects=parent;
  assert.equal(ops.invoke(JSON.stringify,JSON,[ops.invoke(Array.prototype.slice,array,[])]),'[1,2]');
});

test('compiled literal allocations enter the active object heap before subsequent writes', async () => {
  const {transformSync} = await import('@babel/core');
  const {guardedOperations} = await import('../../compiler/src/operations.ts');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
  const parent = new CowHeap(); context.objects = parent;
  const code = transformSync(`function make(){
    const object={value:1}, sparse=[,object,,];
    const spread=[0,...sparse,4];
    return {object,sparse,spread};
  }`, {configFile:false,babelrc:false,plugins:[[guardedOperations,{allocations:true}]]})!.code!;
  const result = Function('__bearOps', code + ';return make();')(ops);
  const object = ops.get(ops.ref(result, 'object')), sparse = ops.get(ops.ref(result, 'sparse')), spread = ops.get(ops.ref(result, 'spread'));
  for (const identity of [result,object,sparse,spread]) assert.equal(parent.has(identity), true);
  assert.equal(ops.get(ops.ref(sparse, 'length')), 3);
  assert.deepEqual(ops.invoke(Reflect.ownKeys, Reflect, [sparse]), ['1','length']);
  assert.equal(ops.get(ops.ref(spread, 'length')), 5);
  assert.strictEqual(ops.get(ops.ref(spread, '2')), object);
  const created = [ops.invoke(Array.from, Array, [sparse]), ops.invoke(Array.from, Array, [{length:2,0:object}]),
    ops.invoke(Object.fromEntries, Object, [[['item',object]]]), ops.invoke(Object.create, Object, [null]),
    ops.construct(Array, [3]), ops.invoke(Array, undefined, [3]), ops.objectRest(object, []),
    ops.iteratorRest(ops.iteratorOpen(sparse)), ops.invoke(Array.prototype.flat, [sparse], [])];
  for (const identity of created) {
    assert.equal(parent.has(identity), true);
    ops.set(ops.ref(identity, 'branch'), 1);
  }
  context.objects = parent.fork();
  for (const identity of created) ops.set(ops.ref(identity, 'branch'), 2);
  ops.set(ops.ref(object, 'value'), 9); ops.set(ops.ref(spread, '0'), 8);
  context.objects = parent;
  for (const identity of created) assert.equal(ops.get(ops.ref(identity, 'branch')), 1);
  assert.equal(ops.get(ops.ref(object, 'value')), 1);
  assert.equal(ops.get(ops.ref(spread, '0')), 0);
});

test('array, grouping and reflection results register nested mutable output identities', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(); context.objects = parent;
  const input = ops.allocation([1,2,3]), object = ops.allocation({a:1,b:2});
  const outputs = [
    ops.invoke(Array.prototype.slice,input,[1]), ops.invoke(Array.prototype.splice,ops.allocation([1,2,3]),[1,1]),
    ops.invoke(Array.prototype.map,input,[(x:number)=>x*2]), ops.invoke(Array.prototype.filter,input,[(x:number)=>x>1]),
    ops.invoke(Array.prototype.flatMap,input,[(x:number)=>ops.allocation([x,x])]),
    ops.invoke(Array.prototype.concat,input,[input]), ops.invoke(Array.prototype.toReversed,input,[]),
    ops.invoke(Array.prototype.toSorted,input,[(a:number,b:number)=>b-a]),
    ops.invoke(Array.prototype.toSpliced,input,[1,1,9]), ops.invoke(Array.prototype.with,input,[1,9]),
    ops.invoke(Array.of,Array,[1,2]), ops.invoke(Object.keys,Object,[object]),
    ops.invoke(Object.values,Object,[object]), ops.invoke(Object.entries,Object,[object]),
    ops.invoke(Object.getOwnPropertyDescriptor,Object,[object,'a']),
    ops.invoke(Object.getOwnPropertyDescriptors,Object,[object]),
    ops.invoke((Object as any).groupBy,Object,[input,(x:number)=>x%2]),
  ];
  const expected = [[2,3],[2],[2,4,6],[2,3],[1,1,2,2,3,3],[1,2,3,1,2,3],[3,2,1],[3,2,1],[1,9,3],[1,9,3],[1,2],
    ['a','b'],[1,2],[['a',1],['b',2]]];
  for (let i=0;i<expected.length;i++) assert.deepEqual(JSON.parse(ops.invoke(JSON.stringify,JSON,[outputs[i]])),expected[i]);
  const nested = [ops.get(ops.ref(outputs[13],'0')),ops.get(ops.ref(outputs[15],'a')),
    ops.get(ops.ref(outputs[16],'0')),ops.get(ops.ref(outputs[16],'1'))];
  assert.deepEqual(JSON.parse(ops.invoke(JSON.stringify,JSON,[outputs[16]])),{'0':[2],'1':[1,3]});
  for (const value of [...outputs,...nested]) assert.equal(parent.has(value),true);
  context.objects = parent.fork();
  for (const value of [...outputs,...nested]) ops.set(ops.ref(value,'branch'),true);
  context.objects = parent;
  for (const value of [...outputs,...nested]) assert.equal(ops.get(ops.ref(value,'branch')),undefined);
});

test('JSON registers nested results and escaping callback holders before authored callbacks', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(); context.objects = parent;
  const captured: object[] = [];
  const reviver = function(this: object, key: string, value: any, source: object) {
    assert.equal(parent.has(this),true); assert.equal(parent.has(source),true);
    captured.push(this,source);
    if (value !== null && typeof value==='object') assert.equal(parent.has(value),true);
    return key==='remove' ? undefined : value;
  };
  const plain = ops.invoke(JSON.parse,JSON,['{"items":[{"value":1}]}']);
  const revived = ops.invoke(JSON.parse,JSON,['{"items":[{"value":2,"remove":3}]}',reviver]);
  for (const value of [plain,revived]) {
    const array = ops.get(ops.ref(value,'items')), item = ops.get(ops.ref(array,'0'));
    for (const identity of [value,array,item]) { assert.equal(parent.has(identity),true); captured.push(identity); }
  }
  assert.equal(ops.invoke(JSON.stringify,JSON,[revived]),'{"items":[{"value":2}]}');
  ops.invoke(JSON.stringify,JSON,[plain,function(this: object,_key: string,value: any){
    assert.equal(parent.has(this),true); captured.push(this); return value;
  }]);
  context.objects = parent.fork();
  for (const value of captured) ops.set(ops.ref(value,'branch'),1);
  context.objects = parent;
  for (const value of captured) assert.equal(ops.get(ops.ref(value,'branch')),undefined);
});

test('runtime iterator and Promise result containers belong to the active object heap', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(); context.objects = parent; context.jobs = new effects.CowQueue();
  context.collectionMemory = new effects.CowCollections();
  const results: any[] = [];
  for (const [source, method, pair] of [[['a'],Array.prototype.entries,true],['a',String.prototype[Symbol.iterator],false],
    [new Map([['a',1]]),Map.prototype.entries,true],[new Set(['a']),Set.prototype.entries,true]] as const) {
    const iterator = ops.invoke(method,source,[]);
    const result = ops.invoke(iterator.next,iterator,[]); results.push(result);
    if (pair) results.push(ops.get(ops.ref(result,'value')));
    results.push(ops.invoke(iterator.next,iterator,[]));
  }
  const all = effects.Future.all([1,2]), settled = effects.Future.allSettled([1,effects.Future.reject('bad')]);
  const any = effects.Future.any([effects.Future.reject('bad')]);
  const resolvers = effects.Future.withResolvers(); results.push(resolvers);
  effects.drain();
  const allValues = effects.stateOf(all).value, settledValues = effects.stateOf(settled).value;
  results.push(allValues,settledValues,ops.get(ops.ref(settledValues,'0')),ops.get(ops.ref(settledValues,'1')),
    ops.get(ops.ref(effects.stateOf(any).value,'errors')));
  assert.equal(ops.invoke(JSON.stringify,JSON,[allValues]),'[1,2]');
  assert.equal(ops.invoke(JSON.stringify,JSON,[settledValues]),'[{"status":"fulfilled","value":1},{"status":"rejected","reason":"bad"}]');
  for (const value of results) assert.equal(parent.has(value),true);
  context.objects = parent.fork();
  for (const value of results) ops.set(ops.ref(value,'branch'),1);
  context.objects = parent;
  for (const value of results) assert.equal(ops.get(ops.ref(value,'branch')),undefined);
});

test('COW construction selects the branch prototype before author code and preserves new.target', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const {factorySource} = await import('../../compiler/src/factories.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(); context.objects = parent;
  const observations: any[] = [];
  const meta = {flags:8,handler(frame: any) {
    observations.push([frame.newTarget,ops.invoke(Object.getPrototypeOf,Object,[frame.self]),context.objects.has(frame.self)]);
    ops.set(ops.ref(frame.self,'value'),7);
    return effects.ret(frame.self);
  }};
  const factory = Function('return '+factorySource('Example',null,[],1,8,'ctx'))();
  const make = factory(null,null,null,context,meta,effects,effects.clos,effects.frame,effects.pushFrame);
  const fn = make(null,undefined,true);
  const original = ops.get(ops.ref(fn,'prototype')), replacement = parent.register({branch:true});
  const child = parent.fork(); context.objects = child;
  ops.set(ops.ref(fn,'prototype'),replacement);
  ops.invoke(Object.freeze,Object,[fn]);
  const instance = ops.construct(fn,[]);
  assert.deepEqual(observations.pop(),[fn,replacement,true]);
  assert.equal(ops.get(ops.ref(instance,'value')),7);
  const alternate = ops.invoke(Function.prototype.bind,fn,[undefined]);
  let reads = 0;
  ops.invoke(Object.defineProperty,Object,[alternate,'prototype',{get:function(this: unknown) {
    assert.strictEqual(this,alternate); reads++; return replacement;
  }}]);
  ops.construct(fn,[],alternate);
  assert.deepEqual(observations.pop(),[alternate,replacement,true]);
  assert.equal(reads,1);
  for (const Constructor of [Array,Map,Set,Number,RegExp,ArrayBuffer]) {
    const native = ops.construct(Constructor,[],alternate);
    assert.strictEqual(ops.invoke(Object.getPrototypeOf,Object,[native]),replacement);
  }
  assert.equal(reads,7);
  context.objects = parent;
  ops.construct(fn,[]);
  assert.deepEqual(observations.pop(),[fn,original,true]);
  assert.equal(ops.invoke(Object.isFrozen,Object,[fn]),false);
});

test('callable allocations register finalized generator prototypes and Promise callback metadata', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(); context.objects = parent;
  for (const clos of [effects.clos,effects.closA,effects.closG,effects.closAG]) {
    const closure: any[] = [];
    closure[effects.State.CLOSURE_FUNC] = function sample() {};
    const fn = clos(closure);
    assert.equal(parent.has(fn),true);
    assert.equal(parent.has(ops.get(ops.ref(fn,'prototype'))),true);
    assert.equal(Object.getOwnPropertyDescriptor(fn,'prototype')?.value,undefined,'native shell does not retain the logical prototype');
    assert.strictEqual(ops.invoke(Object.getPrototypeOf,Object,[fn]),Object.getPrototypeOf(fn));
    context.objects = parent.fork();
    ops.invoke(Object.defineProperty,Object,[fn,'name',{value:'child'}]);
    ops.set(ops.ref(ops.get(ops.ref(fn,'prototype')),'mark'),'child');
    context.objects = parent;
    assert.equal(ops.get(ops.ref(fn,'name')),'sample');
    assert.equal(ops.get(ops.ref(ops.get(ops.ref(fn,'prototype')),'mark')),undefined);
  }
  const resolvers = effects.Future.withResolvers();
  for (const key of ['resolve','reject']) {
    const callback = ops.get(ops.ref(resolvers,key));
    assert.equal(parent.has(callback),true);
    assert.equal(ops.get(ops.ref(callback,'name')),'');
    assert.equal(ops.get(ops.ref(callback,'length')),1);
  }
});

test('compiled class inheritance uses COW allocations and original constructor identities', async () => {
  const {compileJavaScript} = await import('@bear-forge/compiler');
  const {ProgramExecution,decode} = await import('../src/execution.ts');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(){
    class Base { constructor(){this.target=new.target;this.value=2;} }
    class Child extends Base { #extra=3; read(){return this.value+this.#extra;} }
    class Items extends Array {}
    const child=new Child(),items=new Items(2);items[0]=child;
    const bound=Child.bind(null),other=new bound();
    return [child.target===Child,child instanceof Child,child instanceof Base,child.read(),
      items instanceof Items,items instanceof Array,items.length,items[0]===child,other.target===Child];
  }};`).content);
  const instance = new ProgramExecution(artifact), internal = instance as any;
  // Module ingress is still being adapted separately. Exercise compiled bodies
  // with the real allocation hooks without claiming whole-Context COW support.
  instance.loaded.initializeContext(internal.context,artifact.exportName);
  instance.loaded.effects.State.context.objects = new CowHeap();
  try {
    instance.start(null);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,[true,true,true,5,true,true,2,true,true]);
  } finally { instance.loaded.effects.State.context.objects = undefined; instance.dispose(); }
});

test('function codecs and copies preserve branch properties, capture parents and bound aliases', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(); context.objects = parent;
  const meta = {func(captured: any, vars: any) {
    const closure: any[] = [];
    closure[effects.State.CLOSURE_PARENT] = captured;
    closure[effects.State.CLOSURE_VARS] = vars;
    closure[effects.State.CLOSURE_META] = meta;
    closure[effects.State.CLOSURE_FUNC] = function example() {};
    return effects.clos(closure);
  }};
  effects.S.regOpaqueObject(meta,'test.function-meta',{props:false});
  const captured = parent.register({value:7});
  const fn = meta.func(captured,captured);
  const bound = ops.invoke(Function.prototype.bind,fn,[captured,fn]);
  const child = parent.fork(); context.objects = child;
  ops.set(ops.ref(fn,'alias'),bound);
  ops.set(ops.ref(bound,'alias'),fn);
  ops.invoke(Reflect.deleteProperty,Reflect,[fn,'name']);
  ops.set(ops.ref(ops.get(ops.ref(fn,'prototype')),'mark'),'child');
  ops.invoke(Object.setPrototypeOf,Object,[fn,null]);
  ops.invoke(Object.freeze,Object,[bound]);
  const root = {fn,bound,captured,prototype:ops.get(ops.ref(fn,'prototype'))};
  const snapshot = effects.S.write(root), copy = effects.prepareCopy(root,null,null);
  for (const restore of [()=>effects.S.read(snapshot),copy]) {
    const restoredHeap = new CowHeap(); context.objects = restoredHeap;
    const restored = restore();
    assert.equal(restoredHeap.has(restored.fn),true);
    assert.equal(restoredHeap.has(restored.bound),true);
    assert.strictEqual(ops.get(ops.ref(restored.fn,'alias')),restored.bound);
    assert.strictEqual(ops.get(ops.ref(restored.bound,'alias')),restored.fn);
    assert.equal(ops.invoke(Object.hasOwn,Object,[restored.fn,'name']),false);
    assert.strictEqual(ops.invoke(Object.getPrototypeOf,Object,[restored.fn]),null);
    assert.equal(ops.invoke(Object.isFrozen,Object,[restored.bound]),true);
    assert.strictEqual(ops.get(ops.ref(restored.fn,'prototype')),restored.prototype);
    assert.strictEqual(ops.get(ops.ref(restored.prototype,'constructor')),restored.fn);
    assert.equal(ops.get(ops.ref(restored.prototype,'mark')),'child');
    const closure = effects.State.closures.get(restored.fn), binding = effects.State.binds.get(restored.bound);
    assert.strictEqual(closure[effects.State.CLOSURE_PARENT],restored.captured);
    assert.strictEqual(closure[effects.State.CLOSURE_VARS],restored.captured);
    assert.strictEqual(binding.fun,restored.fn);
    assert.strictEqual(binding.self,restored.captured);
    assert.strictEqual(binding.args[0],restored.fn);
  }
  context.objects = parent;
  assert.equal(ops.get(ops.ref(fn,'name')),'example');
  assert.equal(ops.get(ops.ref(ops.get(ops.ref(fn,'prototype')),'mark')),undefined);
  assert.equal(ops.invoke(Object.isFrozen,Object,[bound]),false);
});

test('generator creation and wrapper return use branch-local function prototypes', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(); context.objects = parent;
  const fn = parent.register(function generator() {});
  const original = ops.get(ops.ref(fn,'prototype')), replacement = parent.register({branch:true});
  const closure: any[] = [];
  closure[effects.State.CLOSURE_FUNC] = fn;
  closure[effects.State.CLOSURE_META] = {};
  const prototypeOf = (value: any) => ops.invoke(Object.getPrototypeOf,Object,[value]);
  const child = parent.fork(); context.objects = child;
  ops.set(ops.ref(fn,'prototype'),replacement);
  for (const frameFactory of [effects.frameG,effects.frameAG]) {
    assert.strictEqual(prototypeOf(frameFactory(closure).iter),replacement);
    context.objects = parent;
    assert.strictEqual(prototypeOf(frameFactory(closure).iter),original);
    context.objects = child;
  }
  for (const [flag, Constructor] of [
    [effects.State.Flag.GENERATOR_WRAPPER,effects.Generator],
    [effects.State.Flag.ASYNC_GENERATOR_WRAPPER,effects.AsyncGenerator],
  ]) {
    context.objects = parent;
    const result = parent.register({});
    context.objects = parent.fork();
    ops.set(ops.ref(fn,'prototype'),replacement);
    const frame = effects.frame(closure);
    frame.meta = {flags:flag,module:{api:effects}}; context.top = frame;
    assert.strictEqual(effects.ret(result),result);
    assert.strictEqual(prototypeOf(result),replacement);
    ops.set(ops.ref(fn,'prototype'),null);
    context.top = effects.frame(closure); context.top.meta = frame.meta;
    effects.ret(result);
    assert.strictEqual(prototypeOf(result),Constructor.prototype);
    context.objects = parent;
    assert.strictEqual(prototypeOf(result),Object.prototype);
    assert.strictEqual(ops.get(ops.ref(fn,'prototype')),original);
  }
});

test('generator yield and return results are allocated in the current heap', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(); context.objects = parent;
  const closure: any[] = [];
  closure[effects.State.CLOSURE_FUNC] = function generator() {};
  closure[effects.State.CLOSURE_META] = {};
  const results: any[] = [];
  for (const done of [false,true]) {
    const frame = effects.frame(closure); context.top = frame;
    results.push(done ? effects.retG(3) : effects.yld(2));
    const asyncFrame = effects.frameAG(closure); context.top = asyncFrame;
    asyncFrame.onReturn = (result: any) => results.push(result);
    if (done) effects.retAG(3); else effects.yldAG(2);
  }
  assert.deepEqual(results.map(value => JSON.parse(ops.invoke(JSON.stringify,JSON,[value]))),
    [{value:2,done:false},{value:2,done:false},{value:3,done:true},{value:3,done:true}]);
  context.objects = parent.fork();
  for (const value of results) {assert.equal(parent.has(value),true); ops.set(ops.ref(value,'value'),9);}
  context.objects = parent;
  assert.deepEqual(results.map(value=>ops.get(ops.ref(value,'value'))),[2,2,3,3]);
});

test('intrinsic own properties isolate alongside slots and survive copy and persistence', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining:100000};
  const parent = new CowHeap(), slots = new CowStore<any>(); context.objects=parent; context.intrinsicSlots=slots;
  const iterator = ops.invoke(Array.prototype.values,[1,2],[]), future = effects.Future.resolve(7);
  const roots = {iterator,future};
  for (const value of [iterator,future]) {assert.equal(parent.has(value),true);ops.set(ops.ref(value,'mark'),'parent');}
  const child = parent.fork(), childSlots=slots.fork(); context.objects=child; context.intrinsicSlots=childSlots;
  ops.set(ops.ref(iterator,'mark'),'child');
  ops.invoke(Reflect.deleteProperty,Reflect,[future,'mark']);
  ops.set(ops.ref(future,'alias'),iterator);
  ops.invoke(Object.freeze,Object,[future]);
  ops.invoke(iterator.next,iterator,[]);
  for (const restored of [effects.S.read(effects.S.write(roots)),effects.prepareCopy(roots,null,null)()]) {
    assert.equal(child.has(restored.iterator),true);assert.equal(child.has(restored.future),true);
    assert.equal(ops.get(ops.ref(restored.iterator,'mark')),'child');
    assert.equal(ops.get(ops.ref(restored.future,'mark')),undefined);
    assert.strictEqual(ops.get(ops.ref(restored.future,'alias')),restored.iterator);
    assert.equal(ops.invoke(Object.isFrozen,Object,[restored.future]),true);
    assert.equal(effects.stateOf(restored.future).value,7);
    const next=ops.invoke(restored.iterator.next,restored.iterator,[]);
    assert.equal(ops.get(ops.ref(next,'value')),2);
  }
  context.objects=parent;context.intrinsicSlots=slots;
  assert.equal(ops.get(ops.ref(iterator,'mark')),'parent');
  assert.equal(ops.get(ops.ref(future,'mark')),'parent');
  assert.equal(ops.invoke(Object.isFrozen,Object,[future]),false);
  assert.equal(ops.get(ops.ref(ops.invoke(iterator.next,iterator,[]),'value')),1);
});

test('Promise catch, finally and constructor checks read branch properties', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:100000};
  const parent=new CowHeap();context.objects=parent;
  const future=effects.Future.resolve(3);
  context.objects=parent.fork();
  ops.set(ops.ref(future,'then'),function(){return 'child';});
  assert.equal(ops.invoke(effects.Future.prototype.catch,future,[()=>{}]),'child');
  assert.equal(ops.invoke(effects.Future.prototype.finally,future,[null]),'child');
  ops.set(ops.ref(future,'constructor'),Array);
  assert.throws(()=>effects.Future.resolve(future),/species/);
  context.objects=parent;
  assert.strictEqual(effects.Future.resolve(future),future);
  assert.strictEqual(ops.get(ops.ref(future,'then')),effects.Future.prototype.then);
});

test('for-in snapshots logical keys and forks cursor progress with branch-local deletion', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:100000};
  const parent=new CowHeap(),slots=new CowStore<any>();context.objects=parent;context.intrinsicSlots=slots;
  const proto=ops.allocation({base:3,shadow:4}),object=parent.create(proto);
  ops.set(ops.ref(object,'own'),1);ops.set(ops.ref(object,'gone'),2);
  ops.invoke(Object.defineProperty,Object,[object,'shadow',{value:5,enumerable:false}]);
  assert.deepEqual(ops.forInKeys(object),['own','gone','base']);
  const record=effects.forInIterator(object);
  assert.equal(ops.get(ops.ref(effects.iterNext(record),'value')),'own');
  const child=parent.fork(),childSlots=slots.fork();context.objects=child;context.intrinsicSlots=childSlots;
  ops.invoke(Reflect.deleteProperty,Reflect,[object,'gone']);
  for(const restored of [effects.S.read(effects.S.write(record)),effects.prepareCopy(record,null,null)()]){
    assert.equal(ops.get(ops.ref(effects.iterNext(restored),'value')),'base');
    assert.equal(ops.get(ops.ref(effects.iterNext(restored),'done')),true);
  }
  assert.equal(ops.get(ops.ref(effects.iterNext(record),'value')),'base');
  context.objects=parent;context.intrinsicSlots=slots;
  assert.equal(ops.get(ops.ref(effects.iterNext(record),'value')),'gone');
  assert.equal(ops.get(ops.ref(effects.iterNext(record),'value')),'base');
  assert.equal(ops.get(ops.ref(effects.iterNext(record),'done')),true);
  assert.deepEqual(ops.forInKeys(null),[]);
  assert.deepEqual(ops.forInKeys('ab'),['0','1']);
});

test('collection properties and slots restore together, including keys reachable only through properties', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const {CowWeakCollections} = await import('../src/cow-weak.ts');
  for (const weak of [false,true]) for (const map of [false,true]) {
    const effects=require('../dist/effects.cjs')(),context=effects.State.context;
    const ops=effects.installOperations(createOperations);context.active={remaining:100000};
    const heap=new CowHeap(),collections=new effects.CowCollections(),weakMemory=new CowWeakCollections();
    context.objects=heap;context.collectionMemory=collections;context.weakMemory=weakMemory;
    const Constructor=weak?(map?effects.WeakMap:effects.WeakSet):(map?Map:Set),proto=Constructor.prototype;
    const table=ops.construct(Constructor,[]),key=ops.allocation({});
    assert.equal(heap.has(table),true);
    ops.set(ops.ref(table,'key'),key);ops.set(ops.ref(table,'tag'),'parent');
    ops.invoke(proto[map?'set':'add'],table,map?[key,7]:[key]);
    const child=heap.fork();context.objects=child;context.collectionMemory=collections.fork();context.weakMemory=weakMemory.fork();
    ops.set(ops.ref(table,'tag'),'child');
    if(map)ops.invoke(proto.set,table,[key,table]);
    else {ops.invoke(proto.delete,table,[key]);ops.invoke(proto.add,table,[table]);}
    ops.invoke(Object.setPrototypeOf,Object,[table,null]);ops.invoke(Object.freeze,Object,[table]);
    for(const result of [effects.S.read(effects.S.write(table)),effects.prepareCopy(table,null,null)()]){
      assert.equal(child.has(result),true);
      const restoredKey=ops.get(ops.ref(result,'key'));
      assert.notStrictEqual(restoredKey,key);
      assert.equal(ops.get(ops.ref(result,'tag')),'child');
      assert.equal(ops.invoke(Object.getPrototypeOf,Object,[result]),null);
      assert.equal(ops.invoke(Object.isFrozen,Object,[result]),true);
      if(map)assert.strictEqual(ops.invoke(proto.get,result,[restoredKey]),result);
      else {assert.equal(ops.invoke(proto.has,result,[restoredKey]),false);assert.equal(ops.invoke(proto.has,result,[result]),true);}
    }
    context.objects=heap;context.collectionMemory=collections;context.weakMemory=weakMemory;
    assert.equal(ops.get(ops.ref(table,'tag')),'parent');
    assert.strictEqual(ops.invoke(Object.getPrototypeOf,Object,[table]),proto);
    assert.equal(ops.invoke(Object.isFrozen,Object,[table]),false);
    assert.equal(ops.invoke(proto[map?'get':'has'],table,[key]),map?7:true);
  }
});

test('RegExp execution and protocols use branch lastIndex and preserve native callback ordering', async () => {
  const {CowHeap}=await import('../src/cow-heap.ts');
  const effects=require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:100000};
  const parent=new CowHeap();context.objects=parent;
  const regex=ops.construct(RegExp,['(?<letter>a)','dg']);
  ops.set(ops.ref(regex,'lastIndex'),1);
  const child=parent.fork();context.objects=child;
  const match=ops.invoke(RegExp.prototype.exec,regex,['baab']);
  assert.equal(ops.get(ops.ref(regex,'lastIndex')),2);
  assert.equal(ops.get(ops.ref(match,'index')),1);
  const groups=ops.get(ops.ref(match,'groups')),indices=ops.get(ops.ref(match,'indices'));
  for(const value of [match,groups,indices,ops.get(ops.ref(indices,'0')),ops.get(ops.ref(indices,'groups'))])assert.equal(child.has(value),true);
  const replace=ops.invoke(RegExp.prototype[Symbol.replace],regex,['aa',()=>{ops.set(ops.ref(regex,'lastIndex'),9);return 'x';}]);
  assert.equal(replace,'xx');assert.equal(ops.get(ops.ref(regex,'lastIndex')),9);
  assert.equal(ops.invoke(RegExp.prototype[Symbol.search],regex,['ba']),1);
  assert.equal(ops.get(ops.ref(regex,'lastIndex')),9);
  ops.invoke(Object.defineProperty,Object,[regex,'source',{value:'z',configurable:true}]);
  assert.equal(ops.invoke(JSON.stringify,JSON,[ops.invoke(RegExp.prototype[Symbol.split],regex,['baab'])]),'["b","a","","a","b"]');
  assert.strictEqual(ops.invoke(RegExp,undefined,[regex]),regex);
  const copy=ops.construct(RegExp,[regex]);
  assert.equal(ops.invoke(Object.getOwnPropertyDescriptor(RegExp.prototype,'source')!.get!,copy,[]),'(?<letter>a)');
  for(const restored of [effects.S.read(effects.S.write(regex)),effects.prepareCopy(regex,null,null)()]){
    assert.equal(ops.get(ops.ref(restored,'lastIndex')),9);
    assert.equal(ops.get(ops.ref(restored,'source')),'z');
    ops.set(ops.ref(restored,'lastIndex'),0);
    assert.equal(ops.invoke(RegExp.prototype.test,restored,['a']),true);
  }
  ops.invoke(Object.defineProperty,Object,[regex,'lastIndex',{writable:false}]);
  assert.throws(()=>ops.invoke(RegExp.prototype.exec,regex,['a']),TypeError);
  context.objects=parent;
  assert.equal(ops.get(ops.ref(regex,'lastIndex')),1);
  assert.equal(ops.invoke(RegExp.prototype.test,regex,['ba']),true);
  assert.equal(ops.get(ops.ref(regex,'lastIndex')),2);
});

test('COW RegExp protocols match V8 across empty matches, unicode, sticky flags and index bounds', async () => {
  const {CowHeap}=await import('../src/cow-heap.ts');
  const effects=require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:1000000};
  context.objects=new CowHeap();
  for(const pattern of ['a','(?:)','(?<part>a)?'])for(const flags of ['','g','y','gy','gu'])for(const index of [-2,1,99]){
    for(const [method,args] of [[RegExp.prototype.exec,['a😀a']], [RegExp.prototype[Symbol.match],['a😀a']],
      [RegExp.prototype[Symbol.search],['a😀a']], [RegExp.prototype[Symbol.replace],['a😀a','<$&>']],
      [RegExp.prototype[Symbol.split],['a😀a',4]]] as const){
      const native=new RegExp(pattern,flags),managed=ops.construct(RegExp,[pattern,flags]);
      native.lastIndex=index;ops.set(ops.ref(managed,'lastIndex'),index);
      const expected=Reflect.apply(method,native,args),actual=ops.invoke(method,managed,[...args]);
      assert.equal(ops.invoke(JSON.stringify,JSON,[actual]),JSON.stringify(expected),`${pattern}/${flags} at ${index}: ${method.name}`);
      assert.equal(ops.get(ops.ref(managed,'lastIndex')),native.lastIndex);
    }
  }
});

test('RegExp protocol admission observes child overrides instead of the native baseline', async () => {
  const {CowHeap}=await import('../src/cow-heap.ts');
  const effects=require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:100000};
  const parent=new CowHeap();context.objects=parent;
  const regex=ops.construct(RegExp,['a','g']);
  context.objects=parent.fork();ops.set(ops.ref(regex,'exec'),()=>null);
  assert.throws(()=>ops.invoke(RegExp.prototype[Symbol.match],regex,['a']),/custom exec/);
  context.objects=parent;
  assert.equal(ops.invoke(JSON.stringify,JSON,[ops.invoke(RegExp.prototype[Symbol.match],regex,['aa'])]),'["a","a"]');
});

test('Error stack slots remain writable when frozen and isolate with ordinary properties across restoration', async () => {
  const {CowHeap}=await import('../src/cow-heap.ts');
  const effects=require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:100000};
  const parent=new CowHeap(),slots=new CowStore<any>();context.objects=parent;context.intrinsicSlots=slots;
  const error=ops.construct(Error,['parent']),deleted=ops.construct(TypeError,['deleted']);
  const descriptor=ops.invoke(Object.getOwnPropertyDescriptor,Object,[error,'stack']);
  const getter=ops.get(ops.ref(descriptor,'get')),setter=ops.get(ops.ref(descriptor,'set'));
  assert.throws(()=>ops.get(ops.ref(error,'stack')),/Unsupported default Error.stack/);
  ops.set(ops.ref(error,'stack'),'parent stack');
  ops.set(ops.ref(deleted,'stack'),'retained internal value');
  const child=parent.fork(),childSlots=slots.fork();context.objects=child;context.intrinsicSlots=childSlots;
  ops.set(ops.ref(error,'message'),'child');ops.invoke(Object.freeze,Object,[error]);
  ops.set(ops.ref(error,'stack'),error);
  assert.strictEqual(ops.get(ops.ref(error,'stack')),error);
  ops.invoke(Reflect.deleteProperty,Reflect,[deleted,'stack']);
  ops.invoke(Reflect.deleteProperty,Reflect,[deleted,'message']);
  ops.set(ops.ref(deleted,'tail'),1);ops.set(ops.ref(deleted,'message'),'reinserted');
  const roots={error,deleted};
  for(const restored of [effects.S.read(effects.S.write(roots)),effects.prepareCopy(roots,null,null)()]){
    assert.equal(child.has(restored.error),true);
    assert.equal(ops.invoke(Object.isFrozen,Object,[restored.error]),true);
    assert.strictEqual(ops.get(ops.ref(restored.error,'stack')),restored.error);
    assert.equal(ops.get(ops.ref(restored.error,'message')),'child');
    ops.set(ops.ref(restored.error,'stack'),'restored');
    assert.equal(ops.get(ops.ref(restored.error,'stack')),'restored');
    assert.deepEqual(ops.invoke(Reflect.ownKeys,Reflect,[restored.deleted]),['tail','message']);
    assert.equal(ops.invoke(getter,restored.deleted,[]),'retained internal value');
  }
  context.objects=parent;context.intrinsicSlots=slots;
  assert.equal(ops.get(ops.ref(error,'stack')),'parent stack');
  assert.equal(ops.get(ops.ref(error,'message')),'parent');
  assert.equal(ops.invoke(Object.isFrozen,Object,[error]),false);
  const plain=ops.allocation({});ops.invoke(setter,plain,[7]);
  assert.equal(ops.invoke(getter,plain,[]),undefined);
});

test('boxed primitive slots retain their brands while branch properties restore independently', async () => {
  const {CowHeap}=await import('../src/cow-heap.ts');
  const effects=require('../dist/effects.cjs')(),context=effects.State.context;
  const ops=effects.installOperations(createOperations);context.active={remaining:100000};
  const parent=new CowHeap();context.objects=parent;
  const symbol=Symbol('boxed');
  const values=[12,'ab',false,34n,symbol];
  const readers=[Number.prototype.valueOf,String.prototype.valueOf,Boolean.prototype.valueOf,BigInt.prototype.valueOf,Symbol.prototype.valueOf];
  const boxes=values.map(value=>ops.invoke(Object,undefined,[value]));
  for(const box of boxes){assert.equal(parent.has(box),true);ops.set(ops.ref(box,'tag'),'parent');}
  const child=parent.fork();context.objects=child;
  for(const box of boxes){ops.set(ops.ref(box,'tag'),'child');ops.invoke(Object.setPrototypeOf,Object,[box,null]);ops.invoke(Object.freeze,Object,[box]);}
  for(const result of [effects.S.read(effects.S.write({boxes,symbol})),effects.prepareCopy({boxes,symbol},null,null)()]){
    for(let i=0;i<boxes.length;i++){
      const box=result.boxes[i];assert.equal(child.has(box),true);
      assert.equal(ops.invoke(readers[i],box,[]),i===4?result.symbol:values[i]);
      assert.equal(ops.get(ops.ref(box,'tag')),'child');
      assert.equal(ops.invoke(Object.getPrototypeOf,Object,[box]),null);
      assert.equal(ops.invoke(Object.isFrozen,Object,[box]),true);
    }
    assert.equal(ops.get(ops.ref(result.boxes[1],'1')),'b');
    assert.equal(ops.get(ops.ref(result.boxes[1],'length')),2);
  }
  context.objects=parent;
  for(const box of boxes){assert.equal(ops.get(ops.ref(box,'tag')),'parent');assert.equal(ops.invoke(Object.isFrozen,Object,[box]),false);}
});

test('native exceptions are registered before catch handlers and Promise rejection retain them', async () => {
  const {CowHeap}=await import('../src/cow-heap.ts');
  for(const mode of ['resume','loop']){
    const effects=require('../dist/effects.cjs')(),context=effects.State.context;
    const ops=effects.installOperations(createOperations);context.active={remaining:100000};
    const heap=new CowHeap(),slots=new CowStore<any>();context.objects=heap;context.intrinsicSlots=slots;
    const error=new TypeError('native failure');let caught=false;
    const closure:any[]=[];closure[effects.State.CLOSURE_FUNC]=function run(){};
    closure[effects.State.CLOSURE_META]={blackbox:true,
      handler(frame:any){if(!caught)throw error;context.top=null;return frame.error;},
      errHandler(frame:any){assert.strictEqual(frame.error,error);assert.equal(heap.has(error),true);caught=true;}
    };
    const frame=effects.frame(closure);
    let result;
    if(mode==='resume')result=effects.resume(frame,null);
    else {context.top=frame;result=effects.loop(null);}
    assert.strictEqual(result,error);assert.equal(caught,true);
    const rejected=new RangeError('rejected'),future=effects.Future.reject(rejected);
    assert.equal(heap.has(rejected),true);assert.strictEqual(effects.stateOf(future).value,rejected);
    context.objects=heap.fork();context.intrinsicSlots=slots.fork();
    ops.set(ops.ref(error,'stack'),'child stack');ops.set(ops.ref(rejected,'message'),'child message');
    context.objects=heap;context.intrinsicSlots=slots;
    assert.throws(()=>ops.get(ops.ref(error,'stack')),/Unsupported default Error.stack/);
    assert.equal(ops.get(ops.ref(rejected,'message')),'rejected');
    const terminal=new Error('budget');context.__budgetExceeded=true;
    assert.throws(()=>effects.handle(frame,terminal),value=>value===terminal);
    assert.equal(heap.has(terminal),false);
    context.__budgetExceeded=false;context.running=true;
    assert.throws(()=>effects.handle(frame,effects.token),value=>value===effects.token);
  }
});

test('runtime iterator cursors advance independently through shared intrinsic slot roots', () => {
  const effects = require('../dist/effects.cjs')();
  const context = effects.State.context;
  const operations = effects.installOperations(createOperations);
  const parent = new CowStore<any>();
  context.intrinsicSlots = parent;
  for (const source of [[10, 20, 30], 'A😀B', new Uint8Array([10, 20, 30])]) {
    context.intrinsicSlots = parent;
    const iterator = operations.invoke(source[Symbol.iterator], source, []);
    const next = iterator.next;
    const child = parent.fork(), sibling = parent.fork();
    assert.strictEqual((child as any).root, (parent as any).root);
    const expected = [...source];
    context.intrinsicSlots = child;
    assert.deepEqual(operations.invoke(next, iterator, []), {value: expected[0], done: false});
    assert.deepEqual(operations.invoke(next, iterator, []), {value: expected[1], done: false});
    context.intrinsicSlots = parent;
    assert.deepEqual(operations.invoke(next, iterator, []), {value: expected[0], done: false});
    context.intrinsicSlots = sibling;
    for (const value of expected) assert.deepEqual(operations.invoke(next, iterator, []), {value, done: false});
    assert.deepEqual(operations.invoke(next, iterator, []), {value: undefined, done: true});
    context.intrinsicSlots = child;
    assert.deepEqual(operations.invoke(next, iterator, []), {value: expected[2], done: false});
  }
});

test('intrinsic codec resolves active state and child-only identities do not leak into parent', () => {
  const descriptors = new Map<string, any>();
  const registry = {regOpaqueObject() {}, setObjectDescriptor() {}, regDescriptor(value: any) {descriptors.set(value.name, value); return value;}};
  const parent = new CowStore<any>(), State = {context: {intrinsicSlots: parent}};
  const slots = require('../src/intrinsic-state.cjs')(registry, State);
  class Cursor {}
  slots.register(Cursor, 'Cursor');
  const identity = slots.initialize(new Cursor(), 'Cursor', {index: 0, source: {}});
  const original = slots.state(identity), child = parent.fork();
  State.context.intrinsicSlots = child;
  slots.edit(identity).index = 7;
  assert.strictEqual(slots.state(identity).source, original.source);
  const childOnly = slots.initialize(new Cursor(), 'Cursor', {index: 9});
  const codec = descriptors.get('runtime.Cursor');
  assert.equal(codec.write({step: (value: any) => value}, identity).state.index, 7);
  State.context.intrinsicSlots = parent;
  assert.equal(codec.write({step: (value: any) => value}, identity).state.index, 0);
  assert.equal(slots.has(childOnly), false);
  assert.throws(() => slots.state(childOnly), /Incompatible/);
  slots.install(identity, {index: 2});
  State.context.intrinsicSlots = child;
  assert.equal(slots.state(identity).index, 7);
});

test('Future listeners and resolving locks isolate settlements across shared slot roots', () => {
  const effects = require('../dist/effects.cjs')();
  const context = effects.State.context;
  effects.installOperations(createOperations);
  const parent = new CowStore<any>(); context.intrinsicSlots = parent; context.jobs = []; context.active = {remaining: 100000};
  let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
  let trace: unknown[] = [];
  const future = new effects.Future((yes: any, no: any) => {resolve = yes; reject = no;});
  const first = future.then((value: unknown) => {trace.push(['first', value]); return value;});
  const sharedListeners = effects.stateOf(future).listeners;
  const child = parent.fork(), sibling = parent.fork();
  context.intrinsicSlots = child;
  const second = future.then((value: unknown) => {trace.push(['second', value]); return value;});
  assert.strictEqual(effects.stateOf(future).listeners.previous, sharedListeners);
  resolve(10); reject(99); effects.drain();
  assert.deepEqual(trace, [['first', 10], ['second', 10]]);
  assert.equal(effects.stateOf(first).value, 10);
  assert.equal(effects.stateOf(second).value, 10);
  context.intrinsicSlots = parent; context.jobs = []; context.active = {remaining: 100000}; trace = [];
  assert.equal(effects.stateOf(future).status, 0);
  assert.strictEqual(effects.stateOf(future).listeners, sharedListeners);
  resolve(20); effects.drain();
  assert.deepEqual(trace, [['first', 20]]);
  assert.equal(effects.stateOf(first).value, 20);
  context.intrinsicSlots = sibling; context.jobs = []; trace = [];
  reject('failure'); resolve(30); effects.drain();
  assert.deepEqual(trace, []);
  assert.equal(effects.stateOf(first).status, 2);
  assert.equal(effects.stateOf(first).value, 'failure');
  context.intrinsicSlots = child;
  assert.equal(effects.stateOf(first).value, 10);
});

test('queued Future reactions fork with queue roots and drain independently in FIFO order', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  effects.installOperations(createOperations);
  context.active = {remaining: 100000};
  const slots = new CowStore<any>(), jobs = new effects.CowQueue();
  context.intrinsicSlots = slots; context.jobs = jobs;
  let trace: unknown[] = [], resolve!: (value: unknown) => void;
  const future = new effects.Future((yes: any) => {resolve = yes;});
  const first = future.then((value: any) => {trace.push(['first', value]); return value + 1;});
  first.then((value: any) => {trace.push(['nested', value]);});
  future.then((value: any) => {trace.push(['second', value]);});
  resolve(10);
  assert.equal(jobs.length, 2);
  const childSlots = slots.fork(), childJobs = jobs.fork();
  context.intrinsicSlots = childSlots; context.jobs = childJobs;
  effects.drain();
  assert.deepEqual(trace, [['first', 10], ['second', 10], ['nested', 11]]);
  assert.equal(childJobs.length, 0); assert.equal(jobs.length, 2);
  context.intrinsicSlots = slots; context.jobs = jobs; trace = [];
  assert.equal(effects.stateOf(first).status, 0);
  effects.drain();
  assert.deepEqual(trace, [['first', 10], ['second', 10], ['nested', 11]]);
});

test('runtime queue codec restores FIFO and payload aliases', () => {
  const effects = require('../dist/effects.cjs')();
  const queue = new effects.CowQueue(), shared = {value: 7};
  queue.push({shared}); queue.push({shared});
  const restored = effects.S.read(effects.S.write({queue, shared}));
  const copied = effects.prepareCopy({queue, shared}, null, null)();
  for (const result of [restored, copied]) {
    assert.ok(result.queue instanceof effects.CowQueue);
    assert.strictEqual(result.queue.shift().shared, result.shared);
    assert.strictEqual(result.queue.shift().shared, result.shared);
    assert.equal(result.queue.length, 0);
    assert.notStrictEqual(result.shared, shared);
  }
  assert.equal(queue.length, 2);
});

test('pending Promise combinators keep per-slot results and completion counts branch-local', () => {
  for (const kind of ['all', 'allSettled', 'any', 'race']) {
    const effects = require('../dist/effects.cjs')(), context = effects.State.context;
    effects.installOperations(createOperations); context.active = {remaining: 100000};
    const parent = new CowStore<any>(), jobs = new effects.CowQueue();
    context.intrinsicSlots = parent; context.jobs = jobs;
    const first = effects.Future.withResolvers(), second = effects.Future.withResolvers();
    const combined = effects.Future[kind]([first.promise, second.promise]);
    if (kind === 'any') first.reject('first');
    else if (kind !== 'race') first.resolve(11);
    effects.drain();
    assert.equal(effects.stateOf(combined).status, 0);
    const child = parent.fork(), childJobs = jobs.fork();
    context.intrinsicSlots = child; context.jobs = childJobs;
    second.resolve(20); effects.drain();
    const expected = (value: number) => kind === 'all' ? [11, value] : kind === 'allSettled'
      ? [{status: 'fulfilled', value: 11}, {status: 'fulfilled', value}] : value;
    assert.deepEqual(effects.stateOf(combined).value, expected(20));
    context.intrinsicSlots = parent; context.jobs = jobs;
    assert.equal(effects.stateOf(combined).status, 0);
    second.resolve(30); effects.drain();
    assert.deepEqual(effects.stateOf(combined).value, expected(30));
    context.intrinsicSlots = child;
    assert.deepEqual(effects.stateOf(combined).value, expected(20));
  }
});

test('Promise.any rejection arrays preserve input order across independently settled branches', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  effects.installOperations(createOperations); context.active = {remaining: 100000};
  const parent = new CowStore<any>(), jobs = new effects.CowQueue();
  context.intrinsicSlots = parent; context.jobs = jobs;
  const first = effects.Future.withResolvers(), second = effects.Future.withResolvers();
  const combined = effects.Future.any([first.promise, second.promise]);
  second.reject('second'); effects.drain();
  const child = parent.fork(); context.intrinsicSlots = child; context.jobs = jobs.fork();
  first.reject('child'); effects.drain();
  assert.equal(effects.stateOf(combined).status, 2);
  assert.deepEqual(effects.stateOf(combined).value.errors, ['child', 'second']);
  context.intrinsicSlots = parent; context.jobs = jobs;
  first.reject('parent'); effects.drain();
  assert.deepEqual(effects.stateOf(combined).value.errors, ['parent', 'second']);
});

test('continuation control fields preserve frame identity and isolate branch writes', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const parent = new CowStore<any>(); context.intrinsicSlots = parent;
  const locals = [{value: 1}], metadata = {name: 'handler'};
  const closure: any[] = [];
  closure[effects.State.CLOSURE_VARS] = locals;
  closure[effects.State.CLOSURE_META] = metadata;
  const frame = effects.frame(closure);
  assert.ok(effects.State.context.generatorState.has(frame));
  const generator = effects.State.context.generatorState;
  const iterator = {};
  generator.initialize(iterator, 'Generator', frame);
  const child = parent.fork(); context.intrinsicSlots = child;
  assert.strictEqual(generator.state(iterator), frame);
  frame.state = 5; frame.flags |= 1; frame.sent = 42; frame.next = frame;
  assert.strictEqual(frame.$, locals); assert.strictEqual(frame.meta, metadata);
  assert.strictEqual(frame.next, frame);
  context.intrinsicSlots = parent;
  assert.strictEqual(generator.state(iterator), frame);
  assert.equal(frame.state, 0); assert.equal(frame.flags, 0); assert.equal(frame.sent, undefined);
  assert.equal(frame.next, null);
  frame.goto = 8;
  context.intrinsicSlots = child;
  assert.equal(frame.goto, 0); assert.equal(frame.state, 5);
});

test('lexical cells retain shared closure aliases and isolate writes through fork, copy and codec', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const parent = new CowStore<any>(); context.intrinsicSlots = parent;
  const environment = effects.scope([null, 7]);
  const first = effects.capture(null, environment, [[1]], 0).vars, second = effects.capture(null, environment, [[1]], 0).vars;
  assert.strictEqual(first[1], second[1]);
  const cell = first[1], child = parent.fork();
  context.intrinsicSlots = child;
  cell.value = 20;
  assert.equal(second[1].value, 20);
  const restored = effects.S.read(effects.S.write({first, second}));
  const copied = effects.prepareCopy({first, second}, null, null)();
  for (const result of [restored, copied]) {
    assert.strictEqual(result.first[1], result.second[1]);
    assert.notStrictEqual(result.first[1], cell);
    assert.equal(result.first[1].value, 20);
    result.first[1].value = 99;
    assert.equal(result.second[1].value, 99);
    assert.equal(cell.value, 20);
  }
  context.intrinsicSlots = parent;
  assert.equal(cell.value, 7);
  cell.value = 8;
  context.intrinsicSlots = child;
  assert.equal(cell.value, 20);
});

test('capture projection caches never return cells allocated only in another branch', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const parent = new CowStore<any>(); context.intrinsicSlots = parent;
  const environment = effects.scope([null, 3]);
  const child = parent.fork(); context.intrinsicSlots = child;
  const childProjection = effects.capture(null, environment, [[1], [2]], 0).vars;
  childProjection[2].value = 'child';
  const sharedCell = childProjection[1], childCell = childProjection[2];
  assert.strictEqual(effects.capture(null, environment, [[1], [2]], 0).vars, childProjection);
  context.intrinsicSlots = parent;
  const parentProjection = effects.capture(null, environment, [[1], [2]], 0).vars;
  assert.notStrictEqual(parentProjection, childProjection);
  assert.strictEqual(parentProjection[1], sharedCell);
  assert.notStrictEqual(parentProjection[2], childCell);
  assert.equal(parentProjection[2].value, undefined);
  parentProjection[2].value = 'parent';
  context.intrinsicSlots = child;
  assert.equal(childProjection[2].value, 'child');
});

test('async generator request queues fork with their frame and settle branch-local promises', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  effects.installOperations(createOperations); context.active = {remaining: 100000};
  const parent = new CowStore<any>(), jobs = new effects.CowQueue();
  context.intrinsicSlots = parent; context.jobs = jobs;
  const closure: any[] = [];
  closure[effects.State.CLOSURE_FUNC] = function generator() {};
  closure[effects.State.CLOSURE_META] = {};
  const frame = effects.frameAG(closure);
  frame.flags |= effects.State.FrameFlags.Running;
  const step = (current: any, value: any) => {
    current.onReturn({value, done: false});
    current.flags &= ~effects.State.FrameFlags.Running;
  };
  const first = effects.enqueue(frame, step, 1);
  const originalQueue = frame.queue;
  const child = parent.fork(); context.intrinsicSlots = child; context.jobs = jobs.fork();
  // A control write may precede queue access; it must fork the queue too.
  frame.sent = 'child';
  frame.flags &= ~effects.State.FrameFlags.Running;
  const childRequest = effects.enqueue(frame, step, 2);
  assert.equal(frame.queue.length, 0);
  assert.notStrictEqual(frame.queue, originalQueue);
  assert.deepEqual(effects.stateOf(first).value, {value: 1, done: false});
  assert.deepEqual(effects.stateOf(childRequest).value, {value: 2, done: false});
  context.intrinsicSlots = parent; context.jobs = jobs;
  assert.equal(frame.queue.length, 1);
  assert.equal(effects.stateOf(first).status, 0);
  frame.flags &= ~effects.State.FrameFlags.Running;
  const parentRequest = effects.enqueue(frame, step, 3);
  assert.deepEqual(effects.stateOf(parentRequest).value, {value: 3, done: false});
  context.intrinsicSlots = child;
  assert.deepEqual(effects.stateOf(childRequest).value, {value: 2, done: false});
});

test('lexical environment slots isolate liveness clearing and parent links without copying every slot', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const parent = new CowStore<any>(); context.intrinsicSlots = parent;
  const outer = effects.scope([null, 'outer']);
  const environment = effects.scope([outer, ...Array.from({length: 10000}, (_, i) => i)]);
  const held = environment[5000];
  const parentSlots = context.generatorState.state(environment).slots;
  const child = parent.fork(); context.intrinsicSlots = child;
  environment[5000] = undefined; environment[0] = null;
  const childSlots = context.generatorState.state(environment).slots;
  assert.notStrictEqual(parentSlots, childSlots);
  assert.strictEqual(childSlots.root.slots[1], parentSlots.root.slots[1]);
  assert.equal(environment[5000], undefined); assert.equal(environment[0], null);
  assert.equal(held.value, 4999);
  context.intrinsicSlots = parent;
  assert.strictEqual(environment[5000], held); assert.strictEqual(environment[0], outer);
  environment[2] = undefined;
  context.intrinsicSlots = child;
  assert.equal(environment[2].value, 1);
  const restored = effects.S.read(effects.S.write({environment})).environment;
  assert.equal(restored.length, 10001); assert.equal(restored[5000], undefined);
  assert.equal(restored[2].value, 1);
});

test('Map and Set methods and live cursors use branch collection roots', () => {
  for (const Constructor of [Map, Set]) {
    const effects = require('../dist/effects.cjs')(), context = effects.State.context;
    const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
    const slots = new CowStore<any>(), collections = new effects.CowCollections();
    context.intrinsicSlots = slots; context.collectionMemory = collections;
    const isMap = Constructor === Map, prototype: any = Constructor.prototype;
    const table = ops.construct(Constructor, [isMap ? [['a', 1], ['b', 2], ['c', 3]] : ['a', 'b', 'c']]);
    assert.equal(ops.get(ops.ref(table, 'size')), 3);
    assert.equal(ops.invoke(Reflect.get, Reflect, [prototype, 'size', table]), 3);
    assert.equal(Object.getOwnPropertyDescriptor(prototype, 'size')!.get!.call(table), 0);
    const iterator = ops.invoke(prototype.entries, table, []);
    assert.deepEqual(ops.invoke(iterator.next, iterator, []), {done: false, value: ['a', isMap ? 1 : 'a']});
    const childSlots = slots.fork(), childCollections = collections.fork();
    context.intrinsicSlots = childSlots; context.collectionMemory = childCollections;
    ops.invoke(prototype.delete, table, ['b']);
    ops.invoke(prototype[isMap ? 'set' : 'add'], table, ['b', 20]);
    assert.deepEqual(ops.invoke(iterator.next, iterator, []), {done: false, value: ['c', isMap ? 3 : 'c']});
    assert.deepEqual(ops.invoke(iterator.next, iterator, []), {done: false, value: ['b', isMap ? 20 : 'b']});
    context.intrinsicSlots = slots; context.collectionMemory = collections;
    assert.deepEqual(ops.invoke(iterator.next, iterator, []), {done: false, value: ['b', isMap ? 2 : 'b']});
    assert.equal(ops.invoke(prototype.has, table, ['b']), true);
    if (isMap) assert.equal(ops.invoke(prototype.get, table, ['b']), 2);
    context.intrinsicSlots = childSlots; context.collectionMemory = childCollections;
    ops.invoke(prototype.clear, table, []);
    ops.invoke(prototype[isMap ? 'set' : 'add'], table, ['d', 4]);
    assert.deepEqual(ops.invoke(iterator.next, iterator, []), {done: false, value: ['d', isMap ? 4 : 'd']});
    assert.equal(ops.get(ops.ref(table, 'size')), 1);
    assert.equal(ops.invoke(iterator.next, iterator, []).done, true);
    ops.invoke(prototype[isMap ? 'set' : 'add'], table, ['e', 5]);
    assert.equal(ops.invoke(iterator.next, iterator, []).done, true);
  }
});

test('collection forEach observes callback mutations in native order', () => {
  for (const Constructor of [Map, Set]) {
    function run(guarded: boolean) {
      const effects = require('../dist/effects.cjs')(), context = effects.State.context;
      const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
      context.intrinsicSlots = new CowStore(); context.collectionMemory = new effects.CowCollections();
      const map = Constructor === Map, proto: any = Constructor.prototype;
      const input: any = map ? [['a', 1], ['b', 2], ['c', 3]] : ['a', 'b', 'c'];
      const table: any = guarded ? ops.construct(Constructor, [input]) : new (Constructor as any)(input);
      const trace: unknown[] = [], receiver = {};
      const call = (name: string, args: any[]) => guarded ? ops.invoke(proto[name], table, args) : Reflect.apply(proto[name], table, args);
      const callback = function(this: unknown, value: unknown, key: unknown, current: unknown) {
        assert.strictEqual(this, receiver); assert.strictEqual(current, table); trace.push([key, value]);
        if (key === 'a') {call('delete', ['b']); call(map ? 'set' : 'add', ['d', 4]);}
        if (key === 'c') {call('clear', []); call(map ? 'set' : 'add', ['e', 5]);}
      };
      call('forEach', [callback, receiver]);
      return trace;
    }
    assert.deepEqual(run(true), run(false));
  }
});

test('collection snapshots and copies retain branch data, cycles and cursor gaps', () => {
  for (const Constructor of [Map, Set]) {
    const effects = require('../dist/effects.cjs')(), context = effects.State.context;
    const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
    const slots = new CowStore<any>(), collections = new effects.CowCollections();
    context.intrinsicSlots = slots; context.collectionMemory = collections;
    const map = Constructor === Map, proto: any = Constructor.prototype;
    const table = ops.construct(Constructor, []), key = {name: 'key'};
    const put = (key: any, value: any) => ops.invoke(proto[map ? 'set' : 'add'], table, [key, value]);
    put('removed', 1); put(key, table); put(table, key);
    const iterator = ops.invoke(proto.entries, table, []);
    ops.invoke(iterator.next, iterator, []);
    const child = slots.fork(), childCollections = collections.fork();
    context.intrinsicSlots = child; context.collectionMemory = childCollections;
    ops.invoke(proto.delete, table, ['removed']);
    put('removed', 9);
    const roots = {table, iterator, key};
    const restored = effects.S.read(effects.S.write(roots));
    const copied = effects.prepareCopy(roots, null, null)();
    for (const result of [restored, copied]) {
      assert.equal(ops.get(ops.ref(result.table, 'size')), 3);
      if (map) {
        assert.strictEqual(ops.invoke(proto.get, result.table, [result.key]), result.table);
        assert.strictEqual(ops.invoke(proto.get, result.table, [result.table]), result.key);
      }
      assert.deepEqual(ops.invoke(result.iterator.next, result.iterator, []), {done: false, value: [result.key, map ? result.table : result.key]});
      assert.deepEqual(ops.invoke(result.iterator.next, result.iterator, []), {done: false, value: [result.table, map ? result.key : result.table]});
      assert.deepEqual(ops.invoke(result.iterator.next, result.iterator, []), {done: false, value: ['removed', map ? 9 : 'removed']});
      assert.equal(ops.invoke(result.iterator.next, result.iterator, []).done, true);
    }
    context.intrinsicSlots = slots; context.collectionMemory = collections;
    assert.equal(ops.get(ops.ref(table, 'size')), 3);
    if (map) assert.equal(ops.invoke(proto.get, table, ['removed']), 1);
  }
});

test('empty constructors and Map.groupBy register collections before branches can share them', () => {
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
  const slots = new CowStore<any>(), memory = new effects.CowCollections();
  context.intrinsicSlots = slots; context.collectionMemory = memory;
  const empty = ops.construct(Map, []), key = {};
  const grouped = ops.invoke((Map as any).groupBy, Map, [[1, 2, 3], () => key]);
  assert.equal(Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!.call(grouped), 0);
  const child = memory.fork(); context.collectionMemory = child; context.intrinsicSlots = slots.fork();
  ops.invoke(Map.prototype.set, empty, ['child', 1]);
  assert.deepEqual(ops.invoke(Map.prototype.get, grouped, [key]), [1, 2, 3]);
  ops.invoke(Map.prototype.delete, grouped, [key]);
  context.collectionMemory = memory; context.intrinsicSlots = slots;
  assert.equal(ops.get(ops.ref(empty, 'size')), 0);
  assert.deepEqual(ops.invoke(Map.prototype.get, grouped, [key]), [1, 2, 3]);
});

test('buffer codecs and copy plans materialize branch pages and preserve overlapping view aliases', async () => {
  const {CowMemory} = await import('../src/cow-memory.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
  const parent = new CowMemory(); context.memory = parent;
  const buffer = ops.construct(ArrayBuffer, [8192]);
  const bytes = ops.construct(Uint8Array, [buffer]);
  const data = ops.construct(DataView, [buffer, 4093, 8]);
  ops.invoke(DataView.prototype.setUint32, data, [0, 0x01020304]);
  const child = parent.fork(); context.memory = child;
  ops.invoke(DataView.prototype.setUint32, data, [0, 0xaabbccdd]);
  const roots = {buffer, bytes, data};
  const restored = effects.S.read(effects.S.write(roots));
  const copied = effects.prepareCopy(roots, null, null)();
  for (const result of [restored, copied]) {
    assert.strictEqual(child.view(result.bytes).buffer, result.buffer);
    assert.strictEqual(child.view(result.data).buffer, result.buffer);
    assert.notStrictEqual(result.buffer, buffer);
    assert.equal(ops.invoke(DataView.prototype.getUint32, result.data, [0]), 0xaabbccdd, result === restored ? 'codec' : 'copy');
    ops.set(ops.ref(result.bytes, '4093'), 0x11);
    assert.equal(ops.invoke(DataView.prototype.getUint32, result.data, [0]), 0x11bbccdd);
    assert.equal(ops.invoke(DataView.prototype.getUint32, data, [0]), 0xaabbccdd);
  }
  context.memory = parent;
  assert.equal(ops.invoke(DataView.prototype.getUint32, data, [0]), 0x01020304);
});

test('ordinary COW objects and sparse arrays persist logical properties and cyclic aliases', async () => {
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
  const parent = new CowHeap(); context.objects = parent;
  const object = parent.create(), array = parent.createArray(5), symbol = Symbol('array');
  ops.set(ops.ref(object, symbol), array);
  ops.set(ops.ref(array, '3'), object);
  const child = parent.fork(); context.objects = child;
  ops.set(ops.ref(array, '1'), array);
  ops.invoke(Object.defineProperty, Object, [object, 'value', {value: 7}]);
  ops.invoke(Object.freeze, Object, [object]);
  ops.invoke(Object.defineProperty, Object, [array, 'length', {writable: false}]);
  const roots = {object, array, symbol};
  const snapshot = effects.S.write(roots), copy = effects.prepareCopy(roots, null, null);
  for (const result of [effects.S.read(snapshot), copy()]) {
    assert.equal(child.has(result.object), true);
    assert.equal(child.has(result.array), true);
    assert.equal(ops.get(ops.ref(result.array, 'length')), 5);
    assert.deepEqual(ops.invoke(Reflect.ownKeys, Reflect, [result.array]), ['1', '3', 'length']);
    assert.strictEqual(ops.get(ops.ref(result.array, '1')), result.array);
    assert.strictEqual(ops.get(ops.ref(result.array, '3')), result.object);
    assert.strictEqual(ops.get(ops.ref(result.object, result.symbol)), result.array);
    assert.equal(ops.get(ops.ref(result.object, 'value')), 7);
    assert.equal(ops.invoke(Object.isFrozen, Object, [result.object]), true);
    assert.equal(ops.invoke(Reflect.set, Reflect, [result.array, 'length', 2]), false);
  }
  context.objects = parent;
  assert.equal(ops.get(ops.ref(array, '1')), undefined);
  assert.equal(ops.get(ops.ref(object, 'value')), undefined);
  // The codec can also materialize native state without an active heap.
  context.objects = undefined;
  const plain = effects.S.read(snapshot);
  assert.equal(plain.array.length, 5);
  assert.strictEqual(plain.array[1], plain.array);
  assert.strictEqual(plain.array[3], plain.object);
  assert.equal(Object.isFrozen(plain.object), true);
});

test('buffer and view properties, prototypes and integrity follow the active heap through persistence', async () => {
  const {CowMemory} = await import('../src/cow-memory.ts');
  const {CowHeap} = await import('../src/cow-heap.ts');
  const effects = require('../dist/effects.cjs')(), context = effects.State.context;
  const ops = effects.installOperations(createOperations); context.active = {remaining: 100000};
  const parent = new CowMemory(undefined, new CowHeap()); context.memory = parent;
  const buffer = ops.construct(ArrayBuffer, [8]), view = ops.construct(Uint8Array, [buffer]);
  const symbol = Symbol('alias');
  ops.set(ops.ref(buffer, 'view'), view);
  ops.set(ops.ref(view, 'parent'), 1);
  ops.set(ops.ref(view, symbol), buffer);
  const child = parent.fork(); context.memory = child;
  ops.invoke(Reflect.deleteProperty, Reflect, [view, 'parent']);
  ops.invoke(Object.defineProperty, Object, [view, 'child', {value: buffer, enumerable: false}]);
  ops.invoke(Object.setPrototypeOf, Object, [view, null]);
  ops.invoke(Object.preventExtensions, Object, [view]);
  ops.invoke(Object.preventExtensions, Object, [buffer]);
  ops.set(ops.ref(view, '0'), 42);
  const roots = {buffer, view, symbol};
  for (const result of [effects.S.read(effects.S.write(roots)), effects.prepareCopy(roots, null, null)()]) {
    assert.strictEqual(ops.get(ops.ref(result.buffer, 'view')), result.view);
    assert.strictEqual(ops.get(ops.ref(result.view, result.symbol)), result.buffer);
    assert.strictEqual(ops.get(ops.ref(result.view, 'child')), result.buffer);
    assert.equal(ops.get(ops.ref(result.view, 'parent')), undefined);
    assert.equal(ops.get(ops.ref(result.view, '0')), 42);
    assert.equal(ops.invoke(Object.getPrototypeOf, Object, [result.view]), null);
    assert.equal(ops.invoke(Object.isExtensible, Object, [result.view]), false);
    assert.equal(ops.invoke(Object.isExtensible, Object, [result.buffer]), false);
    assert.equal(ops.invoke(Reflect.set, Reflect, [result.view, 'child', 1]), false);
  }
  context.memory = parent;
  assert.equal(ops.get(ops.ref(view, 'parent')), 1);
  assert.equal(ops.get(ops.ref(view, 'child')), undefined);
  assert.equal(ops.get(ops.ref(view, '0')), 0);
  assert.strictEqual(ops.invoke(Object.getPrototypeOf, Object, [view]), Uint8Array.prototype);
  assert.equal(ops.invoke(Object.isExtensible, Object, [view]), true);
  assert.equal(ops.invoke(Object.isExtensible, Object, [buffer]), true);
});

for (const cow of [false, true]) test(`view persistence preserves NaN payloads and authored properties (COW ${cow})`, async () => {
  const effects = require('../dist/effects.cjs')();
  // ProgramExecution registers the program's intrinsic environment. This
  // isolated effects fixture needs the additional typed-array code identity.
  effects.S.regOpaqueRec(Float64Array, 'environment.Float64Array', {descriptor: {props: false}});
  const buffer = new ArrayBuffer(8), data = new DataView(buffer), view = new Float64Array(buffer);
  data.setBigUint64(0, 0x7ff8000000000123n, true);
  const ops = effects.installOperations(createOperations), context = effects.State.context;
  context.active = {remaining: 100000};
  let parent;
  if (cow) {
    const {CowMemory} = await import('../src/cow-memory.ts');
    parent = new CowMemory();
    parent.adoptView(data); parent.adoptView(view);
    context.memory = parent.fork();
    ops.invoke(DataView.prototype.setBigUint64, data, [0, 0x7ff8000000000456n, true]);
  }
  const symbol = Symbol('view');
  Object.defineProperty(view, '01', {value: data, configurable: true});
  Object.defineProperty(view, symbol, {value: view, configurable: true});
  Object.defineProperty(data, '0', {value: view, configurable: true});
  const roots = {view, data, buffer, symbol};
  const restored = effects.S.read(effects.S.write(roots));
  const copied = effects.prepareCopy(roots, null, null)();
  for (const result of [restored, copied]) {
    assert.equal(ops.invoke(DataView.prototype.getBigUint64, result.data, [0, true]), cow ? 0x7ff8000000000456n : 0x7ff8000000000123n);
    assert.strictEqual(result.view.buffer, result.buffer);
    assert.strictEqual(result.view['01'], result.data);
    assert.strictEqual(result.view[result.symbol], result.view);
    assert.strictEqual(result.data['0'], result.view);
  }
  if (cow) {
    context.memory = parent;
    assert.equal(ops.invoke(DataView.prototype.getBigUint64, data, [0, true]), 0x7ff8000000000123n);
  }
});

test('uncaptured local cells share a COW value group and keep independent fork and codec values',async()=>{
  const {CowIdentityStore}=await import('../src/cow-identities.ts');
  const effects=require('../dist/effects.cjs')(),context=effects.State.context;
  const parent=new CowIdentityStore<any>();context.intrinsicSlots=parent;
  const values=effects.scope([null,...Array.from({length:256},(_,index)=>index)],true);
  assert.equal(parent.size,2,'one scope record and one value group, rather than one record per local');
  const first=values[1],last=values[256],child=parent.fork();context.intrinsicSlots=child;
  first.value=900;last.value=901;
  const restored=effects.S.read(effects.S.write({values})).values;
  assert.equal(restored[1].value,900);assert.equal(restored[256].value,901);
  restored[1].value=902;assert.equal(first.value,900);
  context.intrinsicSlots=parent;assert.equal(first.value,0);assert.equal(last.value,255);
  first.value=800;
  context.intrinsicSlots=child;assert.equal(first.value,900);
});
