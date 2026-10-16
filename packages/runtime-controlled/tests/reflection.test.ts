import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {compileJavaScript} from '@bear-forge/compiler';
import {ProgramExecution,decode} from '../src/execution.ts';

test('callable source identity survives lowering, implicit coercion, IO, fork and cold restoration',async()=>{
  async function program(_input:unknown,io:any){
    let value=1;
    function ordinary(x=1){ /* preserved author comment */ return value+x; }
    const arrow=(x=1)=>value+x;
    async function asynchronous(){return value;}
    function* generator(){yield value;}
    async function* asyncGenerator(){yield value;}
    const key='method',object={
      [key](x=1){return value+x;},
      get item(){return value;},
      set item(next){value=next;},
    };
    class Base { method(){return value;} static /* omitted prefix */ get item(){return value;} }
    class Child extends Base { constructor(){super();} method(){return super.method();} }
    class Default extends Base {}
    const getter=Object.getOwnPropertyDescriptor(object,'item')!;
    const functions=[ordinary,arrow,asynchronous,generator,asyncGenerator,object.method,getter.get!,getter.set!,
      Base,Base.prototype.method,Object.getOwnPropertyDescriptor(Base,'item')!.get!,Child,Child.prototype.method,Default,
      ordinary.bind(null),Promise,Promise.all,Promise.prototype.finally,
      Object.getOwnPropertyDescriptor(Promise,Symbol.species)!.get!,WeakMap,WeakSet.prototype.add];
    const reflect=()=>functions.map(fn=>{
      let compound='';compound+=fn;
      return [fn.toString(),Function.prototype.toString.call(fn),String(fn),[fn].join(''),''+fn,`${fn}`,compound];
    });
    // Request contains no reflected source; the snapshot must retain callable
    // identity without duplicating the Program's original source text.
    value=await io.call({port:'step',input:null});
    return {text:reflect(),value:ordinary(),same:object.item===value};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${program.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot();
  assert.equal(snapshot.includes('preserved author comment'),false);
  const fork=parent.fork(),restored=parent.fresh();
  restored.restore(snapshot);
  assert.equal(parent.loaded.statistics.initializations,1);
  for(const [index,instance]of[parent,fork,restored].entries()){
    const reply=index+4,expected=await program(null,{call:async()=>reply});
    instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,expected);
  }
  const child=execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`
    import {readFileSync} from 'node:fs';
    import {ProgramExecution} from ${JSON.stringify(new URL('../src/execution.ts',import.meta.url).href)};
    const {artifact,snapshot}=JSON.parse(readFileSync(0,'utf8'));
    const instance=new ProgramExecution(artifact);instance.restore(snapshot);instance.resume(9);
    process.stdout.write(JSON.stringify({result:instance.result,initializations:instance.loaded.statistics.initializations}));
  `],{input:JSON.stringify({artifact,snapshot}),encoding:'utf8'});
  const cold=JSON.parse(child);
  assert.equal(cold.initializations,0);
  assert.equal(cold.result.status,1,String(cold.result.value));
  assert.deepEqual(cold.result.value,await program(null,{call:async()=>9}));
});

