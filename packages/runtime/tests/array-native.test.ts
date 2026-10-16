import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';

const names=['at','concat','flatMap','copyWithin','every','fill','filter','find','findIndex','findLast','findLastIndex',
  'forEach','includes','indexOf','lastIndexOf','map','pop','push','reduce','reduceRight',
  'reverse','shift','some','sort','toReversed','toSorted','toSpliced','unshift','with'];
const callbacks=new Set(['flatMap','every','filter','find','findIndex','findLast','findLastIndex','forEach','map','some']);

test('array species admission waits until native callback validation',()=>{
  for(const name of ['map','filter','flatMap'] as const){
    const run=(guarded:boolean)=>{
      const trace:string[]=[],source=[1,2];
      Object.defineProperty(source,'constructor',{get(){trace.push('constructor');return Array;}});
      let error:unknown;
      try{
        if(guarded)createOperations().invoke(Array.prototype[name],source,[undefined]);
        else Reflect.apply(Array.prototype[name],source,[undefined]);
      }catch(caught){error=[(caught as Error).name,(caught as Error).message];}
      return {error,trace};
    };
    assert.deepEqual(run(true),run(false),name);
    const source=[1,2],trace:string[]=[];
    Object.defineProperty(source,'constructor',{get(){trace.push('constructor');return Array;}});
    assert.throws(()=>createOperations().invoke(Array.prototype[name],source,[(value:number)=>value]),
      /custom constructor accessor/,name);
    assert.deepEqual(trace,[],name);
  }
});

test('native array views retain getter receivers, callback source identity, holes and partial mutations',()=>{
  for(const name of names)for(const shape of ['array','object','frozen'])for(const abrupt of [false,true]){
    const run=(guarded:boolean)=>{
      const trace:unknown[]=[],marker=Error('marker'),tag={};let backing=3,calls=0;
      const source:any=shape==='object'?Object.assign(Object.create({1:5}),{length:5,4:8}):[3,,1,,8];
      Object.defineProperty(source,'0',{enumerable:true,configurable:true,
        get(){trace.push(['get',this===source]);return backing;},
        set(value){trace.push(['set',this===source,value]);backing=value;}});
      if(shape==='frozen')Object.freeze(source);
      const callback=function(this:unknown,...args:any[]){
        if(callbacks.has(name))trace.push(['callback',this===tag,args[0],args[1],args[2]===source]);
        else if(name==='reduce'||name==='reduceRight')trace.push(['reduce',args[0],args[1],args[2],args[3]===source]);
        else trace.push(['compare',...args]);
        if(abrupt&&++calls===2)throw marker;
        if(name==='sort'||name==='toSorted')return args[0]-args[1];
        if(name==='reduce'||name==='reduceRight')return args[0]+args[1];
        if(name==='flatMap')return [args[0],,args[0]];
        return name==='every'?true:name==='some'?false:args[0];
      };
      const args=callbacks.has(name)?[callback,tag]:name==='reduce'||name==='reduceRight'?[callback,0]
        :name==='sort'||name==='toSorted'?[callback]:name==='copyWithin'?[0,2]:name==='fill'?[7,1,4]
        :name==='with'?[1,7]:name==='toSpliced'?[1,2,7]:['at','includes','indexOf','lastIndexOf'].includes(name)?[1]
        :name==='push'||name==='unshift'?[7,9]:[];
      let result,caught;
      try{result=guarded?createOperations().invoke((Array.prototype as any)[name],source,args)
        :Reflect.apply((Array.prototype as any)[name],source,args);if(result===source)result='source';}
      catch(error){caught=error===marker?'marker':(error as Error).name;}
      const properties=Reflect.ownKeys(source).map(key=>{const d=Object.getOwnPropertyDescriptor(source,key)!;
        return [key,d.enumerable,d.configurable,'value'in d?['data',d.value,d.writable]:['accessor',Boolean(d.get),Boolean(d.set)]];});
      return {trace,result,caught,properties,backing};
    };
    assert.deepEqual(run(true),run(false),name+':'+shape+':'+abrupt);
  }
});

test('sparse native traversal charges empty positions without relying on callback execution',()=>{
  for(const name of ['forEach','every','some','map','reduce','reduceRight','includes','indexOf','lastIndexOf','fill','reverse','copyWithin','shift','sort','toSorted','toReversed','toSpliced','unshift']){
    let ticks=0;const marker=Error('budget'),op=createOperations({tick(){if(++ticks===5)throw marker;}});
    const source={length:30};
    const args=callbacks.has(name)?[Math.abs]:name==='reduce'||name==='reduceRight'?[Math.max,0]
      :name==='copyWithin'?[0,1]:name==='sort'||name==='toSorted'?[]:name==='toSpliced'?[0,1]:[7];
    assert.throws(()=>op.invoke((Array.prototype as any)[name],source,args),error=>error===marker,name);
    assert.equal(ticks,5,name);
  }
});

