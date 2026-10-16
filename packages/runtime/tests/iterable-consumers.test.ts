import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';

const consumers = [
  {name:'Array.from', fn:Array.from, self:Array},
  {name:'Object.fromEntries', fn:Object.fromEntries, self:Object},
  {name:'Object.groupBy', fn:(Object as any).groupBy, self:Object},
  {name:'Map.groupBy', fn:(Map as any).groupBy, self:Map}
];

test('invalid callable iterable sources retain V8 source-category errors', () => {
  const operations = createOperations();
  const source = function source() {};
  const completion = (run: () => unknown) => {
    try { run(); return null; }
    catch (error) { return [(error as Error).name, (error as Error).message]; }
  };
  for (const [name, native, guarded] of [
    ['fromEntries', () => Object.fromEntries(source as any), () => operations.invoke(Object.fromEntries, Object, [source])],
    ['groupBy', () => (Object as any).groupBy(source, () => 1), () => operations.invoke((Object as any).groupBy, Object, [source, () => 1])],
    ['Map', () => new Map(source as any), () => operations.construct(Map, [source])],
    ['Set', () => new Set(source as any), () => operations.construct(Set, [source])],
  ] as const) assert.deepEqual(completion(guarded), completion(native), name);
});

test('entry consumers retain V8 primitive-source and primitive-entry failures', () => {
  const operations = createOperations();
  const completion = (run: () => unknown) => {
    try { return {value: run()}; }
    catch (error) { return {name: (error as Error).name, message: (error as Error).message}; }
  };
  for (const value of [0, 1, false, true, 1n, Symbol('s'), '', 'x', 'ab']) {
    assert.deepEqual(completion(() => operations.invoke(Object.fromEntries, Object, [value])),
      completion(() => Object.fromEntries(value as any)), String(value));
  }
  for (const entry of [0, false, null, undefined, 'x', Symbol('s')]) {
    const source = () => [entry];
    assert.deepEqual(completion(() => operations.invoke(Object.fromEntries, Object, [source()])),
      completion(() => Object.fromEntries(source() as any)), `fromEntries ${String(entry)}`);
    for (const constructor of [Map, WeakMap]) {
      assert.deepEqual(completion(() => operations.construct(constructor, [source()])),
        completion(() => new constructor(source() as any)), `${constructor.name} ${String(entry)}`);
    }
  }
});

test('collection and aggregate constructors retain primitive iterable failures', async () => {
  const operations = createOperations();
  const completion = (run: () => unknown) => {
    try { run(); return null; }
    catch (error) { return [(error as Error).name, (error as Error).message]; }
  };
  for (const value of [0, false, 1n, Symbol('s'), undefined, null]) {
    for (const constructor of [Map, Set, WeakMap, WeakSet, AggregateError]) {
      assert.deepEqual(completion(() => operations.construct(constructor, [value])),
        completion(() => Reflect.construct(constructor, [value])),
        `${constructor.name} ${String(value)}`);
    }
    const rejection = async (run: () => Promise<unknown>) => {
      try { await run(); return null; }
      catch (error) { return [(error as Error).name, (error as Error).message]; }
    };
    assert.deepEqual(await rejection(() => operations.invoke(Promise.all, Promise, [value])),
      await rejection(() => Promise.all(value as any)));
  }
});