test('native coercion-only inputs use original function text without retaining bridge objects across IO',async()=>{
  async function program(_input:unknown,io:any){
    let count=1;
    function source(){return count;}
    const descending=()=>2,ascending=()=>1;
    const trace:unknown[]=[];
    const flags={get [Symbol.toPrimitive](){trace.push('flags-get');return function(this:unknown,hint:string){trace.push([hint,this===flags]);return 'i';};}};
    const pattern={
      get [Symbol.match](){trace.push(['match',this===pattern]);return true;},
      get constructor(){trace.push(['constructor',this===pattern]);return Object;},
      get source(){trace.push(['source',this===pattern]);return source;},
      get flags(){trace.push(['flags',this===pattern]);return flags;},
    };
    Object.freeze(pattern);
    const box=new String(source),error=new Error(source as any,{cause:{count}});
    const regexp=new RegExp(pattern as any),direct=new RegExp(source as any);
    count=await io.call({port:'step',input:null});
    const missing={get [Symbol.toPrimitive](){throw Error('unneeded fill conversion');}};
    const shortcut={[Symbol.match]:true,constructor:RegExp};
    return {count,box:box.valueOf(),error:[error.message,(error.cause as any).count],regexp:[regexp.source,regexp.flags],direct:direct.source,trace,
      next:[new String(source).valueOf(),Error(source as any).message,
        new TypeError(source as any).message,new AggregateError([],source as any).message,
        ''.padStart(80,source as any),''.padEnd(80,source as any),'done'.padEnd(2,missing as any),
        RegExp(source as any).source,Object.is(RegExp(shortcut as any),shortcut),
        String.prototype.slice.call(source,0,80),String.prototype.toUpperCase.call(source),
        String.prototype.includes.call(source,'return'),Symbol(source as any).description,
        Error.prototype.toString.call({name:source,message:source}),RegExp.prototype.toString.call({source,flags:source}),
        /^function/.exec(source as any)?.[0],'x'.replace('x',()=>source as any),'xx'.replaceAll(/x/g,()=>source as any),
        [descending,ascending].sort().map(fn=>fn()),[descending,ascending].toSorted().map(fn=>fn()),
        String.raw({raw:[source as any,'']},source)]};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${program.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const restored=parent.fresh();restored.restore(parent.snapshot());
  for(const [index,instance]of[parent,parent.fork(),restored].entries()){
    const reply=index+5;instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,await program(null,{call:async()=>reply}));
  }
});

test('operator coercion, computed keys, property queries and string cursors retain source identity through IO',async()=>{
  async function program(_input:unknown,io:any){
    const key=()=>1,larger=()=>2;
    const value={count:1};
    const object:Record<string,{count:number}>={[key as any]:value};
    const text=String(key);
    const cursor=String.prototype[Symbol.iterator].call(key);
    const first=cursor.next().value;
    value.count=await io.call({port:'step',input:null});
    const lookup=Object.getOwnPropertyDescriptor(object,key as any)!.value;
    const before=[Object.keys(object),(key as any) in object,Object.hasOwn(object,key as any),
      object[text]===value,lookup===value,Object.prototype.hasOwnProperty.call(object,key as any),Reflect.has(object,key as any),
      (key as any)==text,(key as any)!=text,(key as any)<larger,(key as any)<=larger,(larger as any)>key,(larger as any)>=key,
      first+[...cursor].join(''),lookup.count];
    const removed=Reflect.deleteProperty(object,key as any);
    return {before,removed,keys:Object.keys(object)};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${program.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const restored=parent.fresh();restored.restore(parent.snapshot());
  for(const [index,instance]of[parent,parent.fork(),restored].entries()){
    const reply=index+5;instance.resume(reply);
    assert.equal(instance.result.status,1,String(instance.result.value));
    assert.deepEqual(instance.result.value,await program(null,{call:async()=>reply}));
  }
});

test('comparison waits for both operands while computed keys convert before a suspended property value',async()=>{
  async function program(_input:unknown,io:any){
    const trace:unknown[]=[];
    const left={get [Symbol.toPrimitive](){trace.push('left-get');return function(this:unknown,hint:string){trace.push(['left',hint,this===left]);return 5;};}};
    const comparison=(left as any)<(trace.push('right-evaluate'),await io.call({port:'compare',input:trace.slice()}));
    const key={get [Symbol.toPrimitive](){trace.push('key-get');return function(this:unknown,hint:string){trace.push(['key',hint,this===key]);return 'field';};}};
    const object={[key as any]:await io.call({port:'key',input:trace.slice()})};
    return {comparison,object,trace};
  }
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${program.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  const restored=parent.fresh();restored.restore(parent.snapshot());
  for(const [index,instance]of[parent,parent.fork(),restored].entries()){
    const firstReply=index+4,requests:any[]=[];
    await program(null,{call:async(request:any)=>{requests.push(request);return request.port==='compare'?firstReply:9;}});
    assert.deepEqual(instance.io.callData,requests[0]);
    instance.resume(firstReply);
    assert.equal(instance.result.status,0,String(instance.result.value));
    assert.deepEqual(instance.io.callData,requests[1]);
    const again=instance.fresh();again.restore(instance.snapshot());
    for(const [offset,branch]of[instance,instance.fork(),again].entries()){
      const secondReply=offset+9;branch.resume(secondReply);
      assert.equal(branch.result.status,1,String(branch.result.value));
      assert.deepEqual(branch.result.value,await program(null,{call:async(request:any)=>request.port==='compare'?firstReply:secondReply}));
    }
  }
});
