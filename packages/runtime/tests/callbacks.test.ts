import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';

const traversals=[
  {name:'Array',method:Array.prototype.forEach,value:()=>[1,2,3]},
  {name:'TypedArray',method:Uint8Array.prototype.forEach,value:()=>new Uint8Array([1,2,3])},
  {name:'Map',method:Map.prototype.forEach,value:()=>new Map([[1,1],[2,2],[3,3]])},
  {name:'Set',method:Set.prototype.forEach,value:()=>new Set([1,2,3])}
];

test('sort and typed mapping coerce callback results through guarded dispatch without changing native order',()=>{
  for(const kind of ['array','uint','bigint'])for(const method of ['sort','toSorted','map','from'])for(const outcome of ['value','bigint','symbol','throw']){
    if(kind==='array'&&(method==='map'||method==='from'))continue;
    function run(guarded:boolean){
      const source:any=kind==='array'?[3,1,2]:kind==='uint'?new Uint8Array([3,1,2]):new BigInt64Array([3n,1n,2n]);
      const trace:unknown[]=[],invocations:Function[]=[],conversions:Function[]=[];
      const callback=function(this:unknown,a:any,b:any){
        trace.push(['callback',this===undefined,a,b]);
        const object=Object.freeze({[Symbol.toPrimitive](hint:string){
          trace.push(['convert',hint,this===object]);
          if(outcome==='throw')throw new RangeError('conversion');
          if(outcome==='symbol')return Symbol();
          if(outcome==='bigint')return 0n;
          return method==='sort'||method==='toSorted'?Number(a)-Number(b):kind==='bigint'?a+1n:a+1;
        }});
        conversions.push(object[Symbol.toPrimitive]);return object;
      };
      const constructor=kind==='bigint'?BigInt64Array:Uint8Array;
      const fn=method==='from'?constructor.from:source[method],self=method==='from'?constructor:source;
      const args=method==='from'?[source,callback]:[callback];
      const op=createOperations({apply(fn,self,args){invocations.push(fn);return Reflect.apply(fn,self,args);}});
      let result,caught;
      try{result=Array.from(guarded?op.invoke(fn,self,args):Reflect.apply(fn,self,args));}
      catch(error){caught=(error as Error).name;}
      if(guarded)for(const conversion of conversions)assert.ok(invocations.includes(conversion),kind+':'+method);
      return {result,caught,trace,source:Array.from(source)};
    }
    assert.deepEqual(run(true),run(false),kind+':'+method+':'+outcome);
  }
});
test('native callback dispatch charges each invocation for all collection traversals',()=>{
  for(const {name,method,value} of traversals){
    let ticks=0;
    const op=createOperations({tick(){ticks++;}});
    op.invoke(method,value(),[Math.abs]);
    assert.equal(ticks,name==='Array'?9:3,name);
    const marker=Error('budget');let calls=0;
    const limited=createOperations({tick(){if(++calls===2)throw marker;}});
    assert.throws(()=>limited.invoke(method,value(),[Math.abs]),error=>error===marker,name);
    assert.equal(calls,2,name);
  }
});

test('callback guards retain receiver, arguments, abrupt completion and native partial writes',()=>{
  for(const kind of ['map','reduce','sort','map-forEach','set-forEach','parse','stringify','replace']){
    const run=(guarded:boolean,fail:boolean)=>{
      const trace:unknown[]=[],marker=Error('marker'),receiver={id:7},array=[3,1,2];
      let result,caught;
      const callback=function(this:unknown,...args:any[]){
        trace.push([this===receiver,args.slice(0,2)]);
        if(fail&&trace.length===2)throw marker;
        if(kind==='sort')return args[0]-args[1];
        if(kind==='reduce')return args[0]+args[1];
        if(kind==='parse'||kind==='stringify')return args[1];
        return args[0];
      };
      const fn=kind==='map'?Array.prototype.map:kind==='reduce'?Array.prototype.reduce:kind==='sort'?Array.prototype.sort
        :kind==='map-forEach'?Map.prototype.forEach:kind==='set-forEach'?Set.prototype.forEach
        :kind==='parse'?JSON.parse:kind==='stringify'?JSON.stringify:String.prototype.replace;
      const self=kind==='map-forEach'?new Map([[1,2],[3,4]]):kind==='set-forEach'?new Set([1,2]):kind==='replace'?'aba':array;
      const args=kind==='parse'?['{"a":1,"b":2}',callback]:kind==='stringify'?[{a:1,b:2},callback]
        :kind==='replace'?[/a/g,callback]:[callback,kind==='reduce'?0:receiver];
      try{result=guarded?createOperations().invoke(fn,self,args):Reflect.apply(fn,self,args);}
      catch(error){caught=error===marker?'marker':(error as Error).name;}
      return {trace,result,caught,array};
    };
    for(const fail of [false,true])assert.deepEqual(run(true,fail),run(false,fail),kind+':'+fail);
  }
});
