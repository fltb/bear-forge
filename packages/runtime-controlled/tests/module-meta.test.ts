import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry,compileJavaScript,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

for(const asynchronous of [false,true])test(`module metadata retains cyclic identity and independent branch mutations (async=${asynchronous})`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-meta-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    await writeFile(join(directory,'state.mjs'),'export const trace=[];');
    await writeFile(join(directory,'a.mjs'),`
      import {early} from './b.mjs';import {trace} from './state.mjs';
      const Object=17;
      export function meta(){return import.meta;}
      export const captured=meta();export {early};export const shadow=Object;
      trace.push('a:start');${asynchronous?'await 0;':''}trace.push('a:end');
    `);
    await writeFile(join(directory,'b.mjs'),`import {meta} from './a.mjs';import {trace} from './state.mjs';export const early=meta();trace.push('b');`);
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`
      import {meta,captured,early,shadow} from './a.mjs';import {trace} from './state.mjs';
      const own=import.meta;
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){
        const other=meta();other.counter=0;own.counter=10;
        Object.defineProperty(other,'alias',{get(){return this.counter;},configurable:true});
        const reply=await io.call({port:'step',input:[other===captured,other===early,other!==own]});
        other.counter+=reply;own.counter+=reply;
        const descriptor=Object.getOwnPropertyDescriptor(own,'url');
        return [other===meta(),other===captured,other===early,other!==own,
          Object.getPrototypeOf(own)===null,Object.isExtensible(own),own.url,other.url,
          other.counter,other.alias,own.counter,shadow,meta.toString(),
          descriptor.writable,descriptor.enumerable,descriptor.configurable,trace];
      }};
    `);
    const reference=(await import(pathToFileURL(entry).href)).program;
    const artifact=await compileEntry(entry);
    const nativeArtifact=await compileNativeEntry(entry);
    const parent=new ProgramExecution(decode(artifact.content)),owned=[parent];
    try{
      parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
      assert.deepEqual(parent.io.callData,{port:'step',input:[true,true,true]});
      const branch=parent.fork(),restored=parent.fresh();owned.push(branch,restored);restored.restore(parent.snapshot());
      for(const [i,instance]of owned.entries()){
        const expected=await reference.run(null,{call:async()=>i+2});
        if(nativeArtifact)assert.deepEqual(await (await nativeProgram(nativeArtifact)).run(null,{call:async()=>i+2} as any),expected);
        instance.resume(i+2);assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);
      }
    }finally{for(const instance of owned)instance.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('direct compilation gives its single module a stable metadata object',()=>{
  const parent=new ProgramExecution(decode(compileJavaScript(`
    const metadata=import.meta;
    export const program={schemas:{},async run(_,io){
      metadata.value=1;metadata.value+=await io.call({port:'step',input:null});
      return [metadata===import.meta,Object.getPrototypeOf(metadata)===null,metadata.url,import.meta.value];
    }};
  `).content)),owned=[parent];
  try{
    parent.start(null);const branch=parent.fork(),restored=parent.fresh();owned.push(branch,restored);restored.restore(parent.snapshot());
    for(const [i,instance]of owned.entries()){
      instance.resume(i+2);assert.equal(instance.result.status,1,String(instance.result.value));
      assert.deepEqual(instance.result.value,[true,true,'bear-forge:program',i+3]);
    }
  }finally{for(const instance of owned)instance.dispose();}
});

test('host-provided import metadata rejects through aliases and keeps local overrides across branches',async()=>{
  const source=`
    const metadata=import.meta;
    export const program={schemas:{setup:{parse:value=>value},result:{parse:value=>value},ports:{}},async run(_,io){
      const keys=['dirname','filename','main','resolve'];
      const rejected=keys.map(key=>{
        try{return Reflect.get(metadata,key);}catch(error){return error.message;}
      });
      metadata.resolve=value=>'local:'+value;
      metadata.dirname='local-directory';
      await io.call({port:'step',input:rejected});
      return [rejected,Object.keys(metadata),metadata.resolve('value'),metadata.dirname,
        keys.slice(1,3).map(key=>{try{return metadata[key];}catch(error){return error.name;}})];
    }};
  `;
  const parent=new ProgramExecution(decode(compileJavaScript(source).content)),owned=[parent];
  const rejected=['dirname','filename','main','resolve'].map(key=>'Undeclared host metadata import.meta.'+key);
  try{
    parent.start(null);
    assert.equal(parent.result.status,0,String(parent.result.value));
    assert.deepEqual(parent.io.callData.input,rejected);
    const branch=parent.fork(),restored=parent.fresh();owned.push(branch,restored);
    restored.restore(parent.snapshot());
    for(const instance of owned){
      instance.resume(null);
      assert.equal(instance.result.status,1,String(instance.result.value));
      assert.deepEqual(instance.result.value,[rejected,['dirname','filename','main','resolve','url'],
        'local:value','local-directory',['TypeError','TypeError']]);
    }
  }finally{for(const instance of owned)instance.dispose();}
  const directory=await mkdtemp(join(tmpdir(),'bear-meta-boundary-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const entry=join(directory,'entry.mjs');await writeFile(entry,source);
    const native=await nativeProgram(await compileNativeEntry(entry));
    const value=await native.run(null,{call:async (input:unknown)=>{
      assert.deepEqual(input,{port:'step',input:rejected});return null;
    }} as any);
    assert.deepEqual(value,[rejected,['dirname','filename','main','resolve','url'],
      'local:value','local-directory',['TypeError','TypeError']]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