test('native iterable consumers retain V8 iterator-stage errors and getter order', () => {
  const operations = createOperations();
  const consumers: [string, (value: unknown) => unknown, (value: unknown) => unknown][] = [
    ['Map', value => new Map(value as any), value => operations.construct(Map, [value])],
    ['Set', value => new Set(value as any), value => operations.construct(Set, [value])],
    ['WeakMap', value => new WeakMap(value as any), value => operations.construct(WeakMap, [value])],
    ['WeakSet', value => new WeakSet(value as any), value => operations.construct(WeakSet, [value])],
    ['AggregateError', value => new AggregateError(value as any), value => operations.construct(AggregateError, [value])],
    ['Object.fromEntries', value => Object.fromEntries(value as any), value => operations.invoke(Object.fromEntries, Object, [value])],
    ['Object.groupBy', value => (Object as any).groupBy(value, () => 0), value => operations.invoke((Object as any).groupBy, Object, [value, () => 0])],
    ['Map.groupBy', value => (Map as any).groupBy(value, () => 0), value => operations.invoke((Map as any).groupBy, Map, [value, () => 0])],
    ['Array.from', value => Array.from(value as any), value => operations.invoke(Array.from, Array, [value])],
  ];
  const sources: Record<string, (trace: string[]) => object> = {
    missingMethod: trace => ({get [Symbol.iterator]() { trace.push('iterator'); return 0; }}),
    primitiveIterator: trace => ({[Symbol.iterator]() { trace.push('iterator'); return 0; }}),
    invalidNext: trace => ({[Symbol.iterator]() { trace.push('iterator'); return {get next() { trace.push('next'); return 0; }}; }}),
    primitiveResult: trace => ({[Symbol.iterator]() { trace.push('iterator'); return {next() { trace.push('next'); return 0; }}; }}),
  };
  function completion(run: (value: unknown) => unknown, source: (trace: string[]) => object) {
    const trace: string[] = [];
    try { run(source(trace)); return {kind: 'return', trace}; }
    catch (error) { return {kind: 'throw', name: (error as Error).name, message: (error as Error).message, trace}; }
  }
  for (const [consumer, native, guarded] of consumers) for (const [stage, source] of Object.entries(sources)) {
    assert.deepEqual(completion(guarded, source), completion(native, source), `${consumer} ${stage}`);
  }
});

test('typed input conversion is guarded without exposing element views to mappers',()=>{
  for(const Constructor of [Uint8Array,BigInt64Array])for(const mode of ['construct','from','mapped','set','of'])for(const iterable of [false,true])for(const fail of [false,true]){
    function run(guarded:boolean){
      const trace:unknown[]=[],converted:Function[]=[],invoked:Function[]=[];
      const elements=[0,1].map(index=>{
        const element=Object.freeze({[Symbol.toPrimitive](hint:string){
          trace.push(['convert',index,hint,this===element]);
          if(fail&&index===1)throw new RangeError('element');
          return Constructor===BigInt64Array?BigInt(index+7):index+7;
        }});
        converted.push(element[Symbol.toPrimitive]);return element;
      });
      const source:any={get length(){trace.push(['length',this===source]);return 2;},
        get 0(){trace.push(['get',0,this===source]);return elements[0];},
        get 1(){trace.push(['get',1,this===source]);return elements[1];}};
      if(iterable)source[Symbol.iterator]=function*(){trace.push(['iterator',this===source]);yield elements[1];yield elements[0];};
      Object.freeze(source);
      const op=createOperations({apply(fn,self,args){invoked.push(fn);return Reflect.apply(fn,self,args);}});
      const call=(fn:Function,self:unknown,args:unknown[])=>guarded?op.invoke(fn,self,args):Reflect.apply(fn,self,args);
      const target:any=new Constructor(3);
      let result,caught;
      try{
        if(mode==='construct')result=guarded?op.construct(Constructor,[source]):Reflect.construct(Constructor,[source]);
        else if(mode==='from'||mode==='mapped')result=call(Constructor.from,Constructor,mode==='from'?[source]:[source,(value:unknown,index:number)=>{
          trace.push(['map',index,elements.indexOf(value as any)]);return value;
        }]);
        else if(mode==='of')result=call(Constructor.of,Constructor,elements);
        else{call(target.set,target,[source,1]);result=target;}
        result=Array.from(result);
      }catch(error){caught=(error as Error).name;}
      if(guarded)for(const [index,fn]of converted.entries()){
        assert.equal(invoked.filter(item=>item===fn).length,trace.filter(item=>(item as any)[0]==='convert'&&(item as any)[1]===index).length);
      }
      return {trace,result,caught,target:Array.from(target)};
    }
    assert.deepEqual(run(true),run(false),Constructor.name+':'+mode+':'+iterable+':'+fail);
  }
});

test('typed set preserves overlapping storage and offset-before-source conversion',()=>{
  for(const offset of [-1,0,2,9]){
    function run(guarded:boolean){
      const trace:string[]=[],target=new Uint8Array([1,2,3,4]);
      const start={valueOf(){trace.push('offset');return offset;}};
      const source={get length(){trace.push('length');return 2;},get 0(){trace.push('first');return {valueOf(){trace.push('value');return 7;}};},1:8};
      let caught;
      try{if(guarded)createOperations().invoke(target.set,target,[source,start]);else Reflect.apply(target.set,target,[source,start]);}
      catch(error){caught=(error as Error).name;}
      return {trace,caught,target:Array.from(target)};
    }
    assert.deepEqual(run(true),run(false));
  }
  const target=new Uint8Array([1,2,3,4]);
  createOperations().invoke(target.set,target,[target.subarray(0,3),1]);
  assert.deepEqual(Array.from(target),[1,1,2,3]);
});

