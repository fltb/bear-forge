import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';
function logical(effects: any) {
  const ops=effects.operations;
  const O=effects.globals.Object,R=effects.globals.Reflect;
  return {
    get:(object: any,...path: PropertyKey[]): any=>path.reduce((value,key)=>ops.get(ops.ref(value,key)),object),
    set:(object: any,key: PropertyKey,value: unknown)=>ops.set(ops.ref(object,key),value),
    ownKeys:(object: object)=>Array.from(ops.invoke(R.ownKeys,R,[object])) as PropertyKey[],
    descriptor:(object: object,key: PropertyKey)=>{
      const value=ops.invoke(O.getOwnPropertyDescriptor,O,[object,key]);
      return value===undefined?undefined:Object.fromEntries(Array.from(ops.invoke(R.ownKeys,R,[value]) as PropertyKey[])
        .map(field=>[field,ops.get(ops.ref(value,field))]));
    },
    prototype:(object: object)=>ops.invoke(O.getPrototypeOf,O,[object]),
    sealed:(object: object)=>ops.invoke(O.isSealed,O,[object]),
    extensible:(object: object)=>ops.invoke(O.isExtensible,O,[object])
  };
}

test('empty string keys and distinct absent/empty/global Symbol descriptions survive every copy path',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    const global=Symbol.for(''),empty=Symbol(''),absent=Symbol();
    const object={'':7,[global]:8,[empty]:9,[absent]:10};
    await io.call({port:'step',input:null});
    return [object[''],object[global],object[empty],object[absent],
      global===Symbol.for(''),Symbol.keyFor(global)==='',empty.description==='',absent.description===undefined,
      global!==empty,empty!==absent,Reflect.ownKeys(object).length];
  }};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot(),fork=parent.fork(),restored=parent.fresh();restored.restore(snapshot);
  for(const instance of [parent,fork,restored]){
    instance.resume(null);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,[7,8,9,10,true,true,true,true,true,true,4]);
  }
});

