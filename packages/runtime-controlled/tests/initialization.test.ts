import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileEntry, compileJavaScript} from '@bear-forge/compiler';
import {ProgramExecution, decode} from '../src/execution.ts';
import {createControlledLoader, programDigest} from '../src/index.ts';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {types} from 'node:util';

const execution = (source:string) => new ProgramExecution(decode(compileJavaScript(source).content));
const rejectionCases=[['17',17],['undefined',undefined],['null',null],['false',false],['0',0],['""','']] as const;
test('async module completion precedes entry execution and its state survives fork and restore',()=>{
  const parent=execution(`
    let count=0,value=0;
    export const program={schemas:{},async run(_,io){
      value+=await io.call({port:'step',input:[count,value]});return [count,value];
    }};
    count++;
    value=await Promise.resolve(40);
    try{value+=await {then(resolve){resolve(2);}};}finally{count++;}
  `);
  parent.start(null);
  assert.deepEqual(parent.io.callData,{port:'step',input:[2,42]});
  const branch=parent.fork(),restored=parent.fresh();
  restored.restore(parent.snapshot());
  try{
    for(const [instance,reply]of [[parent,1],[branch,2],[restored,3]] as const){
      instance.resume(reply);
      assert.equal(instance.result.status,1);
      assert.deepEqual(instance.result.value,[2,42+reply]);
      assert.strictEqual(instance.loaded,parent.loaded);
    }
    assert.equal(parent.loaded.statistics.initializations,1);
  }finally{parent.dispose();branch.dispose();restored.dispose();}
});

test('rejected or unfinished module evaluation never starts an already-exported entry',()=>{
  for(const [expression,expected]of rejectionCases)for(const source of [
    `export const program={schemas:{},async run(){return 'wrong';}};await Promise.reject(${expression});`,
    `await 0;throw ${expression};export const program={schemas:{},async run(){return 'wrong';}};`
  ]){
    const instance=execution(source);
    try{
      let rejected=false;
      try{instance.start(null);}catch(error){rejected=true;assert.strictEqual(error,expected);}
      assert.equal(rejected,true,`module rejection ${expression} must propagate`);
      assert.equal(instance.result,undefined);
      assert.throws(()=>instance.snapshot(),/not saveable/);
    }finally{instance.dispose();}
  }
  const pending=execution(`export const program={schemas:{},async run(){return 'wrong';}};await new Promise(()=>{});`);
  try{
    assert.throws(()=>pending.start(null),/initialization is suspended/);
    assert.equal(pending.result,undefined);
    assert.throws(()=>pending.snapshot(),/not saveable/);
  }finally{pending.dispose();}
});

test('real schema loader accepts completed async initialization and preserves module state on recovery',async()=>{
  const native=await import('./initialization-fixture.ts');
  const expected=await native.program.run(null,{call:async()=>4});
  const artifact=await compileEntry<null,{step:{input:number;output:number}},number>(new URL('./initialization-fixture.ts',import.meta.url).pathname);
  const loaded=await createControlledLoader({trustedDigests:new Set([programDigest(artifact.content)])}).load(artifact);
  assert.ok(loaded.ok);
  assert.ok(loaded.value.persistence);
  const started=await loaded.value.core.start(null);assert.ok(started.ok);
  const parent=started.value;
  assert.ok(parent.fork);
  const saved=await loaded.value.persistence.save(parent);assert.ok(saved.ok);
  const forked=await parent.fork();assert.ok(forked.ok);
  const restored=await loaded.value.persistence.restore(saved.value);assert.ok(restored.ok);
  for(const instance of [parent,forked.value,restored.value]){
    await instance.bind({step:async()=>({kind:'reply',value:4})});
    const result=await instance.run();assert.ok(result.ok);
    assert.deepEqual(result.value.state,{kind:'done',result:expected});
    await instance.close();
  }
  await loaded.value.persistence.release(saved.value);
});