test('native array views never escape through callback results or receiver-returning methods',()=>{
  const op=createOperations(),source:any[]=[1,2];
  const mapped=op.invoke(Array.prototype.map,source,[(value:unknown,index:number,array:unknown)=>array]);
  assert.equal(mapped[0],source);assert.equal(mapped[1],source);
  for(const method of [Array.prototype.fill,Array.prototype.reverse,Array.prototype.copyWithin,Array.prototype.sort]){
    assert.equal(op.invoke(method,source,method===Array.prototype.fill?[1]:method===Array.prototype.copyWithin?[0,1]:[]),source);
  }
  let boxed:unknown;
  const chars=op.invoke(Array.prototype.map,'ab',[(value:string,index:number,array:unknown)=>{boxed??=array;assert.equal(array,boxed);return value;}]);
  assert.deepEqual(chars,['a','b']);assert.equal((boxed as any).valueOf(),'ab');
});

test('concat and flatMap guard nested traversals without leaking views or changing element identity',()=>{
  const op=createOperations(),source:any[]=[1,,3],plain={x:7};
  const spread={0:source,2:plain,length:3,[Symbol.isConcatSpreadable]:true};
  const concat=op.invoke(Array.prototype.concat,source,[spread,plain]);
  assert.deepEqual(concat,source.concat(spread as any,plain as any));
  assert.equal(concat[3],source);assert.equal(concat[5],plain);assert.equal(concat[6],plain);
  assert.equal(op.invoke(Array.prototype.concat,plain,[])[0],plain);
  const hidden=[plain];
  const flat=op.invoke(Array.prototype.flatMap,source,[()=>[hidden]]);
  assert.equal(flat[0],hidden);assert.equal(flat[1],hidden);
  for(const method of [Array.prototype.concat,Array.prototype.flatMap]){
    let ticks=0;const marker=Error('budget'),limited=createOperations({tick(){if(++ticks===8)throw marker;}});
    const args=method===Array.prototype.concat?[{length:30,[Symbol.isConcatSpreadable]:true}]:[()=>Array(30)];
    assert.throws(()=>limited.invoke(method,[1],args),error=>error===marker);
    assert.equal(ticks,8);
  }
});

test('array-like length conversion is guarded once even for frozen data properties',()=>{
  for(const name of names)for(const shape of ['data','accessor','frozen'])for(const scalar of [3,0,-1,NaN,2n,Symbol('length')]){
    function run(guarded:boolean){
      const trace:unknown[]=[],invoked:Function[]=[];
      const length=Object.freeze({[Symbol.toPrimitive](hint:string){trace.push(['length',hint,this===length]);return scalar;}});
      const source:any={0:7,2:9};
      Object.defineProperty(source,'length',shape==='accessor'
        ?{configurable:true,get(){trace.push(['get',this===source]);return length;},set(value){trace.push(['set',value,this===source]);}}
        :{value:length,writable:shape!=='frozen',configurable:shape!=='frozen'});
      if(shape==='frozen')Object.freeze(source);
      if(name==='concat'&&shape!=='frozen')source[Symbol.isConcatSpreadable]=true;
      const callback=(value:any,index:number,array:unknown)=>{trace.push(['callback',array===source]);return name==='flatMap'?[value]:value;};
      const args=callbacks.has(name)?[callback]:name==='reduce'||name==='reduceRight'?[(sum:number,value:number)=>sum+value,0]
        :name==='sort'||name==='toSorted'?[]:name==='copyWithin'?[0,1]:name==='fill'?[4,1]
        :name==='with'?[1,8]:name==='toSpliced'?[0,1,8]:name==='push'||name==='unshift'?[8]
        :['at','includes','indexOf','lastIndexOf'].includes(name)?[0]:[];
      const op=createOperations({apply(fn,self,args){invoked.push(fn);return Reflect.apply(fn,self,args);}});
      let result,caught;
      try{result=guarded?op.invoke((Array.prototype as any)[name],source,args):Reflect.apply((Array.prototype as any)[name],source,args);
        if(result===source)result='source';
        if(name==='concat'&&Array.isArray(result))result=result.map(value=>value===source?'source':value);
      }catch(error){caught=(error as Error).name;}
      if(guarded)assert.equal(invoked.filter(fn=>fn===length[Symbol.toPrimitive]).length,trace.filter(item=>(item as any)[0]==='length').length,name);
      const fields=Object.getOwnPropertyDescriptors(source);
      return {trace,result,caught,indices:[fields[0]?.value,fields[1]?.value,fields[2]?.value,fields[3]?.value],
        length:'value' in fields.length!?(fields.length!.value===length?'original':fields.length!.value):'accessor'};
    }
    assert.deepEqual(run(true),run(false),name+':'+shape+':'+String(scalar));
  }
});