test('COW siblings and schema branches never discover a whole-state copy layout', () => {
  const artifact = decode(compileJavaScript(`let count=0;
    export const program={schemas:{setup:{parse(){count++;return null;}},result:{},ports:{}},async run(n,io){
      const amount=await io.call({port:'step',input:count});count+=amount;
      await io.call({port:'step',input:count});return count;
    }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  const effects = parent.loaded.effects, prepare = effects.prepareCopy;
  let preparations = 0;
  effects.prepareCopy = (...args: unknown[]) => { preparations++; return prepare(...args); };
  try {
    const old = parent.fork(), sibling = parent.fork();
    assert.equal(preparations, 0);
    parent.boundarySchemas().setup.parse(null);
    const afterValidation = parent.fork();
    assert.equal(preparations, 0);
    old.resume(2); sibling.resume(3); afterValidation.resume(2);
    assert.equal(old.io.callData.input, 2);
    assert.equal(sibling.io.callData.input, 3);
    assert.equal(afterValidation.io.callData.input, 3);
    parent.resume(4);
    const afterAdvance = parent.fork();
    assert.equal(preparations, 0);
    afterAdvance.resume(null);
    assert.equal(afterAdvance.result.value, 5);
    const restored = new ProgramExecution(artifact); restored.restore(parent.snapshot());
    const restoredBranch = restored.fork(); restoredBranch.resume(null);
    assert.equal(restoredBranch.result.value, 5);
  } finally { effects.prepareCopy = prepare; }
});

test('schema boundary exposes only guarded parse operations, not authored objects', () => {
  const artifact = decode(compileJavaScript(`let count=0,parsed;
    const setup={parse(value){count++;parsed={count,value};return parsed;},safeParse(){count+=100;return {success:true};},secret:{value:7}};
    export const program={schemas:{setup,result:{parse(value){return value;}},ports:{step:{
      input:{parse(value){return value;}},output:{parse(value){return value;}},secret:{value:8}
    }},secret:{value:9}},async run(_,io){
      await io.call({port:'step',input:null});return [count,parsed.count];
    }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal('program' in parent, false);
  const boundary = parent.boundarySchemas();
  assert.deepEqual(Reflect.ownKeys(boundary), ['setup','result','ports']);
  assert.deepEqual(Reflect.ownKeys(boundary.setup), ['parse']);
  assert.deepEqual(Reflect.ownKeys(boundary.ports.step), ['input','output']);
  assert.equal(boundary.setup.safeParse, undefined);
  assert.equal(boundary.setup.secret, undefined);
  assert.equal(boundary.ports.step.secret, undefined);
  assert.equal(boundary.secret, undefined);
  const result = boundary.setup.parse(null);
  assert.deepEqual(result, {count:1,value:null});
  result.count=99;
  const fork = parent.fork(), restored = new ProgramExecution(artifact); restored.restore(parent.snapshot());
  for (const instance of [parent, fork, restored]) {
    instance.resume(null);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, [1,1]);
  }
});

test('standalone schema parsing does not exchange mutable aliases with Context', () => {
  const artifact = decode(compileJavaScript(`let retained;
    export const program={schemas:{setup:{parse(value){value.n++;retained=value;return value;}},result:{},ports:{}},async run(_,io){
      await io.call({port:'step',input:null});return retained.n;
    }};`).content);
  const parent = new ProgramExecution(artifact);
  parent.start(null);
  const input = {n:1};
  const output = parent.boundarySchemas().setup.parse(input);
  assert.equal(input.n,1);
  assert.equal(output.n,2);
  output.n=99;
  const fork = parent.fork(), restored = new ProgramExecution(artifact);
  restored.restore(parent.snapshot());
  try {
    for (const instance of [parent,fork,restored]) {
      instance.resume(null);
      assert.equal(instance.result.status,1,String(instance.result.value));
      assert.equal(instance.result.value,2);
    }
  } finally {
    parent.dispose(); fork.dispose(); restored.dispose();
  }
});

test('copy failures never inspect an unregistered function name',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});return 1;
  }};`).content);
  const execution=new ProgramExecution(artifact);execution.start(null);
  let reads=0;
  const fn=()=>0;
  Object.defineProperty(fn,'name',{get(){reads++;throw Error('name getter ran');},configurable:true});
  const internal=execution as any;
  internal.context.unregistered=fn;
  const branch=execution.fork();branch.dispose();
  internal.loaded.enter(internal.context,()=>{
    assert.throws(()=>internal.loaded.effects.prepareCopy({fn}),/Unregistered function in copy plan/);
  });
  assert.equal(reads,0);
});

test('namespace projection matches its descriptor identity, not a registration name prefix',()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},async run(_,io){
    await io.call({port:'step',input:null});return 1;
  }};`).content);
  const execution=new ProgramExecution(artifact);execution.start(null);
  const internal=execution as any;
  internal.loaded.enter(internal.context,()=>{
    const {S,prepareCopy}=internal.loaded.effects;
    const descriptor=(name:string)=>S.regDescriptor({name,props:false,create:internal.loaded.record,write:internal.loaded.record});
    const selected=descriptor('program.namespace.selected');
    const other=descriptor('program.namespace.unrelated');
    const value=Object.assign(internal.loaded.record(),{keep:1,extra:2});
    S.setObjectDescriptor(value,other);
    const root=Object.assign(internal.loaded.record(),{value});
    const selectedPlan=prepareCopy(root,['keep'],selected),fullPlan=prepareCopy(root,[]);
    for(const copy of [selectedPlan(),selectedPlan(),fullPlan(),fullPlan()]){
      assert.equal(copy.value.keep,1);
      assert.equal(copy.value.extra,2);
    }
  });
});