test('byte-view constructors guard offset and length without moving buffer validation',()=>{
  for(const Constructor of [Uint8Array,Uint16Array,DataView])for(const buffer of [new ArrayBuffer(16),{}])for(const offset of [0,2,-1,17]){
    function run(guarded:boolean){
      const trace:string[]=[],invoked:Function[]=[];
      const start={valueOf(){trace.push('offset');return offset;}},length={valueOf(){trace.push('length');return 2;}};
      const op=createOperations({apply(fn,self,args){invoked.push(fn);return Reflect.apply(fn,self,args);}});
      let result,caught;
      try{const view=guarded?op.construct(Constructor,[buffer,start,length]):Reflect.construct(Constructor,[buffer,start,length]);
        result=[view.byteOffset,view.byteLength,view.buffer===buffer];}
      catch(error){caught=(error as Error).name;}
      if(guarded){assert.equal(invoked.includes(start.valueOf),trace.includes('offset'));assert.equal(invoked.includes(length.valueOf),trace.includes('length'));}
      return {trace,result,caught};
    }
    assert.deepEqual(run(true),run(false),Constructor.name+':'+offset);
  }
});

test('iterable consumers budget every next call, including native next functions', () => {
  for (const {name, fn, self} of consumers) {
    let ticks=0, nextCalls=0;
    const operations=createOperations({tick(){ticks++;}});
    const iterable={ [Symbol.iterator](){return {next(){return nextCalls++<3
      ? {done:false,value:name==='Object.fromEntries' ? [nextCalls,7] : nextCalls} : {done:true};}};} };
    operations.invoke(fn,self,[iterable,()=>0]);
    assert.equal(ticks,name==='Object.groupBy'?5:4,name); assert.equal(nextCalls,4,name);
    let remaining=5;
    const exhausted=Error('budget');
    const limited=createOperations({tick(){if(--remaining===0)throw exhausted;}});
    const infinite={value:['key',7], next:Object.prototype.valueOf, [Symbol.iterator](){return this;}};
    assert.throws(()=>limited.invoke(fn,self,[infinite,()=>0]),error=>error===exhausted,name);
  }
  let ticks=0;
  createOperations({tick(){ticks++;}}).invoke(Array.from,Array,[{length:3}]);
  assert.equal(ticks,3,'Array.from array-like path');
});

test('iterable consumers preserve getter ordering, cached next, callback context and abrupt close', () => {
  for (const {name,fn,self} of consumers) for (const phase of ['ok','open','next-get','next','done','value','key','entry','coerce','callback']) {
    function run(controlled:boolean) {
      const trace:string[]=[], marker=Error('marker');let count=0;
      function visit(label:string){trace.push(label);if(label===phase)throw marker;}
      const entry={get 0(){visit('key');return {[Symbol.toPrimitive](hint:string){visit('coerce');trace.push(hint);return 'key';}};},
        get 1(){visit('entry');return 7;}};
      const iterable={get [Symbol.iterator](){trace.push('iterator-get');return function(){visit('open');return {
        get next(){visit('next-get');return function(){visit('next');return {get done(){visit('done');return count++>0;},
          get value(){visit('value');return name==='Object.fromEntries'?entry:7;}};};},
        get return(){trace.push('return-get');return function(){trace.push('return');throw Error('secondary');};}
      };};}};
      const receiver={};
      const callback=function(this:unknown,value:unknown,index:number){visit('callback');trace.push(String(this===receiver),String(index));
        return name==='Object.groupBy'?{[Symbol.toPrimitive](){visit('coerce');return 'key';}}:value;};
      let result:unknown, error:unknown;
      try {result=controlled?createOperations().invoke(fn,self,[iterable,callback,receiver]):Reflect.apply(fn,self,[iterable,callback,receiver]);}
      catch(caught){error=caught===marker?'marker':(caught as Error).constructor.name;}
      return {trace,result,error};
    }
    const actual=run(true), native=run(false);
    if (['next','done','value'].includes(phase)) {
      // IteratorStepValue failures propagate without IteratorClose. Current V8
      // fromEntries disagrees; the pinned Test262 iterator-not-closed-for-*
      // cases and AddEntriesFromIterable require this same rule for all four.
      const stages=['iterator-get','open','next-get','next','done','value'];
      assert.deepEqual(actual,{trace:stages.slice(0,stages.indexOf(phase)+1),result:undefined,error:'marker'},name+':'+phase);
      assert.equal(actual.error,native.error);
    } else assert.deepEqual(actual,native,name+':'+phase);
  }
});

