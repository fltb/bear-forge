import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperations, protectIntrinsics } from '../src/operations.ts';

test('invalid primitive receivers of error and regexp stringification use V8 failures', () => {
  const operations = createOperations();
  for (const method of [Error.prototype.toString, RegExp.prototype.toString]) {
    for (const receiver of [1, 'x', true, Symbol('s')]) {
      const failure = (invoke: () => unknown) => {
        try { invoke(); return null; }
        catch (error) { return [error instanceof Error ? error.name : typeof error, error instanceof Error ? error.message : String(error)]; }
      };
      assert.deepEqual(failure(() => operations.invoke(method, receiver, [])),
        failure(() => Reflect.apply(method, receiver, [])));
    }
  }
});

test('admitted branded methods reject invalid receivers before touching arguments', () => {
  const operations = createOperations();
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const methods = [
    RegExp.prototype[Symbol.match], RegExp.prototype[Symbol.matchAll],
    RegExp.prototype[Symbol.replace], RegExp.prototype[Symbol.search], RegExp.prototype[Symbol.split],
    ArrayBuffer.prototype.slice, typed.filter, typed.map, typed.slice, typed.subarray,
  ];
  for (const method of methods) for (const receiver of [null, undefined, 1, 'x', true, Symbol('s')]) {
    const failure = (run: () => unknown) => {
      try { run(); return null; }
      catch (error) { return [(error as Error).name, (error as Error).message]; }
    };
    let conversions = 0;
    const argument = { toString() { conversions++; return 'x'; }, valueOf() { conversions++; return 1; } };
    const expected = failure(() => Reflect.apply(method, receiver, [argument, argument]));
    assert.equal(conversions, 0, method.name);
    const actual = failure(() => operations.invoke(method, receiver, [argument, argument]));
    assert.deepEqual(actual, expected, `${method.name} on ${String(receiver)}`);
    assert.equal(conversions, 0, `${method.name} must fail before argument conversion`);
  }
});

test('typed-array bulk set converts offset before rejecting a nullish source', () => {
  const method = Object.getPrototypeOf(Uint8Array.prototype).set;
  const operations = createOperations();
  for (const source of [null, undefined]) {
    const observe = (invoke: (target: Uint8Array, offset: object) => unknown) => {
      const trace: string[] = [], target = new Uint8Array([4, 5]);
      const offset = { valueOf() { trace.push('offset'); return 1; } };
      let failure: [string, string] | null = null;
      try { invoke(target, offset); }
      catch (error) { failure = [(error as Error).name, (error as Error).message]; }
      return { trace, failure, target: [...target] };
    };
    assert.deepEqual(observe((target, offset) => operations.invoke(method, target, [source, offset])),
      observe((target, offset) => Reflect.apply(method, target, [source, offset])));
  }
});

test('legacy descriptor lookup charges inherited property traversal',()=>{
  const lookupGetter=Object.getOwnPropertyDescriptor(Object.prototype,'__lookupGetter__')!.value as Function;
  const lookupSetter=Object.getOwnPropertyDescriptor(Object.prototype,'__lookupSetter__')!.value as Function;
  const root=Object.defineProperty({},'field',{get(){return 1;},set(_value){}});
  let leaf=root;
  for(let index=0;index<4096;index++)leaf=Object.create(leaf);
  for(const method of [lookupGetter,lookupSetter]){
    let ticks=0;const marker=Error('budget');
    const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>limited.invoke(method,leaf,['field']),error=>error===marker,method.name);
    assert.equal(ticks,100,method.name);
  }
  let conversions=0;
  const key={[Symbol.toPrimitive](){conversions++;return 'field';}};
  assert.equal(createOperations().invoke(lookupGetter,leaf,[key]),
    Object.getOwnPropertyDescriptor(root,'field')!.get);
  assert.equal(conversions,1,'the property key must be converted once');
  for(const method of [lookupGetter,lookupSetter]){
    let traps=0;
    const proxy=new Proxy(leaf,{
      getOwnPropertyDescriptor(target,property){traps++;return Reflect.getOwnPropertyDescriptor(target,property);},
      getPrototypeOf(target){traps++;return Reflect.getPrototypeOf(target);}
    });
    Reflect.apply(method,proxy,['field']);
    const expected=traps;
    traps=0;
    createOperations().invoke(method,proxy,['field']);
    assert.equal(traps,expected,'accounting must not repeat observable Proxy traps');
  }
});

test('construction charges an inherited newTarget prototype lookup',()=>{
  let ticks=0;
  const marker=Error('budget');
  const operations=createOperations({tick(){if(++ticks===100)throw marker;}});
  function Target(){}
  const bound=operations.invoke(Function.prototype.bind,Target,[null]);
  let prototype:any={prototype:Array.prototype};
  for(let index=0;index<4096;index++)prototype=Object.create(prototype);
  Object.setPrototypeOf(bound,prototype);
  assert.throws(()=>operations.invoke(Reflect.construct,Reflect,[Array,[],bound]),error=>error===marker);
  assert.equal(ticks,100);
  const unlimited=createOperations();
  const other=unlimited.invoke(Function.prototype.bind,Target,[null]);
  Object.setPrototypeOf(other,prototype);
  const actual=unlimited.invoke(Reflect.construct,Reflect,[Array,[],other]);
  const expected=Reflect.construct(Array,[],other);
  assert.equal(Array.isArray(actual),true);
  assert.equal(Object.getPrototypeOf(actual),Object.getPrototypeOf(expected));
  let reads=0;
  const accessor=Object.defineProperty({},'prototype',{get(){reads++;return Array.prototype;}});
  Object.setPrototypeOf(other,accessor);
  unlimited.invoke(Reflect.construct,Reflect,[Array,[],other]);
  assert.equal(reads,1,'accounting must not read a constructor accessor before V8');
  let traps=0;
  const proxy=new Proxy({prototype:Array.prototype},{
    get(target,key,receiver){traps++;return Reflect.get(target,key,receiver);},
    getPrototypeOf(target){traps++;return Reflect.getPrototypeOf(target);}
  });
  Object.setPrototypeOf(other,proxy);
  Reflect.construct(Array,[],other);
  const expectedTraps=traps;
  traps=0;
  unlimited.invoke(Reflect.construct,Reflect,[Array,[],other]);
  assert.equal(traps,expectedTraps,'accounting must not repeat constructor Proxy traps');
});

test('bound-function metadata charges a long retained name',()=>{
  const target=function target(){};
  Object.defineProperty(target,'name',{value:'x'.repeat(4096),configurable:true});
  let ticks=0;
  const bound=createOperations({tick(){ticks++;}}).invoke(Function.prototype.bind,target,[null]);
  assert.equal(bound.name,'bound '+target.name);
  assert.ok(ticks>=4,`bound a 4096-character name with only ${ticks} charges`);
});

test('property keys charge long primitive strings without changing coercion count',()=>{
  const key='x'.repeat(4096),object=Object.defineProperty({},key,{value:7});
  let ticks=0,conversions=0;
  const operations=createOperations({tick(){ticks++;}});
  assert.equal(operations.get(operations.ref(object,key)),7);
  assert.ok(ticks>=4,`looked up a 4096-character primitive key with only ${ticks} charges`);
  const supplied={[Symbol.toPrimitive](){conversions++;return key;}};
  assert.equal(operations.get(operations.ref(object,supplied)),7);
  assert.equal(conversions,1);
});

test('function-name initialization charges retained text',()=>{
  let ticks=0;
  const operations=createOperations({tick(){ticks++;}});
  const fn=function(){};
  const longName='x'.repeat(4096);
  operations.nameFunction(fn,longName);
  assert.equal(fn.name,longName);
  assert.ok(ticks>=4,`installed a 4096-character function name with only ${ticks} charges`);
});

test('typed-array bulk set charges proportional to copied bytes',()=>{
  let ticks=0;
  const source=new Uint8Array(4096),target=new Uint8Array(4096);
  createOperations({tick(){ticks++;}}).invoke(Uint8Array.prototype.set,target,[source]);
  assert.ok(ticks>=4,`copied 4096 typed-array bytes with only ${ticks} charges`);
});