test('fresh and reusable copy plans preserve author-created prototype aliases', () => {
  const instance = new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){
    const functions=[()=>1,async function(){return 2;},{method(){return 3;}}.method,function*(){yield 4;}];
    const prototypes=functions.map(fn=>{
      const prototype={};Object.defineProperty(prototype,'constructor',{value:fn,writable:true,configurable:true});
      fn.prototype=prototype;return prototype;
    });
    return {functions,prototypes};
  }};`).content));
  instance.start(null);
  assert.equal(instance.result.status, 1, String(instance.result.value));
  const runtime = instance as any;
  runtime.loaded.enter(runtime.context, () => {
    const {get,set,ownKeys,descriptor,prototype:proto,sealed,extensible}=logical(runtime.loaded.effects);
    const root = instance.result.value, effects = runtime.loaded.effects;
    const plan = effects.prepareCopy(root);
    const copies = [root, effects.prepareCopy(root)(), plan(), plan(), effects.S.read(effects.S.write(root))];
    for (const [index, copy] of copies.entries()) {
      for (let i = 0; i < get(copy,'functions','length'); i++) {
        const fn = get(copy,'functions',i), prototype = get(copy,'prototypes',i);
        assert.strictEqual(get(fn,'prototype'), prototype);
        assert.strictEqual(proto(prototype), get(runtime.context.globals,'Object','prototype'));
        assert.deepEqual(descriptor(prototype, 'constructor'), {
          value: fn, writable: true, enumerable: false, configurable: true
        });
        assert.throws(() => Reflect.construct(fn, []), TypeError);
      }
      assert.equal(get(copy,'prototypes',0,'marker'), undefined);
      set(get(copy,'prototypes',0),'marker',index);
    }
    for (const [index, copy] of copies.entries()) assert.equal(get(copy,'prototypes',0,'marker'), index);
  });
});

test('function own descriptors survive deletion, reinsertion and sealing in every copy path', () => {
  const instance = new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){
    const functions=[function(a){return a;},()=>1,async function(){return 2;},{method(){return 3;}}.method,function*(){yield 4;},(()=>5).bind(null)];
    const removed=()=>0;delete removed.name;delete removed.length;
    for(const fn of functions){
      delete fn.name;delete fn.length;
      fn.extra={owner:fn};fn[2]='two';fn[1]='one';
      Object.defineProperty(fn,'name',{value:'renamed',configurable:true});
      Object.defineProperty(fn,'length',{value:9,configurable:true});
      Object.seal(fn);
    }
    return {functions,removed};
  }};`).content));
  instance.start(null);
  assert.equal(instance.result.status, 1, String(instance.result.value));
  const runtime = instance as any;
  runtime.loaded.enter(runtime.context, () => {
    const {get,set,ownKeys,descriptor,prototype:proto,sealed,extensible}=logical(runtime.loaded.effects);
    const root = instance.result.value, effects = runtime.loaded.effects;
    const plan = effects.prepareCopy(root);
    for (const copy of [effects.prepareCopy(root)(), plan(), plan(), effects.S.read(effects.S.write(root))]) {
      assert.deepEqual(ownKeys(get(copy,'removed')), []);
      for (let i = 0; i < get(root,'functions','length'); i++) {
        const source = get(root,'functions',i), target = get(copy,'functions',i);
        assert.deepEqual(ownKeys(target), ownKeys(source));
        assert.equal(sealed(target), true);
        assert.strictEqual(get(target,'extra','owner'), target);
        assert.notStrictEqual(get(target,'extra'), get(source,'extra'));
        for (const key of ownKeys(source)) {
          const {value: before, ...beforeFlags} = descriptor(source, key)!;
          const {value: after, ...afterFlags} = descriptor(target, key)!;
          assert.deepEqual(afterFlags, beforeFlags);
          if (before === null || typeof before !== 'object') assert.equal(after, before);
        }
      }
    }
  });
});

