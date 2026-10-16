import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

for(const reverse of [false,true])test(`cyclic reexports retain independent live bindings after fork and restore (reverse=${reverse})`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-cyclic-reexports-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const stars=[`export * from './cycle.mjs';`,`export * from './state.mjs';`];
    await writeFile(join(directory,'middle.mjs'),(reverse?stars.reverse():stars).join('\n'));
    await writeFile(join(directory,'cycle.mjs'),`export {value} from './middle.mjs';`);
    await writeFile(join(directory,'state.mjs'),`export let value=1;export function change(next){value=next;}`);
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`import {value} from './middle.mjs';import * as namespace from './middle.mjs';
      import {change} from './state.mjs';
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){
        change(1);const read=()=>[value,namespace.value];
        const before=read();const next=await io.call({port:'step',input:before});
        change(next);const after=read();await io.call({port:'step',input:after});return read();
      }};`);
    const reference=(await import(pathToFileURL(entry).href)).program;
    const compiled=await compileEntry(entry),native=await compileNativeEntry(entry);
    const parent=new ProgramExecution(decode(compiled.content)),owned=[parent];
    try{
      parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
      const restored=parent.fresh();restored.restore(parent.snapshot());owned.push(parent.fork(),restored);
      for(const [index,instance]of owned.entries()){
        instance.resume(index+2);assert.equal(instance.result.status,0,String(instance.result.value));
      }
      // Mutate every branch before resuming any, so shared module cells would
      // visibly contaminate the earlier branches' final live reads.
      for(const [index,instance]of owned.entries()){
        const reply=index+2,expected=await reference.run(null,{call:async()=>reply});
        assert.deepEqual(await (await nativeProgram(native)).run(null,{call:async()=>reply} as any),expected);
        instance.resume(null);assert.equal(instance.result.status,1,String(instance.result.value));
        assert.deepEqual(instance.result.value,expected);
      }
    }finally{for(const instance of owned)instance.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