test('Array.from preserves array-like coercion, missing values, mapping and mapper validation order', () => {
  for (const length of [undefined,-1,0,2.9,NaN]) for (const mapper of [undefined, null, (value:unknown,index:number)=>[value,index]]) {
    const run=(controlled:boolean)=>{
      const trace:string[]=[];
      const items={get [Symbol.iterator](){trace.push('iterator');return null;},
        get length(){trace.push('length');return {valueOf(){trace.push('number');return length;}};},
        get 0(){trace.push('zero');return 7;}};
      let result, error;
      try {result=controlled?createOperations().invoke(Array.from,Array,[items,mapper]):Array.from(items as any,mapper as any);}
      catch(caught){error=(caught as Error).constructor.name;}
      return {result,error,trace};
    };
    assert.deepEqual(run(true),run(false));
  }
  for (const items of ['a\u{1f600}',[1,,3],{length:2,0:'a'},null,undefined]) {
    let expected, actual, expectedError, actualError;
    try {expected=Array.from(items as any);}catch(error){expectedError=(error as Error).constructor.name;}
    try {actual=createOperations().invoke(Array.from,Array,[items]);}catch(error){actualError=(error as Error).constructor.name;}
    assert.deepEqual({actual,actualError},{actual:expected,actualError:expectedError});
  }
});

test('entry and grouping results retain symbol keys, prototypes, duplicate keys and collection equality', () => {
  const operations=createOperations(), symbol=Symbol('key'), object={};
  const entries=[['__proto__',7],[symbol,8],['duplicate',1],['duplicate',2]];
  assert.deepEqual(operations.invoke(Object.fromEntries,Object,[entries]),Object.fromEntries(entries));
  const items=[-0,+0,NaN,NaN,object,object,symbol,'__proto__'];
  for (const fn of [(Object as any).groupBy,(Map as any).groupBy]) {
    const callback=(value:unknown)=>value;
    assert.deepEqual(operations.invoke(fn,undefined,[items,callback]),fn(items,callback));
  }
});

test('native Promise combinators charge iteration and preserve rejection and close semantics', async () => {
  for (const method of ['all','allSettled','any','race'] as const) {
    let count=0, ticks=0;
    const operations=createOperations({tick(){ticks++;}});
    const iterable={[Symbol.iterator](){return {next(){return count++<3?{done:false,value:7}:{done:true};}};}};
    const result=await operations.invoke(Promise[method],Promise,[iterable]);
    assert.deepEqual(result,await Reflect.apply(Promise[method],Promise,[[7,7,7]]));
    assert.equal(ticks,7,method); // four iterator steps plus three then dispatches
    let remaining=5;
    const exhausted=Error('budget'), limited=createOperations({tick(){if(--remaining===0)throw exhausted;}});
    const infinite={value:7,next:Object.prototype.valueOf,[Symbol.iterator](){return this;}};
    await assert.rejects(limited.invoke(Promise[method],Promise,[infinite]),error=>error===exhausted);
    for (const phase of ['next','done','value','then']) {
      const run=async(controlled:boolean)=>{
        const trace:string[]=[], marker=Error('marker');
        const value=Promise.resolve(7);
        Object.defineProperty(value,'then',{get(){trace.push('then');throw marker;}});
        const input={[Symbol.iterator](){return {next(){trace.push('next');if(phase==='next')throw marker;return {
          get done(){trace.push('done');if(phase==='done')throw marker;return false;},
          get value(){trace.push('value');if(phase==='value')throw marker;return value;}};},
          return(){trace.push('close');throw Error('secondary');}};}};
        let caught;
        try {await (controlled?createOperations().invoke(Promise[method],Promise,[input]):Reflect.apply(Promise[method],Promise,[input]));}
        catch(error){caught=error===marker;}
        return {trace,caught};
      };
      assert.deepEqual(await run(true),await run(false),method+':'+phase);
    }
  }
});