test('async module siblings begin before a suspended dependency resumes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-siblings-'));
  try{
    const files={
      'tsconfig.json':JSON.stringify({compilerOptions:{allowJs:true,checkJs:false,noEmit:true,skipLibCheck:true,target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext'}}),
      'state.mjs':'export const trace=[];',
      'a.mjs':'import {trace} from "./state.mjs";trace.push("a:start");await 0;trace.push("a:end");',
      'b.mjs':'import {trace} from "./state.mjs";trace.push("b");',
      'entry.mts':'import "./a.mjs";import "./b.mjs";import {trace} from "./state.mjs";export const program={schemas:{},async run(){return trace;}};'
    };
    for(const [name,source]of Object.entries(files))await writeFile(join(directory,name),source);
    const entry=join(directory,'entry.mts');
    const native=await import(pathToFileURL(entry).href);
    const expected=await native.program.run();
    assert.deepEqual(expected,['a:start','b','a:end']);
    const instance=new ProgramExecution(decode((await compileEntry(entry)).content));
    try{
      instance.start(null);
      assert.equal(instance.result.status,1);
      assert.deepEqual(instance.result.value,expected);
    }finally{instance.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});


test('async dependency rejection preserves its value and cyclic reads preserve TDZ',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-errors-'));
  const outcome=async(operation:()=>unknown)=>{
    try{return {kind:'returned' as const,value:await operation()};}
    catch(error){
      const prototype=types.isNativeError(error)?Object.getPrototypeOf(error):null;
      const name=prototype&&Object.getOwnPropertyDescriptor(prototype,'name');
      return {kind:'threw' as const,value:name && 'value' in name && name.value==='ReferenceError'?'ReferenceError':error};
    }
  };
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{
      allowJs:true,checkJs:false,noEmit:true,skipLibCheck:true,target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext'
    }}));
    const cases=[
      ...rejectionCases.map(([expression,value])=>({
        a:`await 0;throw ${expression};export const value=1;`,b:'',
        expected:{kind:'threw',value},expression
      })),
      {a:'import {b} from "./b.mjs";export const value=1;export const other=b;',
        b:'import {value} from "./a.mjs";await 0;export const b=value;',
        expected:{kind:'threw',value:'ReferenceError'},expression:'cycle'}
    ];
    for(const [index,item]of cases.entries()){
      // Unique URLs keep the native module cache from sharing evaluations.
      const prefix=String(index);
      const a=prefix+'a.mjs',b=prefix+'b.mjs',entry=join(directory,prefix+'entry.mts');
      await writeFile(join(directory,a),item.a.replace('./b.mjs','./'+b));
      await writeFile(join(directory,b),item.b.replace('./a.mjs','./'+a));
      await writeFile(entry,`import {value} from "./${a}";export const program={schemas:{},async run(){return value;}};`);
      const expected=await outcome(()=>import(pathToFileURL(entry).href));
      assert.deepEqual(expected,item.expected);
      const instance=new ProgramExecution(decode((await compileEntry(entry)).content));
      try{
        assert.deepEqual(await outcome(()=>instance.start(null)),expected,item.expression);
        assert.equal(instance.result,undefined);
        assert.throws(()=>instance.snapshot(),/not saveable/);
      }finally{instance.dispose();}
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('async module frames retain live imports, self namespaces and callable source across branches',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-async-bindings-'));
  try{
    const files={
      'tsconfig.json':JSON.stringify({compilerOptions:{allowJs:true,checkJs:false,noEmit:true,skipLibCheck:true,module:'NodeNext',moduleResolution:'NodeNext',target:'ES2023'}}),
      'lib.mjs':'export let value=1;export function add(n){value+=n;}export * as self from "./lib.mjs";',
      'other.mjs':'export let number=8;export function change(){number++;}',
      'entry.mjs':`import {value,add} from './lib.mjs';import * as ns from './lib.mjs';import * as other from './other.mjs';
        await 0;export const program={schemas:{},async run(_,io){
          add(await io.call({port:'step',input:value}));other.change();
          return [value,ns.value,ns.self===ns,other.number,add.name,add.toString()];
        }};`
    };
    for(const [name,source]of Object.entries(files))await writeFile(join(directory,name),source);
    const entry=join(directory,'entry.mjs');
    const native=await import(pathToFileURL(entry).href);
    const expected=await native.program.run(null,{call:async()=>2});
    assert.deepEqual(expected,[3,3,true,9,'add','function add(n){value+=n;}']);
    const parent=new ProgramExecution(decode((await compileEntry(entry)).content));
    try{
      parent.start(null);assert.deepEqual(parent.io.callData,{port:'step',input:1});
      const initialized=parent.loaded.statistics.initializations;
      const fork=parent.fork(),restored=parent.fresh();
      try{
        restored.restore(parent.snapshot());
        for(const [instance,reply]of [[parent,2],[fork,3],[restored,4]] as const){
          instance.resume(reply);assert.equal(instance.result.status,1);
          assert.deepEqual(instance.result.value,[reply+1,reply+1,...expected.slice(2)]);
        }
        assert.equal(parent.loaded.statistics.initializations,initialized);
      }finally{fork.dispose();restored.dispose();}
    }finally{parent.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
