import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

for(const expression of ['7','await Promise.resolve(7)','()=>7','(function(){return 7;})',
  '(0,function(){return 7;})','(class{static seen=this.name;})','function selected(){return 7;}',
  'function(){return 7;}','class Selected{static seen=this.name;}','class{static seen=this.name;}'])
test(`default export initialization and naming match native ESM: ${expression}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-default-exports-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    await writeFile(join(directory,'value.mjs'),`import * as self from './value.mjs';
      export const trace=[];
      for(const action of [()=>typeof self.default,
        ()=>Object.getOwnPropertyDescriptor(self,'default').writable,
        ()=>Object.keys(self),()=>delete self.default,()=>Reflect.deleteProperty(self,'default')]){
        try{trace.push(action());}catch(error){trace.push(error.name);}
      }
      export default ${expression};`);
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`import value,{trace} from './value.mjs';import * as namespace from './value.mjs';
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){
        const reply=await io.call({port:'step',input:null});
        return [trace,typeof value==='function'?[value.name,value.seen??null]:value,namespace.default===value,reply];
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
        instance.resume(reply);assert.equal(instance.result.status,1,String(instance.result.value));
        assert.deepEqual(instance.result.value,expected);
      }
    }finally{for(const instance of owned)instance.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