test('native error allocation does not recreate deleted properties or reorder author descriptors', () => {
  const instance = new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){
    const removed=new Error('removed');delete removed.stack;delete removed.message;
    const reordered=new TypeError('old');delete reordered.stack;delete reordered.message;
    reordered.extra={owner:reordered};reordered.message='new';reordered.stack='assigned';Object.seal(reordered);
    const assigned=new Error('assigned');assigned.stack='saved';delete assigned.stack;
    return {errors:[removed,reordered,assigned]};
  }};`).content));
  instance.start(null);
  assert.equal(instance.result.status, 1, String(instance.result.value));
  const runtime = instance as any;
  runtime.loaded.enter(runtime.context, () => {
    const {get,set,ownKeys,descriptor,prototype:proto,sealed,extensible}=logical(runtime.loaded.effects);
    const root = instance.result.value, effects = runtime.loaded.effects, plan = effects.prepareCopy(root);
    for (const copy of [effects.prepareCopy(root)(), plan(), plan(), effects.S.read(effects.S.write(root))]) {
      for (let i = 0; i < get(root,'errors','length'); i++) {
        const source = get(root,'errors',i), target = get(copy,'errors',i);
        assert.deepEqual(ownKeys(target), ownKeys(source));
        assert.strictEqual(proto(target), proto(source));
        assert.equal(extensible(target), extensible(source));
        for (const key of ownKeys(source)) {
          const {value: before, ...beforeFlags} = descriptor(source, key)!;
          const {value: after, ...afterFlags} = descriptor(target, key)!;
          assert.deepEqual(afterFlags, beforeFlags);
          if (before === null || typeof before !== 'object') assert.equal(after, before);
        }
      }
      assert.strictEqual(get(copy,'errors',1,'extra','owner'), get(copy,'errors',1));
      assert.notStrictEqual(get(copy,'errors',1,'extra'), get(root,'errors',1,'extra'));
    }
  });
});

test('native error and cyclic assigned stack survive every copy path', () => {
  const instance = new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){
    const error=new TypeError('invalid');
    const state={error};error.stack=state;return state;
  }};`).content));
  instance.start(null);
  assert.equal(instance.result.status, 1, String(instance.result.value));
  const runtime = instance as any;
  runtime.loaded.enter(runtime.context, () => {
    const {get,set,ownKeys,descriptor,prototype:proto,sealed,extensible}=logical(runtime.loaded.effects);
    const root = instance.result.value, effects = runtime.loaded.effects, plan = effects.prepareCopy(root);
    const copies = [effects.prepareCopy(root)(), plan(), plan(), effects.S.read(effects.S.write(root))];
    for (const [index, copy] of copies.entries()) {
      assert.ok(runtime.loaded.effects.operations.instanceOf(get(copy,'error'),get(runtime.context.globals,'TypeError')));
      assert.equal(get(copy,'error','name'), 'TypeError');
      assert.equal(get(copy,'error','message'), 'invalid');
      assert.strictEqual(get(copy,'error','stack'), copy);
      assert.notStrictEqual(get(copy,'error'), get(root,'error'));
      set(copy,'marker',index);
    }
    assert.equal(get(root,'marker'), undefined);
    for (const [index, copy] of copies.entries()) assert.equal(get(copy,'error','stack','marker'), index);
  });
});

