import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry} from '@bear-forge/compiler';
import {ProgramExecution,decode} from '../src/execution.ts';

for(const asynchronous of [false,true])test(`module this preserves lexical ownership across IO and branches (async=${asynchronous})`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-this-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`
      const top=this,read=()=>this;
      const keys=[];
      class Example {
        [keys.push(this===undefined)](){return this;}
        field=()=>this;
        static own=this;
        static arrow=()=>this;
      }
      const object={ [keys.push(this===undefined)](){return this;} };
      function receiver(){return ()=>this;}
      ${asynchronous?'await 0;':''}
      export const program={schemas:{},async run(_,io){
        const instance=new Example();
        const captured=receiver.call(instance);
        const reply=await io.call({port:'step',input:[top===undefined,read()===undefined,keys]});
        return [reply,top===undefined,read()===undefined,instance.field()===instance,
          instance[1]()===instance,object[2]()===object,Example.own===Example,
          Example.arrow()===Example,captured()===instance,receiver()()===undefined,keys];
      }};
    `);
    const native=await import(pathToFileURL(entry).href);
    const parent=new ProgramExecution(decode((await compileEntry(entry)).content));
    const instances=[parent];
    try{
      parent.start(null);
      assert.equal(parent.result.status,0);
      assert.deepEqual(parent.io.callData,{port:'step',input:[true,true,[true,true]]});
      const branch=parent.fork(),restored=parent.fresh();instances.push(branch,restored);
      restored.restore(parent.snapshot());
      for(const [index,instance]of instances.entries()){
        const expected=await native.program.run(null,{call:async()=>index});
        instance.resume(index);
        assert.equal(instance.result.status,1);
        assert.deepEqual(instance.result.value,expected);
      }
    }finally{for(const instance of instances)instance.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
