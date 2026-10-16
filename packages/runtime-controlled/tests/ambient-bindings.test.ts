import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileJavaScript,compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

const body=`
const program={schemas:{setup:{parse:x=>x},result:{parse:x=>x},ports:{}},async run(_,io){
  const root=globalThis,O=Object,trace=[];
  const names=['Object','Array','Number','Math','globalThis'];
  const saved={};for(const name of names)saved[name]=O.getOwnPropertyDescriptor(root,name);
  try {
    Object=null;Array=()=>99;Math=null;
    trace.push(Object===root.Object,Array(),Math===null);
    class Base{base(){return 1;}}
    class Derived extends Base{#value=2;value(){return super.base()+this.#value;}}
    trace.push(new Derived().value(),[1,2].map(x=>x+1));
    delete root.Number;trace.push(typeof Number);
    try{Number;}catch(error){trace.push(error.name);}
    Number=(root.Number=0,1);
    Number+=await io.call({port:'step',input:null});
    trace.push(Number,root.Number);
    ({value:Number}={value:8});for(Number of [9,10])trace.push(Number);
    try{Infinity=3;trace.push('constant-write-returned');}catch(error){trace.push(error.name);}
    globalThis={value:11};trace.push(globalThis.value,root.globalThis===globalThis);
    return trace;
  } finally {O.defineProperties(root,saved);}
}};
`;

async function controlled(source:string,artifact:Awaited<ReturnType<typeof compileJavaScript>>,expected:(reply:number)=>Promise<unknown>){
  const parent=new ProgramExecution(decode(artifact.content)),instances=[parent];
  try{
    parent.start(null);assert.equal(parent.result.status,0,String(parent.result.value));
    const restored=parent.fresh();restored.restore(parent.snapshot());instances.push(parent.fork(),restored);
    for(const [index,instance]of instances.entries()){
      const reply=index+2,wanted=await expected(reply);
      instance.resume(reply);assert.equal(instance.result.status,1,String(instance.result.value));
      assert.deepEqual(instance.result.value,wanted,source);
    }
  }finally{for(const instance of instances)instance.dispose();}
}

test('linked ESM globals agree with original V8 in both backends',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-ambient-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const entry=join(directory,'entry.mjs');
    const source=body+'export {program};';
    await writeFile(entry,source);
    // The original program may replace globals while awaiting IO. Isolate its
    // realm from this test runner rather than mutating the runner's intrinsics.
    const expected=async(reply:number)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',
      `const m=await import(${JSON.stringify(pathToFileURL(entry).href)});const p=m.program;const result=await p.run(null,{call:async()=>${reply}});process.stdout.write(JSON.stringify(result));`
    ],{encoding:'utf8'}));
    const native=await nativeProgram(await compileNativeEntry(entry));
    assert.deepEqual(await native.run(null,{call:async()=>2} as any),await expected(2));
    await controlled(source,await compileEntry(entry),expected);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('global replacement never grants mutation of the shared intrinsic object',()=>{
  const execution=new ProgramExecution(decode(compileJavaScript(`export const program={schemas:{},async run(){
    const original=Object;Object={value:1};
    try{original.prototype.ambientProbe=2;return false;}catch(error){return error instanceof TypeError;}
  }};`).content));
  try{execution.start(null);assert.equal(execution.result.status,1,String(execution.result.value));assert.equal(execution.result.value,true);assert.equal(Object.hasOwn(Object.prototype,'ambientProbe'),false);}finally{execution.dispose();}
});

test('a module-local require name is an ordinary function, not a host dependency',()=>{
  const execution=new ProgramExecution(decode(compileJavaScript(`
    function require(){return 7}
    export const program={schemas:{},async run(){return require()}};
  `).content));
  try{execution.start(null);assert.equal(execution.result.status,1);assert.equal(execution.result.value,7);}finally{execution.dispose();}
});

test('a side-effect-only ESM keeps strict global writes after linking',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-ambient-module-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    await writeFile(join(directory,'side.mjs'),`try{Infinity=3;globalThis.ambientResult='returned';}catch(error){globalThis.ambientResult=error.name;}`);
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`import './side.mjs';export const program={schemas:{setup:{parse:x=>x},result:{parse:x=>x},ports:{}},async run(){return globalThis.ambientResult;}};`);
    const expected=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',
      `const {program}=await import(${JSON.stringify(pathToFileURL(entry).href)});process.stdout.write(JSON.stringify(await program.run()));`
    ],{encoding:'utf8'}));
    const artifact=await compileEntry(entry),execution=new ProgramExecution(decode(artifact.content));
    assert.doesNotMatch(decode(artifact.content).code,/globalStrictMarker/);
    try{execution.start(null);assert.equal(execution.result.status,1,String(execution.result.value));assert.equal(execution.result.value,expected);}finally{execution.dispose();}
    assert.equal(await (await nativeProgram(await compileNativeEntry(entry))).run(null,{} as any),expected);
  }finally{await rm(directory,{recursive:true,force:true});}
});