test('ArrayBuffer slice charges proportional to copied bytes',()=>{
  let ticks=0;
  const source=new ArrayBuffer(4096);
  const result=createOperations({tick(){ticks++;}}).invoke(ArrayBuffer.prototype.slice,source,[0,4096]);
  assert.equal(result.byteLength,4096);
  assert.ok(ticks>=4,`copied 4096 bytes with only ${ticks} charges`);
});

test('object integrity mutations charge each own property',()=>{
  for(const method of [Object.freeze,Object.seal]){
    let ticks=0;
    const value={a:1,b:2,c:3,d:4};
    createOperations({tick(){ticks++;}}).invoke(method,Object,[value]);
    assert.ok(ticks>=4,`${method.name} processed four properties without charging them`);
  }
});

test('object integrity queries charge large property tables despite boolean results',()=>{
  const value=Object.freeze(Object.fromEntries(Array.from({length:4096},(_,index)=>['k'+index,index])));
  for(const method of [Object.isFrozen,Object.isSealed]){
    let ticks=0;const marker=Error('budget');
    const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>limited.invoke(method,Object,[value]),error=>error===marker,method.name);
    assert.equal(ticks,100,method.name);
  }
  let getterReads=0;
  const accessor=Object.freeze(Object.defineProperty({},'x',{get(){getterReads++;return 1;},enumerable:true,configurable:true}));
  assert.equal(createOperations().invoke(Object.isFrozen,Object,[accessor]),true);
  assert.equal(getterReads,0);
  for(const method of [Object.isFrozen,Object.isSealed]){
    let trapReads=0;
    const proxy=new Proxy(value,{ownKeys(target){trapReads++;return Reflect.ownKeys(target);}});
    assert.equal(createOperations().invoke(method,Object,[proxy]),true);
    assert.equal(trapReads,1,method.name+' must not repeat the native Proxy trap');
  }
});
test('own-key filters charge inspected keys even when the returned list is empty',()=>{
  const hidden={};
  for(let index=0;index<4096;index++)Object.defineProperty(hidden,'k'+index,{value:index});
  const stringKeys=Object.fromEntries(Array.from({length:4096},(_,index)=>['k'+index,index]));
  for(const [method,value] of [[Object.keys,hidden],[Object.getOwnPropertySymbols,stringKeys]] as const){
    assert.deepEqual(Reflect.apply(method,Object,[value]),[]);
    let ticks=0;const marker=Error('budget');
    const limited=createOperations({tick(){if(++ticks===64)throw marker;}});
    assert.throws(()=>limited.invoke(method,Object,[value]),error=>error===marker,method.name);
    assert.equal(ticks,64,method.name);
  }
});
test('own-key filters retain native primitive and Proxy observation order',()=>{
  const methods=[Object.keys,Object.getOwnPropertyNames,Object.getOwnPropertySymbols,Reflect.ownKeys];
  for(const method of methods){
    for(const value of ['ab',3,null]){
      function outcome(guarded:boolean){
        try{return {value:guarded?createOperations().invoke(method,Object,[value]):Reflect.apply(method,Object,[value])};}
        catch(error){return {error:[(error as Error).name,(error as Error).message]};}
      }
      assert.deepEqual(outcome(true),outcome(false),method.name+' '+String(value));
    }
    const symbol=Symbol('s');
    function observed(guarded:boolean){
      const trace:string[]=[];
      const proxy=new Proxy({a:1,b:2}, {
        ownKeys(){trace.push('ownKeys');return ['b',symbol,'a'];},
        getOwnPropertyDescriptor(target,key){trace.push('descriptor:'+String(key));return Reflect.getOwnPropertyDescriptor(target,key);},
      });
      return {value:guarded?createOperations().invoke(method,Object,[proxy]):Reflect.apply(method,Object,[proxy]),trace};
    }
    assert.deepEqual(observed(true),observed(false),method.name);
  }
});

test('prototype membership queries charge traversed ordinary prototype links',()=>{
  const top={};let leaf=top;
  for(let index=0;index<4096;index++)leaf=Object.create(leaf);
  let ticks=0;const marker=Error('budget');
  const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
  assert.throws(()=>limited.invoke(Object.prototype.isPrototypeOf,top,[leaf]),error=>error===marker);
  assert.equal(ticks,100);
  let trapReads=0;
  const proxy=new Proxy(leaf,{getPrototypeOf(target){trapReads++;return Reflect.getPrototypeOf(target);}});
  assert.equal(createOperations().invoke(Object.prototype.isPrototypeOf,top,[proxy]),true);
  assert.equal(trapReads,1,'budget accounting must not repeat native Proxy traps');
  function Top(){}
  let child=Top.prototype;
  for(let index=0;index<4096;index++)child=Object.create(child);
  ticks=0;
  assert.throws(()=>limited.invoke(Function.prototype[Symbol.hasInstance],Top,[child]),error=>error===marker);
  assert.equal(ticks,100);
});

test('inherited property access charges traversed ordinary prototype links',()=>{
  const top={x:1};let leaf=top;
  for(let index=0;index<4096;index++)leaf=Object.create(leaf);
  for(const run of [
    (ops:ReturnType<typeof createOperations>)=>ops.get(ops.ref(leaf,'x')),
    (ops:ReturnType<typeof createOperations>)=>ops.has('x',leaf),
    (ops:ReturnType<typeof createOperations>)=>ops.set(ops.ref(leaf,'x'),2),
    (ops:ReturnType<typeof createOperations>)=>ops.invoke(Reflect.get,Reflect,[leaf,'x']),
    (ops:ReturnType<typeof createOperations>)=>ops.invoke(Reflect.has,Reflect,[leaf,'x']),
    (ops:ReturnType<typeof createOperations>)=>ops.invoke(Reflect.set,Reflect,[leaf,'x',2]),
  ]){
    let ticks=0;const marker=Error('budget');
    const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>run(limited),error=>error===marker);
    assert.equal(ticks,100);
  }
  let trapReads=0;
  const proxy=new Proxy(leaf,{getPrototypeOf(target){trapReads++;return Reflect.getPrototypeOf(target);}});
  assert.equal(createOperations().get(createOperations().ref(proxy,'x')),1);
  assert.equal(trapReads,0,'accounting must not inspect a Proxy prototype');
});

test('sparse array algorithms charge inherited index absence checks',()=>{
  let prototype=Array.prototype;
  for(let index=0;index<4096;index++)prototype=Object.create(prototype);
  const source=new Array(1);
  Object.setPrototypeOf(source,prototype);
  source.constructor=Array;
  for(const [method,args] of [
    [Array.prototype.slice,[]],
    [Array.prototype.flat,[]],
    [Array.prototype.map,[(value:unknown)=>value]],
  ] as const){
    let ticks=0;const marker=Error('budget');
    const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>limited.invoke(method,source,[...args]),error=>error===marker,method.name);
    assert.equal(ticks,100,method.name);
  }
});

test('native admission checks charge deep control-property lookup',()=>{
  const regexp=/x/;let regexpPrototype=RegExp.prototype;
  for(let index=0;index<4096;index++)regexpPrototype=Object.create(regexpPrototype);
  Object.setPrototypeOf(regexp,regexpPrototype);
  const array=[1];let arrayPrototype=Array.prototype;
  for(let index=0;index<4096;index++)arrayPrototype=Object.create(arrayPrototype);
  Object.setPrototypeOf(array,arrayPrototype);
  for(const run of [
    (operations:ReturnType<typeof createOperations>)=>operations.invoke(RegExp.prototype[Symbol.match],regexp,['x']),
    (operations:ReturnType<typeof createOperations>)=>operations.invoke(Array.prototype.map,array,[(value:unknown)=>value]),
  ]){
    let ticks=0;const marker=Error('budget');
    const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>run(limited),error=>error===marker);
    assert.equal(ticks,100);
  }
});

