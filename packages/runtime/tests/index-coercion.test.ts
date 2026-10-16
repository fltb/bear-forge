import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../src/operations.ts';

test('ArrayBuffer allocation and slicing guard numeric inputs without changing native errors',()=>{
  for(const size of [8,-1,2n,Symbol('size')]){
    function run(guarded:boolean){
      const trace:string[]=[],seen:Function[]=[];
      const length={valueOf(){trace.push('length');return size;}},start={valueOf(){trace.push('start');return 2;}},end={valueOf(){trace.push('end');return 5;}};
      const op=createOperations({apply(fn,self,args){seen.push(fn);return Reflect.apply(fn,self,args);}});
      let result,caught;
      try{const buffer=guarded?op.construct(ArrayBuffer,[length]):Reflect.construct(ArrayBuffer,[length]);
        new Uint8Array(buffer).set([1,2,3,4,5]);
        const copy=guarded?op.invoke(ArrayBuffer.prototype.slice,buffer,[start,end]):Reflect.apply(ArrayBuffer.prototype.slice,buffer,[start,end]);
        result=Array.from(new Uint8Array(copy));}
      catch(error){caught=(error as Error).name;}
      if(guarded)assert.equal(seen.filter(fn=>fn===length.valueOf||fn===start.valueOf||fn===end.valueOf).length,trace.length);
      return {trace,result,caught};
    }
    assert.deepEqual(run(true),run(false));
  }
});

test('array index adapters preserve stored object identity and lazy native conversion order',()=>{
  const methods:[string,number[]][]=[['at',[0]],['copyWithin',[0,1,2]],['fill',[1,2]],
    ['includes',[1]],['indexOf',[1]],['lastIndexOf',[1]],['toSpliced',[0,1]],['with',[0]]];
  for(const [name,positions]of methods)for(const invalid of [false,true]){
    function run(guarded:boolean){
      const trace:unknown[]=[],invoked:Function[]=[],converters:Function[]=[],stored={valueOf(){throw Error('Stored value was coerced');}};
      const source:any[]=[stored,2,3];
      const args:any[]=name==='fill'?[stored,0,2]:name==='toSpliced'?[0,1,stored]:name==='with'?[1,stored]
        :['includes','indexOf','lastIndexOf'].includes(name)?[stored,0]:name==='copyWithin'?[0,1,2]:[1];
      for(const index of positions){const value=args[index];const object=Object.freeze({[Symbol.toPrimitive](hint:string){trace.push([index,hint,this===object]);if(invalid&&index===positions[0])throw new RangeError();return value;}});
        converters.push(object[Symbol.toPrimitive]);args[index]=object;}
      const op=createOperations({apply(fn,self,args){invoked.push(fn);return Reflect.apply(fn,self,args);}});
      let result,caught;
      try{result=guarded?op.invoke((Array.prototype as any)[name],source,args):Reflect.apply((Array.prototype as any)[name],source,args);}
      catch(error){caught=(error as Error).name;}
      if(guarded)assert.equal(invoked.filter(fn=>converters.includes(fn)).length,trace.length);
      const normalize=(value:any):any=>value===stored?'stored':Array.isArray(value)?value.map(normalize):value;
      return {trace,caught,result:normalize(result),source:normalize(source)};
    }
    assert.deepEqual(run(true),run(false),name+':'+invalid);
  }
});

test('typed indexes and DataView values use guarded conversions in native validation order',()=>{
  const cases:[string,number[]][]=[['at',[0]],['copyWithin',[0,1,2]],['fill',[0,1,2]],
    ['includes',[1]],['indexOf',[1]],['lastIndexOf',[1]],['join',[0]],['slice',[0,1]],['subarray',[0,1]],['with',[0,1]]];
  for(const [name,positions]of cases)for(const fail of [-1,...positions]){
    function run(guarded:boolean){
      const trace:unknown[]=[],seen:Function[]=[],conversions:Function[]=[],source=new Uint8Array([3,1,2]);
      const args:any[]=name==='fill'?[7,0,2]:name==='copyWithin'?[0,1,2]:name==='with'?[1,7]
        :name==='join'?[':']:name==='slice'||name==='subarray'?[0,2]:['includes','indexOf','lastIndexOf'].includes(name)?[1,0]:[1];
      for(const index of positions){const value=args[index];const object={valueOf(){trace.push(index);if(index===fail)throw new RangeError();return value;},toString(){return this.valueOf();}};
        conversions.push(object.valueOf,object.toString);args[index]=object;}
      const op=createOperations({apply(fn,self,args){seen.push(fn);return Reflect.apply(fn,self,args);}});
      let result,caught;
      try{result=guarded?op.invoke((source as any)[name],source,args):Reflect.apply((source as any)[name],source,args);if(ArrayBuffer.isView(result))result=Array.from(result as any);}
      catch(error){caught=(error as Error).name;}
      if(guarded)assert.equal(seen.filter(fn=>conversions.includes(fn)).length,trace.length);
      return {trace,result,caught,source:Array.from(source)};
    }
    assert.deepEqual(run(true),run(false),name+':'+fail);
  }
  for(const name of ['Int8','Int16','Int32','Uint8','Uint16','Uint32','Float32','Float64','BigInt64','BigUint64'])for(const offset of [0,99])for(const badReceiver of [false,true]){
    function run(guarded:boolean){
      const trace:string[]=[],seen:Function[]=[],buffer=new ArrayBuffer(16),view=badReceiver?{}:new DataView(buffer);
      const index={valueOf(){trace.push('index');return offset;}},value={valueOf(){trace.push('value');return name.startsWith('Big')?7n:7;}};
      const op=createOperations({apply(fn,self,args){seen.push(fn);return Reflect.apply(fn,self,args);}});
      let result,caught;
      try{const setter=(DataView.prototype as any)['set'+name],getter=(DataView.prototype as any)['get'+name];
        if(guarded){op.invoke(setter,view,[index,value,true]);result=op.invoke(getter,view,[index,true]);}
        else{Reflect.apply(setter,view,[index,value,true]);result=Reflect.apply(getter,view,[index,true]);}}
      catch(error){caught=(error as Error).name;}
      if(guarded)assert.equal(seen.filter(fn=>fn===index.valueOf||fn===value.valueOf).length,trace.length);
      return {trace,result,caught,bytes:Array.from(new Uint8Array(buffer))};
    }
    assert.deepEqual(run(true),run(false),name+':'+offset+':'+badReceiver);
  }
});