test('AggregateError call and construction retain argument order, abrupt iteration and budget', () => {
  for (const call of [false,true]) {
    for (const phase of ['ok','message','cause','iterator','next-get','next','done','value']) {
      const run=(controlled:boolean)=>{
        const trace:string[]=[], marker=Error('marker'), shared={value:7};let count=0;
        const visit=(label:string)=>{trace.push(label);if(label===phase)throw marker;};
        const message={toString(){visit('message');return 'message';}};
        const options={get cause(){visit('cause');return shared;}};
        const iterable={get [Symbol.iterator](){visit('iterator');return function(){return {
          get next(){visit('next-get');return function(){visit('next');return {
            get done(){visit('done');return count++>=2;},get value(){visit('value');return shared;}};};},
          return(){trace.push('close');return {};}
        };};}};
        let result, caught;
        try {
          const operations=createOperations(), args=[iterable,message,options];
          const error=controlled?(call?operations.invoke(AggregateError,undefined,args):operations.construct(AggregateError,args))
            :(call?Reflect.apply(AggregateError,undefined,args):Reflect.construct(AggregateError,args));
          result=[error.message,error.cause===shared,error.errors.length,error.errors.every((item:unknown)=>item===shared),
            Object.getOwnPropertyDescriptor(error,'errors')!.enumerable,error instanceof AggregateError];
        }catch(error){caught=error===marker?'marker':(error as Error).constructor.name;}
        return {trace,result,caught};
      };
      assert.deepEqual(run(true),run(false),String(call)+':'+phase);
    }
    let ticks=0;
    const exhausted=Error('budget'), operations=createOperations({tick(){if(++ticks===5)throw exhausted;}});
    const iterable={next:Object.prototype.valueOf,value:7,[Symbol.iterator](){return this;}};
    assert.throws(()=>call?operations.invoke(AggregateError,undefined,[iterable]):operations.construct(AggregateError,[iterable]),error=>error===exhausted);
    assert.equal(ticks,5);
  }
});

test('argument-list conversion charges indexed reads and preserves native order', () => {
  for (const kind of ['apply','reflect-apply','construct']) {
    for (const phase of ['ok','length','coerce','index']) {
      const run=(guarded:boolean)=>{
        const trace:string[]=[], marker=Error('marker');let ticks=0;
        const visit=(name:string)=>{trace.push(name);if(name===phase)throw marker;};
        function target(...args:unknown[]){visit('target');return args;}
        const list={get length(){visit('length');return {valueOf(){visit('coerce');return 2;}};},
          get 0(){visit('index');return 7;},get 1(){visit('index');return 9;},
          get [Symbol.iterator](){throw Error('must not iterate');}};
        const op=createOperations({tick(){ticks++;}});
        let result,caught;
        try {result=kind==='apply'?(guarded?op.invoke(Function.prototype.apply,target,[null,list]):target.apply(null,list as any))
          :kind==='reflect-apply'?(guarded?op.invoke(Reflect.apply,Reflect,[target,null,list]):Reflect.apply(target,null,list as any))
          :(guarded?op.invoke(Reflect.construct,Reflect,[target,list]):Reflect.construct(target,list as any));}
        catch(error){caught=error===marker?'marker':(error as Error).name;}
        return {trace,result,caught,ticks};
      };
      const native=run(false), controlled=run(true);
      assert.deepEqual({...controlled,ticks:0},native,kind+':'+phase);
      if(phase==='ok')assert.equal(controlled.ticks,2);
    }
    let ticks=0;const marker=Error('budget');
    const op=createOperations({tick(){if(++ticks===5)throw marker;}}), list={length:Infinity};
    assert.throws(()=>kind==='apply'?op.invoke(Function.prototype.apply,Array,[null,list])
      :kind==='reflect-apply'?op.invoke(Reflect.apply,Reflect,[Array,null,list])
      :op.invoke(Reflect.construct,Reflect,[Array,list]),error=>error===marker);
    assert.equal(ticks,5);
  }
});