test('prototype mutations charge deep cycle checks before native mutation',()=>{
  for(const method of [Object.setPrototypeOf,Reflect.setPrototypeOf]){
    for(const cyclic of [false,true]){
      const target={};let prototype=cyclic?target:{};
      for(let index=0;index<4096;index++)prototype=Object.create(prototype);
      let ticks=0;const marker=Error('budget');
      const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
      assert.throws(()=>limited.invoke(method,method===Reflect.setPrototypeOf?Reflect:Object,[target,prototype]),error=>error===marker);
      assert.equal(ticks,100);
      assert.equal(Object.getPrototypeOf(target),Object.prototype,'budget faults before mutation');
    }
  }
  let trapReads=0;
  const proxy=new Proxy({}, {getPrototypeOf(target){trapReads++;return Reflect.getPrototypeOf(target);}});
  const target={};
  assert.equal(createOperations().invoke(Reflect.setPrototypeOf,Reflect,[target,proxy]),true);
  assert.ok(trapReads<=1,'accounting must not repeat a Proxy getPrototypeOf trap');
  for(const method of [Object.setPrototypeOf,Reflect.setPrototypeOf]){
    let prototype={};for(let index=0;index<4096;index++)prototype=Object.create(prototype);
    const unchanged=Object.create(prototype),frozen=Object.preventExtensions({});
    let ticks=0;const operations=createOperations({tick(){ticks++;}});
    operations.invoke(method,method===Reflect.setPrototypeOf?Reflect:Object,[unchanged,prototype]);
    assert.equal(ticks,0,'setting the existing prototype requires no chain check');
    if(method===Object.setPrototypeOf)assert.throws(()=>operations.invoke(method,Object,[frozen,prototype]),TypeError);
    else assert.equal(operations.invoke(method,Reflect,[frozen,prototype]),false);
    assert.equal(ticks,0,'a non-extensible target fails before a chain check');
  }
});

test('binding a function charges the internal prototype mutation',()=>{
  function target(){}
  let prototype=Function.prototype;
  for(let index=0;index<4096;index++)prototype=Object.create(prototype);
  Object.setPrototypeOf(target,prototype);
  let ticks=0;const marker=Error('budget');
  const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
  assert.throws(()=>limited.invoke(Function.prototype.bind,target,[null]),error=>error===marker);
  assert.equal(ticks,100);
  assert.equal(Object.getPrototypeOf(target),prototype);
});

test('object literal prototype initialization charges deep chains',()=>{
  let prototype={};for(let index=0;index<4096;index++)prototype=Object.create(prototype);
  const target={};let ticks=0;const marker=Error('budget');
  const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
  assert.throws(()=>limited.literalPrototype(target,prototype),error=>error===marker);
  assert.equal(ticks,100);
  assert.equal(Object.getPrototypeOf(target),Object.prototype);
});

test('key-list intrinsics charge each returned key',()=>{
  const source=Object.defineProperties({a:1,b:2,c:3,d:4}, {
    [Symbol('one')]:{value:1,enumerable:true},
    [Symbol('two')]:{value:2,enumerable:true},
    [Symbol('three')]:{value:3,enumerable:true},
    [Symbol('four')]:{value:4,enumerable:true},
  });
  for(const [method,receiver,minimum] of [
    [Object.keys,Object,4],
    [Object.getOwnPropertyNames,Object,4],
    [Object.getOwnPropertySymbols,Object,4],
    [Reflect.ownKeys,Reflect,8],
  ] as const){
    let ticks=0;
    createOperations({tick(){ticks++;}}).invoke(method,receiver,[source]);
    assert.ok(ticks>=minimum,`${method.name} returned keys without charging them`);
  }
});

test('descriptor-table materialization charges every source key',()=>{
  const table={a:{value:1},b:{value:2},c:{value:3},d:{value:4}};
  for(const [method,args] of [
    [Object.defineProperties,[{},table]],
    [Object.create,[null,table]],
  ] as const){
    let ticks=0;
    createOperations({tick(){ticks++;}}).invoke(method,Object,[...args]);
    assert.ok(ticks>=4,`${method.name} processed four descriptors without charging them`);
  }
});

test('object property-copy and value-enumeration adapters charge each visited key',()=>{
  const source={a:1,b:2,c:3,d:4};
  for(const [method,receiver,args] of [
    [Object.assign,Object,[{},source]],
    [Object.values,Object,[source]],
    [Object.entries,Object,[source]],
    [Object.getOwnPropertyDescriptors,Object,[source]],
  ] as const){
    let ticks=0;
    createOperations({tick(){ticks++;}}).invoke(method,receiver,[...args]);
    assert.ok(ticks>=4,`${method.name} visited four keys without charging them`);
  }
});

test('Object.groupBy charges its final per-group materialization',()=>{
  let ticks=0;
  const result=createOperations({tick(){ticks++;}}).invoke((Object as any).groupBy,Object,[[1,2,3,4],(value:number)=>value]);
  assert.deepEqual(Object.keys(result),['1','2','3','4']);
  // Four consumed values and the terminating iterator step cost five ticks.
  assert.ok(ticks>=9,`only ${ticks} steps charged for four values and four output groups`);
});

test('Node-implemented methods on exposed local values need explicit admission', () => {
  const operations = createOperations();
  assert.throws(() => operations.get(operations.ref(URL, 'revokeObjectURL')), /not whitelisted/);
  assert.throws(() => operations.invoke(URL.revokeObjectURL, URL, ['blob:missing']), /not whitelisted/);
  assert.throws(() => operations.get(operations.ref(URL, 'canParse')), /not whitelisted/);
});

test('dynamic code constructors remain blocked through call, apply, bind and reflection', () => {
  const operations = createOperations();
  for (const run of [
    () => operations.invoke(Function, undefined, ['return 1']),
    () => operations.construct(Function, ['return 1']),
    () => operations.invoke(Function.prototype.call, Function, [undefined, 'return 1']),
    () => operations.invoke(Function.prototype.apply, Function, [undefined, ['return 1']]),
    () => operations.invoke(operations.invoke(Function.prototype.bind, Function, [undefined, 'return 1']), undefined, []),
    () => operations.construct(operations.invoke(Function.prototype.bind, Function, [undefined, 'return 1']), []),
    () => operations.invoke(Reflect.apply, Reflect, [Function, undefined, ['return 1']]),
    () => operations.invoke(Reflect.construct, Reflect, [Function, ['return 1']]),
  ]) assert.throws(run, /not admitted/);
});

test('dynamic function constructor identities are readable without admitting execution', () => {
  const operations = createOperations();
  for (const value of [function(){}, async function(){}, function*(){}, async function*(){}]) {
    const constructor = value.constructor;
    assert.strictEqual(operations.get(operations.ref(value, 'constructor')), constructor);
    assert.equal(operations.instanceOf(value, constructor), true);
    assert.throws(() => operations.invoke(constructor, undefined, ['return 1']), /not admitted/);
    assert.throws(() => operations.construct(constructor, ['return 1']), /not admitted/);
  }
});

test('RegExp flags reads overridden fields through the guarded property path', () => {
  const operations = createOperations();
  const getter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')!.get!;
  const seen: string[] = [];
  const value = Object.create(RegExp.prototype);
  for (const key of ['hasIndices', 'global', 'ignoreCase', 'multiline', 'dotAll', 'unicode', 'unicodeSets', 'sticky']) {
    Object.defineProperty(value, key, { configurable: true, get() { seen.push(key); return key === 'global' || key === 'sticky'; } });
  }
  assert.equal(operations.invoke(getter, value, []), 'gy');
  assert.deepEqual(seen, ['hasIndices', 'global', 'ignoreCase', 'multiline', 'dotAll', 'unicode', 'unicodeSets', 'sticky']);
  seen.length = 0;
  assert.equal(operations.get(operations.ref(value, 'flags')), 'gy');
  assert.deepEqual(seen, ['hasIndices', 'global', 'ignoreCase', 'multiline', 'dotAll', 'unicode', 'unicodeSets', 'sticky']);
  Object.defineProperty(value, 'global', { configurable: true, get() { return Number.prototype.toLocaleString; } });
  assert.throws(() => operations.get(operations.ref(value, 'flags')), /not whitelisted/);
});

