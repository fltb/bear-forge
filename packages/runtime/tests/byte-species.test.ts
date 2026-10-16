import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations,protectIntrinsics} from '../src/operations.ts';

for(const method of ['map','filter','slice','subarray','buffer-slice'] as const){
  test(`${method} species calls preserve native order, target identity and constructor dispatch`,()=>{
    for(const mode of ['normal','self','short','wrong','throw','null','getter-throw','change-constructor','nonextensible','null-prototype']){
      function run(guarded:boolean){
        const trace:unknown[]=[],dispatched:Function[]=[];
        const op=createOperations({construct(fn,args,target){dispatched.push(fn);return Reflect.construct(fn,args,target);}});
        const bytes=new Uint8Array([4,5,6]),backing=bytes.buffer,source:any=method==='buffer-slice'?backing:bytes;
        let allocated:any;
        function Species(...args:any[]){
          trace.push(['construct',new.target===Species,args.map(x=>x===backing?'source-buffer':x)]);
          if(mode==='throw')throw new RangeError('species');
          allocated=mode==='self'?source:mode==='wrong'?{}:method==='buffer-slice'
            ?new ArrayBuffer(mode==='short'?0:args[0]):mode==='short'?new Uint8Array(0):Reflect.construct(Uint8Array,args);
          return allocated;
        }
        const constructor={get [Symbol.species](){trace.push('species');return mode==='null'?null:Species;}};
        Object.defineProperty(source,'constructor',{configurable:true,get(){trace.push('constructor');if(mode==='getter-throw')throw new Error('getter');return constructor;}});
        if(mode==='nonextensible')Object.preventExtensions(source);
        if(mode==='null-prototype')Object.setPrototypeOf(source,null);
        const start={valueOf(){trace.push('start');if(mode==='change-constructor')Object.defineProperty(source,'constructor',{value:undefined});return 1;}};
        const callback=function(value:number,index:number,array:any){trace.push(['callback',value,index,array===source]);return method==='filter'?true:value+1;};
        const fn=method==='buffer-slice'?ArrayBuffer.prototype.slice:(Uint8Array.prototype as any)[method];
        const args=method==='map'||method==='filter'?[callback]:[start,3];
        let outcome:unknown;
        try{const result=guarded?op.invoke(fn,source,args):Reflect.apply(fn,source,args);outcome={bytes:[...new Uint8Array(method==='buffer-slice'?result:result.buffer,result.byteOffset??0,method==='buffer-slice'?result.byteLength:result.byteLength)],same:result===allocated,source:result===source};}
        catch(error){outcome={error:(error as Error).name};}
        if(guarded&&trace.some(x=>Array.isArray(x)&&x[0]==='construct'))assert.ok(dispatched.includes(Species));
        return {trace,outcome,source:[...new Uint8Array(backing)]};
      }
      assert.deepEqual(run(true),run(false),mode);
    }
  });
  test(`${method} cannot mutate a protected species result or its protected backing buffer`,()=>{
    for(const backingOnly of [false,true]){
      const source:any=method==='buffer-slice'?new ArrayBuffer(2):new Uint8Array([7,8]);
      const output:any=method==='buffer-slice'?new ArrayBuffer(2):new Uint8Array(2);
      protectIntrinsics(backingOnly&&method!=='buffer-slice'?output.buffer:output);
      source.constructor={[Symbol.species]:function(){return output;}};
      const fn=method==='buffer-slice'?ArrayBuffer.prototype.slice:(Uint8Array.prototype as any)[method];
      assert.throws(()=>createOperations().invoke(fn,source,method==='map'||method==='filter'?[()=>7]:[0]),/shared intrinsic/);
      assert.deepEqual([...new Uint8Array(method==='buffer-slice'?output:output.buffer)],[0,0]);
    }
  });
}