test('typed sequence consumers preserve iterator and array-like order and charge both paths', () => {
  for(const Constructor of [Uint8Array,Int8Array,Uint8ClampedArray,Uint16Array,Int16Array,
    Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array]){
    const bigint=Constructor===BigInt64Array||Constructor===BigUint64Array;
    for(const mode of ['from','construct'])for(const iterable of [false,true]){
      for(const phase of ['ok','iterator','length','length-coerce','index','next-get','next','done','value','convert','map']){
        const run=(guarded:boolean)=>{
          const trace:string[]=[],marker=Error('marker');let count=0,ticks=0;
          const visit=(name:string)=>{trace.push(name);if(name===phase)throw marker;};
          const item={valueOf(){visit('convert');return bigint?7n:7;}};
          const source={get [Symbol.iterator](){visit('iterator');return iterable?function(this:unknown){
            assert.equal(this,source);return {get next(){visit('next-get');return function(){visit('next');return {
              get done(){visit('done');return count++>=2;},get value(){visit('value');return item;}};};},
              return(){visit('close');return {};}};
          }:undefined;},get length(){visit('length');return {valueOf(){visit('length-coerce');return 2;}};},
          get 0(){visit('index');return item;},get 1(){visit('index');return item;}};
          const mapper=(value:unknown)=>{visit('map');assert.equal(value,item);return value;};
          const op=createOperations({tick(){ticks++;}});let result,caught;
          try{const args=mode==='from'?[source,mapper]:[source];
            result=Array.from(guarded?(mode==='from'?op.invoke(Constructor.from,Constructor,args):op.construct(Constructor,args))
              :(mode==='from'?Reflect.apply(Constructor.from,Constructor,args):Reflect.construct(Constructor,args)));}
          catch(error){caught=error===marker?'marker':(error as Error).name;}
          return {trace,result,caught,ticks};
        };
        const native=run(false), controlled=run(true);
        assert.deepEqual({...controlled,ticks:0},native,Constructor.name+':'+mode+':'+iterable+':'+phase);
        if(phase==='ok')assert.equal(controlled.ticks,(iterable?3:2)+(mode==='from'?2:0));
      }
      let ticks=0;const marker=Error('budget'),op=createOperations({tick(){if(++ticks===5)throw marker;}});
      const source=iterable?{next:Object.prototype.valueOf,value:bigint?7n:7,[Symbol.iterator](){return this;}}:Object.assign({length:100},Array(5).fill(bigint?7n:7));
      assert.throws(()=>mode==='from'?op.invoke(Constructor.from,Constructor,[source]):op.construct(Constructor,[source]),error=>error===marker);
      assert.equal(ticks,5);
    }
  }
});

test('typed constructors preserve primitive, buffer and typed-array input branches', () => {
  const op=createOperations();
  for(const value of [undefined,null,false,3,'3'])assert.deepEqual(op.construct(Uint8Array,[value]),new Uint8Array(value as any));
  for(const value of [undefined,null,false,3,'123']){
    const run=(guarded:boolean)=>{try{return Array.from(guarded?op.invoke(Uint8Array.from,Uint8Array,[value]):Uint8Array.from(value as any));}
      catch(error){return (error as Error).name;}};
    assert.deepEqual(run(true),run(false));
  }
  const buffer=new ArrayBuffer(8), view=op.construct(Uint8Array,[buffer,2,3]);
  assert.equal(view.buffer,buffer);assert.equal(view.byteOffset,2);assert.equal(view.length,3);
  const source=new Uint8Array([2,4]);
  Object.defineProperty(source,Symbol.iterator,{get(){throw Error('typed input must not iterate');}});
  assert.deepEqual(op.construct(Uint8Array,[source]),new Uint8Array([2,4]));
});

test('native iterable consumers report failures before reading an iterator or calling a callback',()=>{
  for(const entry of consumers.filter(item=>item.name!=='Array.from')){
    for(const value of [null,undefined]){
      const args=entry.name.endsWith('groupBy')?[value,()=>0]:[value];
      const outcome=(guarded:boolean)=>{try{
        if(guarded)createOperations().invoke(entry.fn,entry.self,args);
        else Reflect.apply(entry.fn,entry.self,args);
        return null;
      }catch(error){return [(error as Error).name,(error as Error).message];}};
      assert.deepEqual(outcome(true),outcome(false),entry.name+':'+String(value));
    }
    if(!entry.name.endsWith('groupBy'))continue;
    for(const callback of [null,0,undefined]){
      const run=(guarded:boolean)=>{
        let iteratorReads=0;
        const input={get [Symbol.iterator](){iteratorReads++;throw Error('iterator must not be read');}};
        let caught:unknown;
        try{if(guarded)createOperations().invoke(entry.fn,entry.self,[input,callback]);
          else Reflect.apply(entry.fn,entry.self,[input,callback]);}
        catch(error){caught=[(error as Error).name,(error as Error).message];}
        return {iteratorReads,caught};
      };
      assert.deepEqual(run(true),run(false),entry.name+':'+String(callback));
    }
  }
});