test('Object toString reads Symbol.toStringTag through the guarded property path', () => {
  const operations = createOperations();
  const values = [undefined, null, 0, 'x', [], () => 1, new Error('x'), /x/,
    new Map(), new Uint8Array(1), Object(1n), Object(Symbol('x'))];
  for (const value of values) {
    assert.equal(operations.invoke(Object.prototype.toString, value, []), Object.prototype.toString.call(value));
  }
  const trace: string[] = [];
  const object = { get [Symbol.toStringTag]() { trace.push('tag'); return 'Custom'; } };
  assert.equal(operations.invoke(Object.prototype.toString, object, []), '[object Custom]');
  assert.deepEqual(trace, ['tag']);
  Object.defineProperty(object, Symbol.toStringTag, { get() { return Number.prototype.toLocaleString; } });
  assert.throws(() => operations.invoke(Object.prototype.toString, object, []), /not whitelisted/);
});

test('error constructors read cause through the guarded original options object', () => {
  const operations = createOperations();
  const constructors: Function[] = [Error, TypeError, RangeError, SyntaxError,
    ReferenceError, EvalError, URIError, AggregateError];
  for (const constructor of constructors) {
    for (const construct of [false, true]) {
      const trace: string[] = [];
      const marker = {};
      const options = Object.create({ get cause() { trace.push('cause'); return marker; } });
      const message = { toString() { trace.push('message'); return 'x'; } };
      const args = constructor === AggregateError ? [[], message, options] : [message, options];
      const result = construct ? operations.construct(constructor, args) : operations.invoke(constructor, undefined, args);
      assert.deepEqual(trace, ['message', 'cause'], constructor.name);
      assert.equal(result.cause, marker);
      assert.equal(Object.getOwnPropertyDescriptor(result, 'cause')?.enumerable, false);
      const denied = { get cause() { return Number.prototype.toLocaleString; } };
      const deniedArgs = constructor === AggregateError ? [[], 'x', denied] : ['x', denied];
      assert.throws(() => construct ? operations.construct(constructor, deniedArgs)
        : operations.invoke(constructor, undefined, deniedArgs), /not whitelisted/, constructor.name);
    }
  }
});

test('descriptor results admit their contained functions before entering program state', () => {
  const operations = createOperations();
  for (const [fn, self, args] of [
    [Object.getOwnPropertyDescriptor, Object, [Number.prototype, 'toLocaleString']],
    [Reflect.getOwnPropertyDescriptor, Reflect, [Number.prototype, 'toLocaleString']],
    [Object.getOwnPropertyDescriptors, Object, [Number.prototype]],
  ] as const) assert.throws(() => operations.invoke(fn, self, [...args]), /not whitelisted/);
  assert.equal(operations.invoke(Object.getOwnPropertyDescriptor, Object, [Function.prototype, 'constructor']).value, Function);
  const getter = () => 3;
  const object = Object.defineProperty({value: 2}, 'read', {get: getter, configurable: true});
  assert.equal(operations.invoke(Object.getOwnPropertyDescriptor, Object, [object, 'value']).value, 2);
  assert.equal(operations.invoke(Object.getOwnPropertyDescriptor, Object, [object, 'read']).get, getter);
});

test('iterator records cache next, preserve elisions and close once after bindings', () => {
  const operations = createOperations(), trace: string[] = [];
  let ticks = 0;
  const charged = createOperations({ tick() { ticks++; } });
  const iterable = { [Symbol.iterator]() { return {
    get next() { trace.push('next-get'); return () => ({ done: false, get value() { trace.push('value'); return 7; } }); },
    return() { trace.push('close'); return {}; }
  }; } };
  const record = charged.iteratorOpen(iterable);
  assert.equal(charged.iteratorStep(record, false), undefined);
  trace.push('default');
  assert.equal(charged.iteratorStep(record), 7);
  operations.iteratorClose(record);
  operations.iteratorClose(record);
  assert.deepEqual(trace, ['next-get', 'default', 'value', 'close']);
  assert.equal(ticks, 2);
});

test('iterator records finish on protocol errors and preserve abrupt completion precedence', () => {
  const operations = createOperations();
  for (const phase of ['next', 'done', 'value']) {
    let closes = 0;
    const record = operations.iteratorOpen({ [Symbol.iterator]() { return {
      next() { if (phase === 'next') throw new Error(phase); return {
        get done() { if (phase === 'done') throw new Error(phase); return false; },
        get value() { throw new Error(phase); }
      }; }, return() { closes++; return {}; }
    }; } });
    assert.throws(() => operations.iteratorStep(record), new RegExp(phase));
    operations.iteratorClose(record);
    assert.equal(closes, 0);
  }
  const iterable = { [Symbol.iterator]() { return { next() { return { done: false }; }, return() { throw new Error('close'); } }; } };
  assert.throws(() => operations.iteratorClose(operations.iteratorOpen(iterable)), /close/);
  assert.doesNotThrow(() => operations.iteratorClose(operations.iteratorOpen(iterable), true));
  const primitiveReturn = { [Symbol.iterator]() { return { next() { return { done: false }; }, return() { return 1; } }; } };
  assert.throws(() => operations.iteratorClose(operations.iteratorOpen(primitiveReturn)), TypeError);
  assert.doesNotThrow(() => operations.iteratorClose(operations.iteratorOpen(primitiveReturn), true));
  for (const value of [0, null, undefined, 1n, Symbol('s')]) {
    const source = () => ({[Symbol.iterator]() { return {
      next() { return {done: false, value: 1}; }, return() { return value; }
    }; }});
    const failure = (run: () => void) => {
      try { run(); return null; }
      catch (error) { return [(error as Error).name, (error as Error).message]; }
    };
    assert.deepEqual(failure(() => operations.iteratorClose(operations.iteratorOpen(source()))),
      failure(() => { for (const item of source() as any) break; }));
  }
});

for (const method of ['slice', 'splice', 'flat'] as const) test(`array ${method} checks species after argument coercion and before allocating its result`, () => {
  const operations = createOperations(), shared = {};
  protectIntrinsics(shared);
  const values = [1, 2];
  const start = { valueOf() {
    Object.defineProperty(values, 'constructor', { value: {
      [Symbol.species]: function() { return shared; }
    }, configurable: true });
    return 0;
  } };
  assert.throws(() => operations.invoke(Array.prototype[method], values, [start]), /custom array species/);
  assert.deepEqual(shared, {});
});

test('native guarded bindings retain their provenance when passed as values or accessors', () => {
  const operations = createOperations();
  const object = { value: 7 };
  const bound = operations.invoke(Function.prototype.bind, function(this: typeof object) { return this.value; }, [object]);
  const descriptor = { get: bound };
  const result = operations.invoke(Object.defineProperty, Object, [{}, 'value', descriptor]);
  assert.equal(operations.get(operations.ref(result, 'value')), 7);
  assert.deepEqual(operations.invoke(Array.prototype.map, [1, 2], [bound]), [7, 7]);
  // An unregistered host bind has no compiler/runtime provenance.
  const unknown = Number.prototype.toLocaleString.bind(7);
  assert.throws(() => operations.invoke(Array.prototype.map, [1], [unknown]), /not whitelisted/);
});

test('splice matches native movement, holes, omission, coercion and abrupt partial writes', () => {
  const operations = createOperations();
  for (const values of [[], [1, 2, 3, 4], [, 2, , 4]]) {
    for (const args of [[], [undefined], [1], [1, undefined], [NaN, 2], [-Infinity, 1], [Infinity, 2],
      [-2, 1], [0, Infinity], [1, 0, 7, 8], [0, 3, 9], [2, 1, 7, 8, 9]]) {
      const expected = values.slice(), actual = values.slice();
      const result = Reflect.apply(Array.prototype.splice, expected, args);
      assert.deepEqual(operations.invoke(Array.prototype.splice, actual, args), result);
      assert.deepEqual(actual, expected);
    }
  }
  function run(controlled: boolean) {
    const log: string[] = [], value: any = { 0: 'a', 2: 'c', length: 4 };
    Object.defineProperty(value, '1', { get() { log.push('get1'); return 'b'; },
      set(v) { log.push('set1:' + v); }, configurable: true, enumerable: true });
    Object.defineProperty(value, '2', { value: 'c', writable: false, enumerable: true, configurable: true });
    const args = [{ valueOf() { log.push('start'); return 0; } }, 1];
    let error;
    try { controlled ? operations.invoke(Array.prototype.splice, value, args) : Reflect.apply(Array.prototype.splice, value, args); }
    catch (caught) { error = (caught as Error).name; }
    return [error, log, value[0], value[2], value.length, Object.keys(value)];
  }
  assert.deepEqual(run(true), run(false));
});

