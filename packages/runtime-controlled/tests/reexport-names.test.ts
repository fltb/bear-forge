import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspect} from 'node:util';
import {compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

for(const extension of ['mjs','mts'])for(const asynchronous of [false,true])
test(`string-named reexports retain aliases and live bindings (${extension}, async=${asynchronous})`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-reexport-names-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext',allowImportingTsExtensions:true},include:['*.mjs','*.mts']}));
    await writeFile(join(directory,'dependency.mjs'),`let value=1;const object={};
      export {value as 'a-b',object as '☿'};export function change(v){value=v;}`);
    const middle='middle.'+extension;
    await writeFile(join(directory,middle),`export {'a-b' as 'c-d','☿' as 'Ami','a-b' as '__proto__','a-b' as ''} from './dependency.mjs';${asynchronous?'await 0;':''}`);
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`import * as namespace from './${middle}';import {'☿' as object,change} from './dependency.mjs';
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){
        change(1);const before=namespace['c-d'];const reply=await io.call({port:'step',input:null});change(reply);
        return [before,namespace['c-d'],namespace[''],namespace.__proto__,namespace['a-b']===undefined,
          namespace['☿']===undefined,namespace.Ami===object,Object.getOwnPropertyNames(namespace)];
      }};`);
    const reference=(await import(pathToFileURL(entry).href)).program;
    const artifact=await compileEntry(entry),native=await compileNativeEntry(entry);
    const parent=new ProgramExecution(decode(artifact.content)),owned=[parent];
    try{
      parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
      const restored=parent.fresh();restored.restore(parent.snapshot());owned.push(parent.fork(),restored);
      for(const [index,instance]of owned.entries()){
        const reply=index+2,expected=await reference.run(null,{call:async()=>reply});
        assert.deepEqual(await (await nativeProgram(native)).run(null,{call:async()=>reply} as any),expected);
        instance.resume(reply);assert.equal(instance.result.status,1,inspect(instance.result.value));
        assert.deepEqual(instance.result.value,expected);
      }
    }finally{for(const instance of owned)instance.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});

for(const asynchronous of [false,true])test(`quoted star exports remain named bindings through module linking (async=${asynchronous})`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-star-export-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    await writeFile(join(directory,'value.mjs'),`export let value='before';export {value as '*',value as '*value'};
      export function update(next){value=next;}${asynchronous?'await 0;':''}`);
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`import {'*' as star,'*value' as prefixed,update} from './value.mjs';
      import * as namespace from './value.mjs';
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){
        const before=[star,prefixed,namespace['*'],Object.getOwnPropertyNames(namespace)];
        const reply=await io.call({port:'step',input:null});update(reply);
        return [before,star,prefixed,namespace['*'],Object.getOwnPropertyNames(namespace)];
      }};`);
    const reference=(await import(pathToFileURL(entry).href)).program;
    const reset=(await import(pathToFileURL(join(directory,'value.mjs')).href)).update;
    const artifact=await compileEntry(entry),parent=new ProgramExecution(decode(artifact.content)),owned=[parent];
    try{
      parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
      const restored=parent.fresh();restored.restore(parent.snapshot());owned.push(parent.fork(),restored);
      for(const [index,instance]of owned.entries()){
        reset('before');
        const reply='after-'+index,expected=await reference.run(null,{call:async()=>reply});
        instance.resume(reply);assert.equal(instance.result.status,1,inspect(instance.result.value));
        assert.deepEqual(instance.result.value,expected);
      }
    }finally{for(const instance of owned)instance.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
