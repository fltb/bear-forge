import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

for(const asynchronous of [false,true])test(`attributed data modules retain type, namespace and branch identity (async=${asynchronous})`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-data-runtime-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const json='\uFEFF{"__proto__":{"safe":true},"count":1}';
    await writeFile(join(root,'data.json'),json);
    await writeFile(join(root,'other.mjs'),`export {default as alias} from './data.json' with {type:'json'};export * as space from './data.json' with {type:'json'};`);
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`
      import value from './data.json' with {type:'json'};
      import * as namespace from './data.json' with {type:'json'};
      import {alias,space} from './other.mjs';
      ${asynchronous?'await 0;':''}
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){
        value.count+=await io.call({port:'step',input:value.count});
        return [value===alias,value===namespace.default,space===namespace,
          Object.getOwnPropertyNames(namespace),Object.getPrototypeOf(namespace)===null,
          value.count,alias.count,Object.getPrototypeOf(value)===Object.prototype,
          Object.hasOwn(value,'__proto__'),value.__proto__.safe];
      }};
    `);
    const original=(await import(pathToFileURL(entry).href)).program;
    const parent=new ProgramExecution(decode((await compileEntry(entry)).content)),owned=[parent];
    const native=await compileNativeEntry(entry);
    try{
      parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
      assert.deepEqual(parent.io.callData,{port:'step',input:1});
      const fork=parent.fork(),restored=parent.fresh();owned.push(fork,restored);restored.restore(parent.snapshot());
      for(const [index,instance]of owned.entries()){
        const reply=index+2,expected=[true,true,true,['default'],true,1+reply,1+reply,true,true,true];
        const before=await original.run(null,{call:async()=>0});
        assert.deepEqual(before,[true,true,true,['default'],true,1,1,true,true,true]);
        if(native)assert.deepEqual(await (await nativeProgram(native)).run(null,{call:async()=>reply} as any),expected);
        instance.resume(reply);assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);
      }
    }finally{for(const instance of owned)instance.dispose();}
  }finally{await rm(root,{recursive:true,force:true});}
});

test('attributed JSON primitives and containers match original V8 module imports',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-json-values-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    for(const [index,value]of [null,true,-0,7,'text',[1,null],{nested:[2]}].entries()){
      await writeFile(join(root,`data${index}.json`),Object.is(value,-0)?'-0':JSON.stringify(value));
      const entry=join(root,`entry${index}.mjs`);
      await writeFile(entry,`import value from './data${index}.json' with {type:'json'};export const program={schemas:{},async run(){return value;}};`);
      const expected=await (await import(pathToFileURL(entry).href)).program.run();
      const instance=new ProgramExecution(decode((await compileEntry(entry)).content));
      try{instance.start(null);assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);}finally{instance.dispose();}
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

test('empty ordinary module attributes preserve controlled execution and Context branches',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-js-attributes-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    await writeFile(join(root,'value.mjs'),'export const amount=4;');
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`import {amount} from './value.mjs' with {};
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){
        const extra=await io.call({port:'step',input:amount});return amount+extra;
      }};`);
    const parent=new ProgramExecution(decode((await compileEntry(entry)).content)),owned=[parent];
    try{
      parent.start(null);assert.equal(parent.result.status,0);assert.deepEqual(parent.io.callData,{port:'step',input:4});
      const fork=parent.fork(),restored=parent.fresh();owned.push(fork,restored);restored.restore(parent.snapshot());
      for(const [index,instance]of owned.entries()){
        instance.resume(index+1);assert.equal(instance.result.status,1);assert.equal(instance.result.value,5+index);
      }
    }finally{for(const instance of owned)instance.dispose();}
  }finally{await rm(root,{recursive:true,force:true});}
});
