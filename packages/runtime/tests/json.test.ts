import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';

function outcome(run:()=>unknown){try{return {value:run()};}catch(error){return {error:(error as Error).name};}}
test('JSON.parse charges input text even when its result is small or parsing fails',()=>{
  for(const source of [' '.repeat(409600)+'null',' '.repeat(409600)+'?']){
    let ticks=0;const marker=Error('budget');
    const limited=createOperations({tick(){if(++ticks===100)throw marker;}});
    assert.throws(()=>limited.invoke(JSON.parse,JSON,[source]),error=>error===marker);
    assert.equal(ticks,100);
  }
});
test('JSON.stringify charges every inspected own key even when output omits it',()=>{
  const hidden={};
  for(let index=0;index<4096;index++)Object.defineProperty(hidden,'k'+index,{value:index});
  assert.equal(JSON.stringify(hidden),'{}');
  let ticks=0;const marker=Error('budget');
  const limited=createOperations({tick(){if(++ticks===64)throw marker;}});
  assert.throws(()=>limited.invoke(JSON.stringify,JSON,[hidden]),error=>error===marker);
  assert.equal(ticks,64);
});
test('JSON.stringify keeps one ownKeys trap and V8 descriptor order',()=>{
  function run(guarded:boolean){
    const trace:string[]=[],symbol=Symbol('ignored');
    const value=new Proxy({a:1,b:2}, {
      ownKeys(){trace.push('ownKeys');return ['a',symbol,'b'];},
      getOwnPropertyDescriptor(target,key){trace.push('descriptor:'+String(key));return Reflect.getOwnPropertyDescriptor(target,key);},
      get(target,key,receiver){trace.push('get:'+String(key));return Reflect.get(target,key,receiver);},
    });
    return {result:guarded?createOperations().invoke(JSON.stringify,JSON,[value]):JSON.stringify(value),trace};
  }
  assert.deepEqual(run(true),run(false));
});
test('JSON.parse reviver charges hidden keys in an author replacement object',()=>{
  const hidden={};
  for(let index=0;index<4096;index++)Object.defineProperty(hidden,'k'+index,{value:index});
  let ticks=0;const marker=Error('budget');
  const limited=createOperations({tick(){if(++ticks===64)throw marker;}});
  assert.throws(()=>limited.invoke(JSON.parse,JSON,['{"a":1,"b":{}}',function(this:any,key:string,value:any){
    if(key==='a')this.b=hidden;
    return value;
  }]),error=>error===marker);
  assert.equal(ticks,64);
});
test('JSON BigInt failure uses V8 diagnostic text after guarded conversion',()=>{
  for(const value of [2n,{value:2n},[2n],{toJSON(){return 2n;}},Object(2n)]){
    const error=(run:()=>unknown)=>{try{run();return null;}catch(caught){return [(caught as Error).name,(caught as Error).message];}};
    assert.deepEqual(error(()=>createOperations().invoke(JSON.stringify,JSON,[value])),
      error(()=>JSON.stringify(value)));
  }
});
test('JSON circular diagnostics retain the native V8 path without repeating author hooks',()=>{
  const cases: (()=>any)[] = [
    ()=>{const value:any={};value.self=value;return value;},
    ()=>{const value:any={child:{}};value.child.back=value;return value;},
    ()=>{const value:any=[];value[0]=value;return value;},
    ()=>{const value:any={a:{b:{}}};value.a.b.back=value.a;return value;},
    ()=>{const value:any=new (class Named {})();value.self=value;return value;},
    ()=>{const value:any={};value.toJSON=value;return value;},
    ()=>{const value:any={a:{b:{c:{d:{e:{f:{}}}}}}};value.a.b.c.d.e.f.back=value;return value;},
  ];
  for(const make of cases){
    const value=make();
    const error=(run:()=>unknown)=>{try{run();return null;}catch(caught){return [(caught as Error).name,(caught as Error).message];}};
    assert.deepEqual(error(()=>createOperations().invoke(JSON.stringify,JSON,[value])),error(()=>JSON.stringify(value)));
  }
  let reads=0;
  const value:any={};
  Object.defineProperty(value,'self',{enumerable:true,get(){reads++;return value;}});
  assert.throws(()=>createOperations().invoke(JSON.stringify,JSON,[value]),TypeError);
  assert.equal(reads,1);
});
test('guarded JSON serialization retains scalar formatting, boxed values, indentation and cycles',()=>{
  const cycle:any={};cycle.self=cycle;
  const shared={value:7};
  const values=[undefined,null,true,false,-0,NaN,Infinity,1e30,'\ud800\n"\\',2n,Object(2n),
    new Number(7),new String('abc'),new Boolean(false),Object(Symbol('x')),()=>1,
    [1,,undefined,()=>1,Symbol('x'),null],{a:undefined,b:Symbol(),c:()=>1,d:7},
    {a:shared,b:shared},cycle,new Uint8Array([1,2]),new Map([[1,2]])];
  for(const value of values)for(const space of [undefined,0,2,20,NaN,Infinity,'..........more',new Number(2),new String('--')]){
    assert.deepEqual(outcome(()=>createOperations().invoke(JSON.stringify,JSON,[value,undefined,space])),
      outcome(()=>JSON.stringify(value,undefined,space as any)));
  }
});