test('flat matches native nesting, holes and length capture before depth conversion', () => {
  const operations = createOperations();
  for (const depth of [undefined, -Infinity, -1, 0, 1, 2, Infinity, NaN]) {
    const value = [1, , [2, , [3, 4]], { length: 1, 0: 5 }];
    assert.deepEqual(operations.invoke(Array.prototype.flat, value, [depth]), Reflect.apply(Array.prototype.flat, value, [depth]));
  }
  function run(controlled: boolean) {
    const values = [[1], [2]], trace: string[] = [];
    const depth = { valueOf() { trace.push('depth'); values.push([3]); return 1; } };
    const result = controlled ? operations.invoke(Array.prototype.flat, values, [depth])
      : Reflect.apply(Array.prototype.flat, values, [depth]);
    return [result, values, trace];
  }
  assert.deepEqual(run(true), run(false));
});

test('bind preserves construction kind without invoking target code or prototype getters', () => {
  const operations = createOperations();
  let effects = 0;
  const arrow = () => { effects++; };
  const ordinary = function(this: { value: number }) { this.value = 7; };
  const target = operations.invoke(Function.prototype.bind, ordinary, [{ value: 0 }]);
  assert.throws(() => operations.invoke(Function.prototype.bind, ordinary.bind({ value: 0 }), [null]), /not whitelisted/);
  Object.defineProperty(target, 'prototype', { get() { effects++; return {}; } });
  for (const fn of [arrow, target]) {
    const bound = operations.invoke(Function.prototype.bind, fn, [null]);
    assert.equal(operations.isConstructor(bound), operations.isConstructor(fn));
    assert.equal(Object.hasOwn(bound, 'prototype'), false);
  }
  assert.equal(effects, 0);
});

test('unexposed host functions cannot be called through the operation layer', () => {
  const operations = createOperations();
  for (const [fn,receiver,args] of [
    [atob,undefined,['YQ==']],[btoa,undefined,['a']],
    [URL.revokeObjectURL,URL,['blob:missing']],[DOMException,undefined,['x']],
  ] as const) assert.throws(() => operations.invoke(fn,receiver,[...args]), /not whitelisted/);
});

test('native debug stacks are not readable and explicit stack data stays local', () => {
  const operations=createOperations();
  const error=new Error('x');
  assert.throws(() => operations.get(operations.ref(error,'stack')), /Unsupported native function used as an accessor/);
  assert.throws(() => operations.invoke(Error.captureStackTrace,Error,[error]), /not admitted/);
  operations.set(operations.ref(error,'stack'),{owned:true});
  assert.deepEqual(operations.get(operations.ref(error,'stack')),{owned:true});
});

test('native iterator prototype graphs are protected like other admitted intrinsic roots', () => {
  const operations = createOperations();
  const values = [operations.invoke(Array.prototype.values, [], []),
    operations.invoke(String.prototype[Symbol.iterator], '', []),
    operations.invoke(Map.prototype.entries, new Map(), []),
    operations.invoke(Set.prototype.values, new Set(), []),
    operations.invoke(Uint8Array.prototype.values, new Uint8Array(), [])];
  for (const value of values) {
    operations.set(operations.ref(value,'ownState'),1);
    assert.equal(operations.get(operations.ref(value,'ownState')),1);
    for (let prototype = Object.getPrototypeOf(value); prototype !== null; prototype = Object.getPrototypeOf(prototype)) {
      try {
        assert.throws(() => operations.set(operations.ref(prototype,'bearMutationProbe'),1), /shared intrinsic/);
        assert.equal(Object.hasOwn(prototype,'bearMutationProbe'),false);
      } finally { Reflect.deleteProperty(prototype,'bearMutationProbe'); }
    }
  }
});


test('generator control methods are admitted while shared generator prototypes remain protected', async () => {
  const operations = createOperations();
  const factories = [
    function* () { try {yield 1;} catch (error) {yield error;} return 3; },
    async function* () { try {yield 1;} catch (error) {yield error;} return 3; }
  ];
  for (const factory of factories) {
    const iterator = factory();
    const invoke = (target:object, method:string, args:unknown[] = []) =>
      operations.invoke(operations.get(operations.ref(target,method)),target,args);
    assert.deepEqual(await invoke(iterator,'next'), {value:1,done:false});
    assert.deepEqual(await invoke(iterator,'throw',[4]), {value:4,done:false});
    assert.deepEqual(await invoke(iterator,'next'), {value:3,done:true});
    const other = factory();
    await invoke(other,'next');
    assert.deepEqual(await invoke(other,'return',[5]), {value:5,done:true});
    // The individual function's prototype is author state; the next ancestor
    // implements the shared generator control methods.
    const owned = Object.getPrototypeOf(iterator), shared = Object.getPrototypeOf(owned);
    operations.set(operations.ref(owned,'ownState'),7);
    assert.equal(operations.get(operations.ref(owned,'ownState')),7);
    assert.throws(() => operations.set(operations.ref(shared,'bearMutationProbe'),1), /shared intrinsic/);
    assert.equal(Object.hasOwn(shared,'bearMutationProbe'),false);
  }
});

test('collection construction charges iterator steps including native next methods', () => {
  for (const constructor of [Map, Set, WeakMap, WeakSet]) {
    let ticks = 0, count = 0;
    const operations = createOperations({ tick() { ticks++; } });
    const keys = [{}, {}, {}];
    const isMap = constructor === Map || constructor === WeakMap;
    const iterable = { [Symbol.iterator]() { return { next() {
      return count < keys.length ? {done:false,value:isMap ? [keys[count++],7] : keys[count++]} : {done:true};
    } }; } };
    const value = operations.construct(constructor, [iterable]);
    assert.equal(ticks, 4);
    for (const key of keys) assert.equal(value.has(key), true);
  }
  let ticks = 0;
  const exhausted = Error('budget');
  const operations = createOperations({tick() { if (++ticks === 5) throw exhausted; }});
  assert.throws(() => operations.construct(Set, [{[Symbol.iterator]() { return {next:Object}; }}]), error => error === exhausted);
  assert.equal(ticks, 5);
});

test('collection constructors preserve cached iterator methods and abrupt close ordering', () => {
  for (const constructor of [Map, Set, WeakMap, WeakSet]) for (const phase of ['ok','next','done','value','key','entry','adder']) {
    const run = (controlled: boolean) => {
      const trace: string[] = [], key = {}, sentinel = Error('sentinel');
      const isMap = constructor === Map || constructor === WeakMap;
      class Collection extends (constructor as any) {}
      Object.defineProperty(Collection.prototype, isMap ? 'set' : 'add', {get() {
        trace.push('adder-get');
        return function() { trace.push('adder-call'); if (phase === 'adder') throw sentinel; };
      }});
      let count = 0;
      const iterable = {[Symbol.iterator]() { trace.push('open'); return {
        get next() { trace.push('next-get'); return () => {
          trace.push('next'); if (phase === 'next') throw sentinel;
          return {get done() { trace.push('done'); if (phase === 'done') throw sentinel; return count++ > 0; },
            get value() { trace.push('value'); if (phase === 'value') throw sentinel;
              return isMap ? {get 0() { trace.push('key'); if (phase === 'key') throw sentinel; return key; },
                get 1() {trace.push('entry'); if (phase === 'entry') throw sentinel; return 7;}} : key;
            }};
        };},
        return() {trace.push('close'); throw Error('secondary');}
      };}};
      let error;
      try { controlled ? createOperations().construct(constructor,[iterable],Collection) : Reflect.construct(constructor,[iterable],Collection); }
      catch (caught) { error = caught === sentinel ? 'sentinel' : String(caught); }
      return {trace,error};
    };
    assert.deepEqual(run(true),run(false),constructor.name+':'+phase);
  }
});