for(const method of ['from','of'] as const){
  test(`TypedArray.${method} uses guarded result construction while retaining native ordering`,()=>{
    for(const mode of ['iterable','array-like','wrong','short','throw','bigint','invalid-constructor']){
      function run(guarded:boolean){
        const trace:unknown[]=[],dispatch:Function[]=[];
        const op=createOperations({construct(fn,args,target){dispatch.push(fn);return Reflect.construct(fn,args,target);}});
        let allocated:any;
        function Factory(length:number){
          trace.push(['construct',length,new.target===Factory]);
          if(mode==='throw')throw new Error('factory');
          return allocated=mode==='wrong'?{}:mode==='short'?new Uint8Array(0):mode==='bigint'?new BigInt64Array(length):new Uint8Array(length);
        }
        const input={get length(){trace.push('length');return 2;},get 0(){trace.push('read0');return 7;},get 1(){trace.push('read1');return 8;},
          get [Symbol.iterator](){trace.push('iterator');return mode==='array-like'?undefined:function*(){trace.push('yield0');yield 7;trace.push('yield1');yield 8;};}};
        const value={valueOf(){trace.push('convert');return 9;}};
        const args=method==='from'?[input,(x:number,i:number)=>{trace.push(['map',x,i]);return x;}]:[value,8];
        const receiver=mode==='invalid-constructor'?(()=>null):Factory;
        let outcome:unknown;
        try{const result=guarded?op.invoke(Uint8Array[method],receiver,args):Reflect.apply(Uint8Array[method],receiver,args);outcome={values:[...result],same:result===allocated};}
        catch(error){outcome={error:(error as Error).name};}
        if(guarded&&trace.some(x=>Array.isArray(x)&&x[0]==='construct'))assert.ok(dispatch.includes(Factory));
        return {trace,outcome};
      }
      assert.deepEqual(run(true),run(false),mode);
    }
  });
  test(`TypedArray.${method} rejects protected output and backing-store aliases before writes`,()=>{
    for(const backingOnly of [false,true]){
      const output=new Uint8Array(2);protectIntrinsics(backingOnly?output.buffer:output);
      function Factory(){return output;}
      assert.throws(()=>createOperations().invoke(Uint8Array[method],Factory,method==='from'?[[7,8]]:[7,8]),/shared intrinsic/);
      assert.deepEqual([...output],[0,0]);
    }
  });
}

const byteWrites: {name:string; view:(buffer:ArrayBuffer)=>any; args:()=>any[]}[] = [
  ...['copyWithin','fill','reverse','set','sort'].map(name=>({name,
    view:(buffer:ArrayBuffer)=>new Uint8Array(buffer),
    args:()=>name==='copyWithin'?[0,1]:name==='fill'?[7]:name==='set'?[[7,8]]:[]})),
  ...['setBigInt64','setBigUint64','setFloat32','setFloat64','setInt8','setInt16','setInt32','setUint8','setUint16','setUint32']
    .map(name=>({name,view:(buffer:ArrayBuffer)=>new DataView(buffer),args:()=>[0,name.includes('Big')?7n:7]}))
];
for(const operation of byteWrites){
  test(`${operation.name} preserves ordinary byte writes and rejects protected receivers or backing storage`,()=>{
    function initial(){return Uint8Array.from([4,3,2,1,8,7,6,5]).buffer;}
    const nativeBuffer=initial(),guardedBuffer=initial();
    const native=operation.view(nativeBuffer),guarded=operation.view(guardedBuffer);
    const expected=Reflect.apply(native[operation.name],native,operation.args());
    const actual=createOperations().invoke(guarded[operation.name],guarded,operation.args());
    assert.deepEqual(new Uint8Array(guardedBuffer),new Uint8Array(nativeBuffer));
    assert.equal(actual===guarded,expected===native);
    if(expected!==native)assert.equal(actual,expected);
    for(const protect of ['receiver','buffer']){
      const buffer=initial(),view=operation.view(buffer),before=new Uint8Array(buffer).slice();
      protectIntrinsics(protect==='receiver'?view:buffer);
      assert.throws(()=>createOperations().invoke(view[operation.name],view,operation.args()),/Cannot mutate a shared intrinsic/);
      assert.deepEqual(new Uint8Array(buffer),before);
    }
  });
}