test('JSON toJSON/getter/replacer order preserves holders, mutations, aliases and abrupt completion',()=>{
  for(const mode of ['normal','delete','throw-getter','throw-toJSON','throw-replacer','root-holder','cycle']){
    function run(guarded:boolean){
      const trace:unknown[]=[],called:Function[]=[],source:any={};
      let rootHolder:unknown;
      const child={toJSON(key:string){trace.push(['toJSON',key,this===child]);if(mode==='throw-toJSON')throw new RangeError();return {n:2};}};
      Object.defineProperty(source,'first',{enumerable:true,get(){trace.push(['get',this===source]);if(mode==='throw-getter')throw new RangeError();if(mode==='delete')delete source.second;return child;}});
      source.second=7;source.array=[undefined,child];
      function replacer(this:any,key:string,value:unknown){
        trace.push(['replace',key,key===''?this['']===source:this===source]);
        if(key==='')rootHolder=this;
        if(key==='first'&&mode==='throw-replacer')throw new RangeError();
        if(key==='first'&&mode==='root-holder')return rootHolder;
        if(key==='first'&&mode==='cycle')return source;
        return value;
      }
      const op=createOperations({apply(fn,self,args){called.push(fn);return Reflect.apply(fn,self,args);}});
      const result=outcome(()=>guarded?op.invoke(JSON.stringify,JSON,[source,replacer,2]):JSON.stringify(source,replacer,2));
      if(guarded){
        assert.ok(called.includes(replacer));
        assert.equal(called.includes(child.toJSON),trace.some(item=>(item as any)[0]==='toJSON'));
      }
      return {trace,result,rootAlias:(rootHolder as any)?.['']===source};
    }
    assert.deepEqual(run(true),run(false),mode);
  }
});

test('JSON property lists and spacing keep boxed conversion order and inherited/nonenumerable properties',()=>{
  for(const fail of [false,true]){
    function run(guarded:boolean){
      const trace:unknown[]=[],source=Object.create({inherited:8});
      Object.defineProperty(source,'hidden',{value:9});source.a=7;source.nested={a:1,hidden:2};
      const key=new String('ignored');key.toString=()=>{trace.push('key');if(fail)throw new RangeError();return 'hidden';};
      const list:any=['nested','a',key,'a','inherited',true,{},Symbol()];
      Object.defineProperty(list,'0',{get(){trace.push('list');return 'nested';}});
      const space=new Number(2);space.valueOf=()=>{trace.push('space');return 2;};
      const result=outcome(()=>guarded?createOperations().invoke(JSON.stringify,JSON,[source,list,space]):JSON.stringify(source,list,space as any));
      return {trace,result};
    }
    assert.deepEqual(run(true),run(false));
  }
  const marker=Error('budget');let ticks=0;
  const op=createOperations({tick(){if(++ticks===5)throw marker;}});
  assert.throws(()=>op.invoke(JSON.stringify,JSON,[Array(100)]),error=>error===marker);
  const forbidden={toJSON:Object.keys.bind(Object)};
  assert.throws(()=>createOperations().invoke(JSON.stringify,JSON,[forbidden]),/not whitelisted/);
});