test('slice, flat and every splice traversal charge sparse positions and stop at budget', () => {
  const cases=[
    {name:'slice',method:Array.prototype.slice,source:()=>({length:20}),args:[],ticks:20},
    {name:'flat',method:Array.prototype.flat,source:()=>({length:20}),args:[],ticks:20},
    {name:'splice removed and tail',method:Array.prototype.splice,source:()=>({length:20}),args:[0,20],ticks:40},
    {name:'splice left',method:Array.prototype.splice,source:()=>({length:20}),args:[0,1],ticks:21},
    {name:'splice right',method:Array.prototype.splice,source:()=>({length:20}),args:[0,0,7],ticks:21},
    {name:'splice insert',method:Array.prototype.splice,source:()=>({length:0}),args:[0,0,1,2,3,4,5,6],ticks:6}
  ];
  for(const {name,method,source,args,ticks:expectedTicks} of cases){
    let ticks=0;const op=createOperations({tick(){ticks++;}});
    const actual=source(),expected=source();
    assert.deepEqual(op.invoke(method,actual,args),Reflect.apply(method,expected,args),name);
    assert.deepEqual(actual,expected,name);assert.equal(ticks,expectedTicks,name);
    ticks=0;const marker=Error('budget'),limited=createOperations({tick(){if(++ticks===5)throw marker;}});
    assert.throws(()=>limited.invoke(method,source(),args),error=>error===marker,name);
    assert.equal(ticks,5,name);
  }
  // Reach tail deletion after the extraction phase has finished.
  let ticks=0;const marker=Error('tail budget'),op=createOperations({tick(){if(++ticks===7)throw marker;}});
  assert.throws(()=>op.invoke(Array.prototype.splice,{length:5},[0,5]),error=>error===marker);
  assert.equal(ticks,7);
});

test('flat charges recursive entries before an infinite cyclic descent exhausts the JS stack', () => {
  const cyclic:any[]=[];cyclic.push(cyclic);
  const marker=Error('budget');let ticks=0;
  const op=createOperations({tick(){if(++ticks===20)throw marker;}});
  assert.throws(()=>op.invoke(Array.prototype.flat,cyclic,[Infinity]),error=>error===marker);
  assert.equal(ticks,20);
});

test('native text results charge output work instead of returning a large string for free', () => {
  const cases: Array<[Function, string, unknown[]]> = [
    [String.prototype.repeat, 'x', [409600]],
    [String.prototype.padStart, 'x', [409600, 'y']],
    [String.prototype.padEnd, 'x', [409600, 'y']],
  ];
  for (const [method, receiver, args] of cases) {
    let ticks = 0;
    const marker = Error('budget');
    const limited = createOperations({ tick() { if (++ticks === 100) throw marker; } });
    assert.throws(() => limited.invoke(method, receiver, args), error => error === marker, method.name);
    assert.equal(ticks, 100, method.name);
  }
});

test('RegExp construction charges the compiled pattern text', () => {
  const pattern = 'x'.repeat(409600);
  for (const form of ['call', 'construct'] as const) {
    let ticks = 0;
    const marker = Error('budget');
    const limited = createOperations({ tick() { if (++ticks === 100) throw marker; } });
    assert.throws(() => form === 'call'
      ? limited.invoke(RegExp, undefined, [pattern])
      : limited.construct(RegExp, [pattern]), error => error === marker, form);
    assert.equal(ticks, 100, form);
  }
  const existing = /x/;
  let shortcutTicks = 0;
  assert.equal(createOperations({ tick() { shortcutTicks++; } }).invoke(RegExp, undefined, [existing]), existing);
  assert.equal(shortcutTicks, 0, 'RegExp(existing) reuses its pattern without compiling it');
});

test('native string and RegExp scans cannot inspect large text for zero budget cost', () => {
  const text = 'x'.repeat(409600), spaces = ' '.repeat(409600);
  const cases: Array<[string, Function, unknown, unknown[]]> = [
    ['includes', String.prototype.includes, text, ['y']],
    ['indexOf', String.prototype.indexOf, text, ['y']],
    ['lastIndexOf', String.prototype.lastIndexOf, text, ['y']],
    ['startsWith', String.prototype.startsWith, text, [text.slice(0, -1) + 'y']],
    ['endsWith', String.prototype.endsWith, text, ['y' + text.slice(1)]],
    ['isWellFormed', (String.prototype as any).isWellFormed, text, []],
    ['trim', String.prototype.trim, spaces, []],
    ['trimStart', String.prototype.trimStart, spaces, []],
    ['trimEnd', String.prototype.trimEnd, spaces, []],
    ['split', String.prototype.split, text, ['never']],
    ['RegExp.exec', RegExp.prototype.exec, /y/, [text]],
    ['RegExp.test', RegExp.prototype.test, /y/, [text]],
    ['RegExp.search', RegExp.prototype[Symbol.search], /y/, [text]],
  ];
  for (const [name, method, receiver, args] of cases) {
    let ticks = 0;
    const marker = Error('budget');
    const limited = createOperations({ tick() { if (++ticks === 100) throw marker; } });
    assert.throws(() => limited.invoke(method, receiver, args), error => error === marker, name);
    assert.equal(ticks, 100, name);
  }
});

test('binary constructors charge new backing storage but not a view over existing storage', () => {
  const source = new Uint8Array(409600);
  for (const [name, constructor, argument] of [
    ['ArrayBuffer', ArrayBuffer, 409600],
    ['Uint8Array length', Uint8Array, 409600],
    ['Uint8Array copy', Uint8Array, source],
  ] as const) {
    let ticks = 0;
    const marker = Error('budget');
    const limited = createOperations({ tick() { if (++ticks === 100) throw marker; } });
    assert.throws(() => limited.construct(constructor, [argument]), error => error === marker, name);
    assert.equal(ticks, 100, name);
  }
  let ticks = 0;
  const view = createOperations({ tick() { ticks++; } }).construct(Uint8Array, [source.buffer]);
  assert.equal((view as Uint8Array).buffer, source.buffer);
  assert.equal(ticks, 0);
});

test('copying typed-array methods charge new storage while subarray remains a view', () => {
  const source = new Uint8Array(409600);
  for (const [name, args] of [
    ['toReversed', []], ['toSorted', []], ['with', [0, 1]],
  ] as const) {
    let ticks = 0;
    const marker = Error('budget');
    const limited = createOperations({ tick() { if (++ticks === 100) throw marker; } });
    assert.throws(() => limited.invoke((Uint8Array.prototype as any)[name], source, [...args]), error => error === marker, name);
    assert.equal(ticks, 100, name);
  }
  let ticks = 0;
  const view = createOperations({ tick() { ticks++; } }).invoke(Uint8Array.prototype.subarray, source, []);
  assert.equal(view.buffer, source.buffer);
  assert.equal(ticks, 0);
});

test('typed-array slice charges byte copying even when species reuses a destination buffer', () => {
  const source: any = new Uint8Array(409600), destination = new Uint8Array(409600);
  source.constructor = { [Symbol.species]: function(length: number) {
    assert.equal(length, 409600);
    return destination;
  } };
  let ticks = 0;
  const marker = Error('budget');
  const limited = createOperations({ tick() { if (++ticks === 100) throw marker; } });
  assert.throws(() => limited.invoke(Uint8Array.prototype.slice, source, [0]), error => error === marker);
  assert.equal(ticks, 100);
});

test('native typed-array scans and in-place bulk methods consume bounded work', () => {
  for (const [name, args] of [
    ['fill', [1]], ['copyWithin', [0, 1]], ['reverse', []], ['sort', []],
    ['includes', [255]], ['indexOf', [255]], ['lastIndexOf', [255]],
  ] as const) {
    const source = new Uint8Array(409600);
    let ticks = 0;
    const marker = Error('budget');
    const limited = createOperations({ tick() { if (++ticks === 100) throw marker; } });
    assert.throws(() => limited.invoke((Uint8Array.prototype as any)[name], source, [...args]), error => error === marker, name);
    assert.equal(ticks, 100, name);
  }
});

test('property descriptors read inherited fields and getters in native order', () => {
  const run=(invoke:(fn:Function,self:unknown,args:unknown[])=>any)=>{
    const trace:string[]=[];
    const inherited={get enumerable(){trace.push('enumerable');return true;}};
    const descriptor=Object.create(inherited);
    Object.defineProperty(descriptor,'configurable',{get(){trace.push('configurable');return true;}});
    Object.defineProperty(descriptor,'value',{get(){trace.push('value');return 7;}});
    const key={[Symbol.toPrimitive](hint:string){trace.push('key:'+hint);return 'entry';}};
    const target={};
    const returned=invoke(Object.defineProperty,Object,[target,key,descriptor]);
    return {trace,same:returned===target,defined:Object.getOwnPropertyDescriptor(target,'entry')};
  };
  const native=run((fn,self,args)=>Reflect.apply(fn,self,args));
  const guarded=run((fn,self,args)=>createOperations().invoke(fn,self,args));
  assert.deepEqual(guarded,native);
});

