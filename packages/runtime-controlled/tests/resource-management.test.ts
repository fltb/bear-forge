import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileJavaScript,compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

async function compare(body:string){
  const source=`async function run(_,io){'use strict';${body}}`;
  const reference=Function(`"use strict";return (${source});`)();
  const program=`{schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},run:${source}}`;
  const directory=await mkdtemp(join(tmpdir(),'bear-resources-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const entry=join(directory,'entry.mjs');await writeFile(entry,`export const program=${program};`);
    const nativeArtifact=await compileNativeEntry(entry);
    for(const artifact of [compileJavaScript(`export const program=${program};`),await compileEntry(entry)]){
      const parent=new ProgramExecution(decode(artifact.content));
      const owned=[parent];
      try{
        parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
        const fork=parent.fork(),restored=parent.fresh();owned.push(fork,restored);restored.restore(parent.snapshot());
        for(const [index,start]of [parent,fork,restored].entries()){
          const reply=index+2,expectedCalls:unknown[]=[],actualCalls:unknown[]=[];
          const expected=await reference(null,{call:async(call:unknown)=>{expectedCalls.push(call);return reply;}});
          const nativeCalls:unknown[]=[];
          const native=await (await nativeProgram(nativeArtifact)).run(null,{call:async(call:unknown)=>{nativeCalls.push(call);return reply;}} as any);
          assert.deepEqual(native,expected);assert.deepEqual(nativeCalls,expectedCalls);
          let instance=start,steps=0;
          while(instance.result.status===0){
            assert.ok(steps++<20,'Resource execution did not terminate');
            actualCalls.push(instance.io.callData);
            if(index&&steps>1){
              const next=index===1?instance.fork():instance.fresh();
              if(index===2)next.restore(instance.snapshot());
              owned.push(next);instance=next;
            }
            instance.resume(reply);
          }
          assert.equal(instance.result.status,1,String(instance.result.value));
          assert.deepEqual(instance.result.value,expected);assert.deepEqual(actualCalls,expectedCalls);
        }
      }finally{for(const instance of owned)instance.dispose();}
    }
  }finally{await rm(directory,{recursive:true,force:true});}
}

test('using caches disposal methods and releases in reverse order through return and finally',async()=>{
  await compare(`
    const trace=[];
    const resource={get [Symbol.dispose](){trace.push('get');return function(){trace.push(this===resource?'dispose':'bad receiver');};}};
    async function inner(){
      using first=resource;
      using second={ [Symbol.dispose](){trace.push('second');} };
      resource[Symbol.dispose];
      await io.call({port:'step',input:null});return 7;
    }
    let value;try{value=await inner();}finally{trace.push('finally');}
    return [value,trace];
  `);
});

test('await using can suspend inside cleanup with independent fork and persistent restore',async()=>{
  await compare(`
    const trace=[];let state=1;
    {
      await using first={async [Symbol.asyncDispose](){trace.push('first:start');state+=await io.call({port:'cleanup',input:state});trace.push('first:end');}};
      await using second={async [Symbol.asyncDispose](){trace.push('second');await 0;}};
      state+=await io.call({port:'body',input:state});
    }
    return [state,trace];
  `);
});

test('suppressed disposal errors retain identity, descriptors and nested causes across recovery',async()=>{
  await compare(`
    const first={id:'first'},second={id:'second'},body={id:'body'};let error;
    try{
      using a={ [Symbol.dispose](){throw first;} };
      using b={ [Symbol.dispose](){throw second;} };
      throw body;
    }catch(e){error=e;}
    await io.call({port:'error',input:null});
    const descriptor=Object.getOwnPropertyDescriptor(error,'error');
    return [error instanceof SuppressedError,error.error===first,error.suppressed instanceof SuppressedError,
      error.suppressed.error===second,error.suppressed.suppressed===body,
      descriptor.enumerable,descriptor.writable,descriptor.configurable];
  `);
});

test('per-iteration disposal runs on continue and break before iterator close',async()=>{
  await compare(`
    const trace=[];
    const values={*[Symbol.iterator](){try{for(let i=0;i<3;i++)yield {n:i,[Symbol.dispose](){trace.push('dispose:'+this.n);}};}finally{trace.push('close');}}};
    for(using value of values){
      trace.push('body:'+value.n);await io.call({port:'step',input:value.n});
      if(value.n===0)continue;break;
    }
    return trace;
  `);
});

test('await using handles null and sync fallback disposal without awaiting its return value',async()=>{
  await compare(`
    const trace=[];
    {
      await using empty=null;
      await using value={ [Symbol.dispose](){trace.push('dispose');return {then(){trace.push('wrong then');}};} };
      await io.call({port:'body',input:null});trace.push('body');
    }
    trace.push('after');return trace;
  `);
});

test('await using loop heads preserve asynchronous disposal and await before advancing',async()=>{
  await compare(`
    const trace=[];
    for(await using value of [1,2].map(n=>({n,async [Symbol.asyncDispose](){trace.push('dispose:'+n);await io.call({port:'cleanup',input:n});trace.push('done:'+n);}}))){
      trace.push('body:'+value.n);
    }
    return trace;
  `);
});

for(const asynchronous of [false,true])test(`module resource disposal completes before entry and retains lexical TDZ (async=${asynchronous})`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-resources-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const entry=join(directory,'entry.mjs');
    const source=`
      const trace=[];let before;
      try{before=value;}catch(e){before=e.name;}
      ${asynchronous?'await using':'using'} resource={${asynchronous?'async ':''}[Symbol.${asynchronous?'asyncDispose':'dispose'}](){${asynchronous?'await 0;':''}trace.push('disposed');}};
      let value=7;
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){await io.call({port:'step',input:null});return [before,value,trace];}};
    `;
    await writeFile(entry,source);
    const reference=(await import(pathToFileURL(entry).href)).program;
    const expected=await reference.run(null,{call:async()=>null});
    assert.deepEqual(await (await nativeProgram(await compileNativeEntry(entry))).run(null,{call:async()=>null} as any),expected);
    for(const artifact of [await compileEntry(entry),compileJavaScript(source)]){
    const parent=new ProgramExecution(decode(artifact.content)),owned=[parent];
    try{
      parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
      const fork=parent.fork(),restored=parent.fresh();owned.push(fork,restored);restored.restore(parent.snapshot());
      for(const instance of owned){instance.resume(null);assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);}
    }finally{for(const instance of owned)instance.dispose();}
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