test('JSON reviver traversal preserves source records, mutations, holders and failed property updates',()=>{
  for(const mode of ['ordinary','replace','move','zero','delete','freeze','freeze-define','array','accessor','function','throw']){
    function run(guarded:boolean){
      const trace:unknown[]=[],contexts:object[]=[],calls:Function[]=[];
      let root:any;
      const source='{"a":0,"b":{"x":1e2},"c":{"x":1e2},"z":-0,"list":[1,2],"dup":0,"dup":3}';
      function reviver(this:any,key:string,value:any,context?:any){
        contexts.push(context);
        trace.push([key,value,context,arguments.length]);
        if(key==='a'){
          if(mode==='replace')this.b={x:100};
          if(mode==='move')this.b=this.c;
          if(mode==='zero')this.z=0;
          if(mode==='delete')delete this.b;
          if(mode==='freeze'||mode==='freeze-define')Object.freeze(this.b);
          if(mode==='array')this.list=[3,4];
          if(mode==='accessor')Object.defineProperty(this,'b',{enumerable:true,configurable:true,get(){trace.push('get-b');return {x:9};}});
          if(mode==='function')this.b=Object.assign(function(){},{x:5});
          if(mode==='throw')throw new RangeError('reviver');
        }
        if(mode==='freeze'&&key==='x')return undefined;
        if(mode==='freeze-define'&&key==='x')return 42;
        if(mode==='array'&&key==='0'){this.push(5);delete this[1];}
        if(key==='')root=this;
        return value;
      }
      const op=createOperations({apply(fn,self,args){calls.push(fn);return Reflect.apply(fn,self,args);}});
      const result=outcome(()=>guarded?op.invoke(JSON.parse,JSON,[source,reviver]):JSON.parse(source,reviver));
      if(guarded)assert.ok(calls.includes(reviver));
      // Function identity is local to each run; the observable data/trace remains comparable.
      const normalize=(v:any):any=>typeof v==='function'?{callable:true,...v}:v;
      return {trace:JSON.stringify(trace,(_key,v)=>normalize(v)),result:JSON.stringify(result,(_key,v)=>normalize(v)),
        rootAlias:root?.['']===(result as any).value,uniqueContexts:new Set(contexts).size===contexts.length};
    }
    assert.deepEqual(run(true),run(false),mode);
  }
});

test('JSON reviver writes cannot mutate shared intrinsics and traversal consumes budget',()=>{
  const shared=Array.prototype[Symbol.unscopables],before=Object.getOwnPropertyDescriptors(shared);
  const op=createOperations();
  try{
    assert.throws(()=>op.invoke(JSON.parse,JSON,['{"a":0,"b":0}',function(this:any,key:string,value:any){
      if(key==='a')op.set(op.ref(this,'b'),shared);
      return key==='at'?false:value;
    }]),/shared intrinsic/);
    assert.deepEqual(Object.getOwnPropertyDescriptors(shared),before);
  }finally{Object.defineProperties(shared,before);}
  let ticks=0;const marker=Error('budget');
  assert.throws(()=>createOperations({tick(){if(++ticks===5)throw marker;}})
    .invoke(JSON.parse,JSON,['[1,2,3,4,5]',(_key:string,value:any)=>value]),error=>error===marker);
  for(const source of ['{','null','[1,2]','"x"','-0','1e400'])for(const reviver of [undefined,null,2]){
    assert.deepEqual(outcome(()=>op.invoke(JSON.parse,JSON,[source,reviver])),outcome(()=>JSON.parse(source,reviver as any)));
  }
});