test('descriptor primitives retain native rejection after target and key validation', () => {
  const operations = createOperations();
  const methods: [Function, unknown, (value: unknown) => unknown[]][] = [
    [Object.defineProperty, Object, value => [{}, 'x', value]],
    [Reflect.defineProperty, Reflect, value => [{}, 'x', value]],
    [Object.defineProperties, Object, value => [{}, value]],
    [Object.create, Object, value => [null, value]],
  ];
  const completion = (run: () => unknown) => {
    try { run(); return {kind: 'return'}; }
    catch (error) { return {kind: 'throw', name: (error as Error).name, message: (error as Error).message}; }
  };
  for (const [method, self, args] of methods) for (const value of [undefined, null, 0, false, 'x', 1n, Symbol('s')]) {
    assert.deepEqual(completion(() => operations.invoke(method, self, args(value))),
      completion(() => Reflect.apply(method, self, args(value))), `${method.name} ${String(value)}`);
  }
});

test('descriptor conversion retains V8 accessor and mixed-field failures', () => {
  const operations = createOperations();
  const methods: [Function, unknown, (value: object) => unknown[]][] = [
    [Object.defineProperty, Object, value => [{}, 'x', value]],
    [Reflect.defineProperty, Reflect, value => [{}, 'x', value]],
    [Object.defineProperties, Object, value => [{}, {x: value}]],
    [Object.create, Object, value => [null, {x: value}]],
  ];
  const makers: [string, (trace: string[]) => object][] = [
    ['invalid get', () => ({get: 1})],
    ['invalid set', () => ({set: 0})],
    ['mixed get', () => ({get() {}, value: 1})],
    ['mixed set', () => ({set(_value: unknown) {}, writable: true})],
    ['invalid before mixed', () => ({get: 1, value: 2})],
    ['inherited mixed', trace => Object.assign(Object.create({get get() { trace.push('get'); return function() {}; }}), {value: 1})],
  ];
  const completion = (method: Function, self: unknown, args: (value: object) => unknown[], make: (trace: string[]) => object, guarded: boolean) => {
    const trace: string[] = [];
    try {
      const values = args(make(trace));
      guarded ? operations.invoke(method, self, values) : Reflect.apply(method, self, values);
      return {kind: 'return', trace};
    } catch (error) {
      return {kind: 'throw', name: (error as Error).name, message: (error as Error).message, trace};
    }
  };
  for (const [method, self, args] of methods) for (const [name, make] of makers) {
    assert.deepEqual(completion(method, self, args, make, true),
      completion(method, self, args, make, false), `${method.name} ${name}`);
  }
});

test('descriptor tables invoke own getters and materialize values before definition', () => {
  const run=(invoke:(fn:Function,self:unknown,args:unknown[])=>any)=>{
    const trace:string[]=[];
    const table:any={};
    Object.defineProperty(table,'first',{enumerable:true,get(){trace.push('first');return {value:1,enumerable:true};}});
    Object.defineProperty(table,'second',{enumerable:true,get(){trace.push('second');return {value:2,enumerable:true};}});
    const target={};
    invoke(Object.defineProperties,Object,[target,table]);
    const created=invoke(Object.create,Object,[null,table]);
    return {trace,target:Object.entries(target),created:Object.entries(created),prototype:Object.getPrototypeOf(created)};
  };
  assert.deepEqual(run((fn,self,args)=>createOperations().invoke(fn,self,args)),run((fn,self,args)=>Reflect.apply(fn,self,args)));
});

test('invalid descriptor getter stops before reading its setter field', () => {
  const run=(invoke:(fn:Function,self:unknown,args:unknown[])=>unknown)=>{
    const trace:string[]=[];
    const descriptor={get get(){trace.push('get');return 4;},get set(){trace.push('set');return undefined;}};
    let error='';
    try{invoke(Object.defineProperty,Object,[{},'x',descriptor]);}
    catch(caught){error=(caught as Error).constructor.name;}
    return {trace,error};
  };
  assert.deepEqual(run((fn,self,args)=>createOperations().invoke(fn,self,args)),run((fn,self,args)=>Reflect.apply(fn,self,args)));
});

test('legacy accessor definition converts an object key once after receiver validation', () => {
  for(const method of [(Object.prototype as any).__defineGetter__,(Object.prototype as any).__defineSetter__]){
    const run=(guarded:boolean)=>{
      const trace:string[]=[];
      const key={[Symbol.toPrimitive](hint:string){trace.push(hint);return 'x';}};
      const target:any={};
      const accessor=function(value:unknown){return value;};
      const result=guarded?createOperations().invoke(method,target,[key,accessor]):Reflect.apply(method,target,[key,accessor]);
      const descriptor=Object.getOwnPropertyDescriptor(target,'x')!;
      return {trace,result,configurable:descriptor.configurable,enumerable:descriptor.enumerable,
        get:descriptor.get===accessor,set:descriptor.set===accessor};
    };
    assert.deepEqual(run(true),run(false));
    let conversions=0;
    const key={[Symbol.toPrimitive](){conversions++;return 'x';}};
    assert.throws(()=>createOperations().invoke(method,null,[key,()=>0]),TypeError);
    assert.equal(conversions,0);
  }
});

test('legacy accessor definition rejects invalid callbacks before converting keys', () => {
  const operations = createOperations();
  for (const method of [(Object.prototype as any).__defineGetter__, (Object.prototype as any).__defineSetter__]) {
    for (const invalid of [undefined, null, 0, false, 'x', {}]) {
      const run = (guarded: boolean) => {
        const trace: string[] = [];
        const key = {[Symbol.toPrimitive]() { trace.push('key'); return 'x'; }};
        let failure: unknown = null;
        try {
          if (guarded) operations.invoke(method, {}, [key, invalid]);
          else Reflect.apply(method, {}, [key, invalid]);
        } catch (error) { failure = [(error as Error).name, (error as Error).message]; }
        return {trace, failure};
      };
      assert.deepEqual(run(true), run(false), `${method.name} ${String(invalid)}`);
    }
  }
});

test('definition methods validate their target before inspecting descriptor inputs', () => {
  const operations=createOperations();
  for(const [fn,args] of [
    [Object.defineProperty,[null,'x']],
    [Reflect.defineProperty,[null,'x']],
    [Object.defineProperties,[null]],
    [Object.create,[7]],
  ] as const){
    let inspected=0;
    const descriptor=new Proxy({}, {
      getPrototypeOf(){inspected++;return Object.prototype;},
      ownKeys(){inspected++;return [];},
    });
    assert.throws(()=>Reflect.apply(fn,Object,[...args,descriptor]),TypeError);
    assert.equal(inspected,0,'native inspected a descriptor before rejecting the target');
    assert.throws(()=>operations.invoke(fn,Object,[...args,descriptor]),TypeError);
    assert.equal(inspected,0,'guarded call inspected a descriptor before rejecting the target');
  }
});

test('invalid property targets retain V8 diagnostics without reading later operands',()=>{
  const cases:[Function,unknown][]=[
    [Object.create,7], [Object.defineProperty,null],
    [Reflect.defineProperty,7], [Object.defineProperties,undefined],
    [Reflect.get,null], [Reflect.set,7],
  ];
  for(const [fn,target] of cases){
    const run=(guarded:boolean)=>{
      const trace:string[]=[];
      const key={[Symbol.toPrimitive](){trace.push('key');return 'x';}};
      const descriptor=new Proxy({}, {get(_object,name){trace.push('descriptor:'+String(name));return undefined;},
        ownKeys(){trace.push('descriptor-keys');return [];}});
      const args=fn===Object.create||fn===Object.defineProperties?[target,descriptor]
        :fn===Reflect.get?[target,key,descriptor]
        :fn===Reflect.set?[target,key,1,descriptor]:[target,key,descriptor];
      try{guarded?createOperations().invoke(fn,fn===Reflect.get||fn===Reflect.set?Reflect:Object,args)
        :Reflect.apply(fn,fn===Reflect.get||fn===Reflect.set?Reflect:Object,args);
        return {trace,error:null};
      }catch(error){return {trace,error:[(error as Error).name,(error as Error).message]};}
    };
    const native=run(false);
    assert.deepEqual(native.trace,[],fn.name);
    assert.deepEqual(run(true),native,fn.name);
  }
});