test('closure codecs derive from existing metadata without duplicate per-function registration',()=>{
  const parent=new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    let value=n;const add=amount=>value+=amount;
    const reply=await io.call({port:'step',input:null});return [add(reply),add(1)];
  }};`).content));
  parent.start(3);
  const fork=parent.fork(),restored=parent.fresh();restored.restore(parent.snapshot());
  for(const [index,instance]of[parent,fork,restored].entries()){
    const runtime=instance as any;
    runtime.loaded.enter(runtime.context,()=>{
      const {S,State}=runtime.loaded.effects,fn=runtime.context.bindings.run;
      assert.equal(State.closures.has(fn),true);
      assert.equal(S.getState().byObject.has(fn),false);
      assert.equal(S.getObjectDescriptor(fn).name,'#F');
    });
    instance.resume(index+1);
    assert.equal(instance.result.status,1);
    assert.deepEqual(instance.result.value,[index+4,index+5]);
  }
  const runtime=parent as any;
  runtime.loaded.enter(runtime.context,()=>{
    const {S}=runtime.loaded.effects,fn=runtime.context.bindings.run;
    S.regOpaqueObject(fn,'test.explicitClosure',{props:false});
    assert.equal(S.getObjectDescriptor(fn),S.getState().byObject.get(fn));
    assert.equal(S.getObjectDescriptor(fn).value,fn);
  });
});

test('object literals preserve suspended evaluation, keys, descriptors and branch isolation', () => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},async run(n,io){
    const symbol=Symbol('field'), child={value:1};
    let calls=0;
    const key={toString(){calls++;return 'field';}};
    const object={3:3, first:child, [key]:await io.call({port:'step',input:calls}),
      first:child, [symbol]:child, ['__proto__']:child};
    const proto={inherited:7}, withPrototype={__proto__:proto, data:2};
    const getter={get value(){return 9;}}, spread={...getter};
    await io.call({port:'step',input:[calls,Object.keys(object),withPrototype.inherited,spread.value]});
    const next=await io.call({port:'step',input:null});
    object.first.value=next;
    const d=Object.getOwnPropertyDescriptor(object,'field');
    return [object.first.value,object[symbol].value,object.__proto__.value,
      object.field,calls,d.writable,d.enumerable,d.configurable,Object.keys(object)];
  }};`).content);
  const parent = new ProgramExecution(artifact); parent.start(null);
  assert.equal(parent.io.callData.input, 1);
  parent.resume(4);
  assert.deepEqual(parent.io.callData.input, [1, ['3','first','field','__proto__'], 7, 9]);
  const restored = parent.fresh(); restored.restore(parent.snapshot());
  const child = parent.fork();
  for (const [instance, value] of [[parent,10],[child,20],[restored,30]] as const) {
    instance.resume(null); instance.resume(value);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value,[value,value,value,4,1,true,true,true,['3','first','field','__proto__']]);
  }
});

test('isolated schema wrappers cannot mutate the boundary baseline or retain host aliases', async () => {
  const {read} = await import('@bear-forge/boundary');
  const artifact = decode(compileJavaScript(`let retained;
    export const program={schemas:{setup:{parse(value){retained=value;return value;}},
      result:{parse(value){return retained;}},ports:{step:{input:{parse(value){value.child.n++;return value;}},output:{parse(value){return value;}}}}},
      async run(_,io){await io.call({port:'step',input:null});return 1;}};`).content);
  const execution = new ProgramExecution(artifact), schemas = execution.boundarySchemas();
  let getters = 0;
  const invalid = {get child() {getters++; return {n:1};}};
  // Supplying a public second argument must not bypass the private admission.
  assert.throws(() => schemas.setup.parse(invalid, true), /enumerable data properties/);
  assert.equal(getters, 0);
  const child = {n:1}, input: any = {child, alias:child, array:[, child]};
  input.self = input;
  Object.defineProperty(input, '__proto__', {value: child, enumerable: true, writable: true, configurable: true});
  const result = read<typeof input>(schemas.setup, input);
  assert.notEqual(result.child, child);
  assert.equal(result.child, result.alias);
  assert.equal(result.self, result);
  assert.equal(result.array.length, 2);
  assert.equal(0 in result.array, false);
  assert.equal(result.array[1], result.child);
  assert.equal(result.__proto__, result.child);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  result.child.n = 10;
  assert.equal(child.n, 1);
  assert.deepEqual(read(schemas.result, input), input);
  assert.throws(() => read(schemas.ports.step.input, input), /changed its input/);
  assert.equal(child.n, 1);
  execution.dispose();
});