test('native call validation fails before argument-list or iterator reads',()=>{
  for(const mode of ['call','apply','reflect-apply','construct-target','construct-new-target','bind','array-mapper']){
    const run=(guarded:boolean)=>{
      const trace:string[]=[];
      const list={get length(){trace.push('length');return 0;}};
      const items={get [Symbol.iterator](){trace.push('iterator');return [1][Symbol.iterator];}};
      let fn:Function,self:unknown,args:unknown[];
      switch(mode){
        case 'call':fn=Function.prototype.call;self=7;args=[1];break;
        case 'apply':fn=Function.prototype.apply;self=7;args=[null,list];break;
        case 'reflect-apply':fn=Reflect.apply;self=Reflect;args=[7,null,list];break;
        case 'construct-target':fn=Reflect.construct;self=Reflect;args=[7,list,Array];break;
        case 'construct-new-target':fn=Reflect.construct;self=Reflect;args=[Array,list,7];break;
        case 'bind':fn=Function.prototype.bind;self=7;args=[null];break;
        default:fn=Array.from;self=Array;args=[items,7];
      }
      try{guarded?createOperations().invoke(fn,self,args):Reflect.apply(fn,self,args);
        return {trace,error:null};
      }catch(error){return {trace,error:[(error as Error).name,(error as Error).message]};}
    };
    const native=run(false);
    assert.deepEqual(native.trace,[],mode);
    assert.deepEqual(run(true),native,mode);
  }
});

test('invalid apply argument lists retain V8 diagnostics after target validation', () => {
  const operations=createOperations(), target=()=>1;
  const completion=(run:()=>unknown)=>{try{run();return null;}
    catch(error){return [(error as Error).name,(error as Error).message];}};
  for(const list of [0,1,false,true,'x',1n,Symbol('list')]){
    for(const [name,native,guarded] of [
      ['Function.apply',()=>Reflect.apply(Function.prototype.apply,target,[null,list]),()=>operations.invoke(Function.prototype.apply,target,[null,list])],
      ['Reflect.apply',()=>Reflect.apply(Reflect.apply,Reflect,[target,null,list]),()=>operations.invoke(Reflect.apply,Reflect,[target,null,list])],
      ['Reflect.construct',()=>Reflect.apply(Reflect.construct,Reflect,[Array,list]),()=>operations.invoke(Reflect.construct,Reflect,[Array,list])],
    ] as const)assert.deepEqual(completion(guarded),completion(native),`${name}: ${String(list)}`);
  }
});

test('String.raw preserves template reads, substitutions and abrupt completion order', () => {
  for (let mode = 0; mode < 40; mode++) {
    const run = (guarded: boolean) => {
      const trace: string[] = [];
      const raw: Record<string, unknown> = {};
      Object.defineProperty(raw, 'length', { get() {
        trace.push('length');
        return { [Symbol.toPrimitive](hint: string) {
          trace.push(`length:${hint}`);
          Object.defineProperty(raw, '1', { value: 'changed', configurable: true });
          return mode % 4;
        } };
      } });
      for (let index = 0; index < 4; index++) Object.defineProperty(raw, index, {
        configurable: true,
        get() {
          trace.push(`raw:${index}`);
          if (mode % 11 === 0 && index === 1) throw new RangeError('raw');
          return String(index);
        }
      });
      const template = { get raw() { trace.push('getraw'); return mode % 17 === 0 ? null : raw; } };
      const substitution = { toString() {
        trace.push('substitution');
        if (mode % 19 === 0) throw new SyntaxError('substitution');
        return '!';
      } };
      try {
        const value = guarded
          ? createOperations().invoke(String.raw, String, [template, substitution, substitution])
          : String.raw(template as any, substitution, substitution);
        return { value, trace };
      } catch (error) {
        return { error: (error as Error).name, trace };
      }
    };
    assert.deepEqual(run(true), run(false), `mode ${mode}`);
  }
});

test('generic ToObject failures retain the target V8 error observed by author code', () => {
  const operations = createOperations();
  const cases: [string, Function, unknown, unknown[]][] = [
    ['String.raw template', String.raw, String, [null]],
    ['String.raw raw field', String.raw, String, [{ raw: null }]],
    ['Array.join', Array.prototype.join, null, []],
    ['Array.splice', Array.prototype.splice, null, []],
    ['Array.slice', Array.prototype.slice, null, []],
    ['Array.flat', Array.prototype.flat, null, []],
    ['Object.assign', Object.assign, Object, [null, {}]],
    ['Object.entries', Object.entries, Object, [null]],
    ['Object.values', Object.values, Object, [null]],
    ['Array.toString', Array.prototype.toString, null, []],
  ];
  const error = (action: () => unknown) => {
    try { action(); return null; }
    catch (caught) { return [(caught as Error).name, (caught as Error).message]; }
  };
  for (const [name, method, receiver, args] of cases) {
    assert.deepEqual(error(() => operations.invoke(method, receiver, args)),
      error(() => Reflect.apply(method, receiver, args)), name);
  }
});

test('nullish receiver failures use the admitted V8 intrinsic diagnostics', () => {
  const operations = createOperations();
  const methods = [String.prototype.concat, String.prototype.replace,
    String.prototype.replaceAll, String.prototype.match, String.prototype.matchAll,
    String.prototype.search, String.prototype.split, Array.prototype.map,
    Array.prototype.concat, Object.prototype.toLocaleString,
    (Object.prototype as any).__defineGetter__, (Object.prototype as any).__defineSetter__,
    RegExp.prototype.exec, RegExp.prototype.test, RegExp.prototype[Symbol.match],
    RegExp.prototype[Symbol.matchAll], RegExp.prototype[Symbol.replace],
    RegExp.prototype[Symbol.search], RegExp.prototype[Symbol.split],
    RegExp.prototype.toString, Error.prototype.toString,
    String.prototype[Symbol.iterator]];
  for (const method of methods) for (const receiver of [null, undefined]) {
    const error = (action: () => unknown) => {
      try { action(); return null; }
      catch (caught) { return [(caught as Error).name, (caught as Error).message]; }
    };
    assert.deepEqual(error(() => operations.invoke(method, receiver, [])),
      error(() => Reflect.apply(method, receiver, [])), `${method.name}: ${receiver}`);
  }
});

test('registered compiled calls retain admission, receiver, bound forwarding and materialization charges',()=>{
  const rejected={},receiver={prefix:'result:'};
  let calls=0,ticks=0;
  function compiled(this:typeof receiver,value:unknown){calls++;return value===undefined?rejected:this.prefix+String(value);}
  function text(){return 'x'.repeat(2048);}
  const known=new Set<Function>([compiled,text]);
  const operations=createOperations({compiled:fn=>known.has(fn),value(value){if(value===rejected)throw new TypeError('rejected value');},tick(){ticks++;}});
  assert.throws(()=>operations.invoke(compiled,receiver,[rejected]),/rejected value/);
  assert.equal(calls,0,'arguments are admitted before entering compiled code');
  assert.equal(operations.invoke(compiled,receiver,['ok']),'result:ok');
  assert.throws(()=>operations.invoke(compiled,receiver,[]),/rejected value/);
  const bound=operations.invoke(Function.prototype.bind,compiled,[receiver,'bound']);
  assert.equal(operations.invoke(bound,null,[]),'result:bound');
  const before=ticks;assert.equal(operations.invoke(text,null,[]).length,2048);
  assert.equal(ticks-before,2,'compiled results retain materialization charges');
  assert.throws(()=>operations.invoke(Date.now,null,[]),/Ambient or dynamic/);
  assert.throws(()=>operations.invoke((()=>1).bind(null),null,[]),/not whitelisted/);
  assert.equal(operations.invoke(Math.max,null,[1,3,2]),3);
});
