import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {pathToFileURL} from 'node:url';
import { compileEntry } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

test('cyclic module bindings retain initialization errors and independent live exports through restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-controlled-modules-'));
  try {
    const entry = join(root, 'entry.ts');
    await writeFile(entry, `
      import {trace,read} from './dependency.ts';
      export let value=7;
      export const program={schemas:{},async run(input:null,io:{call:(request:unknown)=>Promise<number>}){
        value+=await io.call({port:'step',input:read()});
        return [trace,read()];
      }};
    `);
    await writeFile(join(root, 'dependency.ts'), `
      import {value} from './entry.ts';
      export const trace:string[]=[];
      try{trace.push(String(value));}catch(error){trace.push((error as Error).name);}
      export function read(){return value;}
    `);
    const parent = new ProgramExecution(decode((await compileEntry(entry)).content));
    parent.start(null);
    assert.equal(parent.result.status, 0, String(parent.result.value));
    const restored = parent.fresh(); restored.restore(parent.snapshot());
    for (const [index, instance] of [parent, parent.fork(), restored].entries()) {
      instance.resume(index + 1);
      assert.equal(instance.result.status, 1, String(instance.result.value));
      assert.deepEqual(instance.result.value, [['ReferenceError'], 8 + index]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('JSON module values and imported aliases remain independent after fork and restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-controlled-json-'));
  try {
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({compilerOptions:{
      noEmit:true, strict:true, target:'ES2023', module:'NodeNext', moduleResolution:'NodeNext',
      allowImportingTsExtensions:true, resolveJsonModule:true,
    }}));
    await writeFile(join(root, 'data.json'), '{"__proto__":{"value":7},"negativeZero":-0}');
    const entry = join(root, 'entry.mts');
    await writeFile(entry, `
      import data from './data.json' with {type:'json'};
      const alias=data.__proto__;
      export const program={schemas:{},async run(input:null,io:{call:(request:unknown)=>Promise<number>}){
        alias.value+=await io.call({port:'step',input:alias.value});
        return [Object.getPrototypeOf(data)===Object.prototype,Object.hasOwn(data,'__proto__'),
          alias===data.__proto__,alias.value,Object.is(data.negativeZero,-0)];
      }};
    `);
    const reference=(await import(pathToFileURL(entry).href)).program;
    assert.deepEqual(await reference.run(null,{call:async()=>1}),[true,true,true,8,true]);
    const parent = new ProgramExecution(decode((await compileEntry(entry)).content)); parent.start(null);
    assert.equal(parent.result.status, 0, String(parent.result.value));
    const restored = parent.fresh(); restored.restore(parent.snapshot());
    for (const [index, instance] of [parent, parent.fork(), restored].entries()) {
      instance.resume(index + 1);
      assert.equal(instance.result.status, 1, String(instance.result.value));
      assert.deepEqual(instance.result.value, [true,true,true,8+index,true]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('linked callable names survive cyclic reads and independent forked module mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-controlled-names-'));
  try {
    await writeFile(join(root, 'first.ts'), `
      import {record} from './entry.ts';
      export function same(){return same.name;}
      export const arrow=()=>same.name;
      export let count=0;
      export function increment(value:number){count+=value;return count;}
      export const early=record();
    `);
    await writeFile(join(root, 'second.ts'), 'export function same(){return same.name;} export const arrow=()=>same.name;');
    const entry=join(root, 'entry.ts');
    await writeFile(entry, `
      import {same as first,arrow as firstArrow,early,increment} from './first.ts';
      import {same as second,arrow as secondArrow} from './second.ts';
      export function record(){return [first.name,second.name];}
      export const program={schemas:{},async run(input:null,io:{call:(request:unknown)=>Promise<number>}){
        const reply=await io.call({port:'step',input:null});
        return [early,record(),first(),second(),firstArrow.name,secondArrow.name,increment(reply)];
      }};
    `);
    const parent=new ProgramExecution(decode((await compileEntry(entry)).content));parent.start(null);
    assert.equal(parent.result.status,0,String(parent.result.value));
    const restored=parent.fresh();restored.restore(parent.snapshot());
    for(const [index,instance] of [parent,parent.fork(),restored].entries()){
      instance.resume(index+1);
      assert.equal(instance.result.status,1,String(instance.result.value));
      assert.deepEqual(instance.result.value,[['same','same'],['same','same'],'same','same','arrow','arrow',index+1]);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('module namespaces retain live descriptors reexports and cyclic identity across fork and restore', async () => {
  const root=await mkdtemp(join(tmpdir(),'bear-controlled-namespace-'));
  try {
    await writeFile(join(root,'dependency.ts'), `
      import {inspectEarly} from './entry.ts';
      export const early=inspectEarly();
      export let value=1;
      export function increment(n:number){value+=n;}
      export * as self from './dependency.ts';
    `);
    await writeFile(join(root,'reexport.ts'), `export * as inner from './dependency.ts';`);
    const entry=join(root,'entry.ts');
    await writeFile(entry, `
      import * as direct from './dependency.ts';
      import {inner} from './reexport.ts';
      export function inspectEarly(){try{Object.getOwnPropertyDescriptor(direct,'value');return 'wrong';}
        catch(error){return (error as Error).name;}}
      export const program={schemas:{},async run(input:null,io:{call:(request:unknown)=>Promise<number>}){
        const ns=direct;
        const reply=await io.call({port:'step',input:null});
        ns.increment(reply);
        const d=Object.getOwnPropertyDescriptor(ns,'value')!;
        return [direct.early,ns===inner,ns.self===ns,ns.value,d.value,d.writable,'get' in d,
          Object.prototype.toString.call(ns),Object.isFrozen(ns),Reflect.set(ns,'value',9),
          Reflect.defineProperty(ns,'value',{value:ns.value}),Reflect.defineProperty(ns,'value',{value:99})];
      }};
    `);
    const parent=new ProgramExecution(decode((await compileEntry(entry)).content));parent.start(null);
    assert.equal(parent.result.status,0,String(parent.result.value));
    const restored=parent.fresh();restored.restore(parent.snapshot());
    for(const [index,instance] of [parent,parent.fork(),restored].entries()){
      instance.resume(index+1);
      assert.equal(instance.result.status,1,String(instance.result.value));
      assert.deepEqual(instance.result.value,['ReferenceError',true,true,index+2,index+2,true,false,'[object Module]',false,false,true,false]);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});


test('super writes to a module namespace read TDZ before rejecting its immutable binding',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-namespace-super-'));
  try {
    const entry=join(root,'entry.mjs');
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,checkJs:false,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'}}));
    await writeFile(entry,`
      import * as ns from './entry.mjs';
      class Base { constructor(){return ns;} }
      class Derived extends Base { constructor(){super();super.value=14;} }
      const errors=[];
      try{new Derived();}catch(error){errors.push(error.name);}
      export let value=42;
      try{new Derived();}catch(error){errors.push(error.name);}
      export const program={schemas:{},async run(){return [errors,value];}};
    `);
    // Match the pinned Test262 super-access-to-tdz-binding expectation.
    // Current native V8 reports TypeError before its namespace TDZ read.
    const expected=[['ReferenceError','TypeError'],42];
    const instance=new ProgramExecution(decode((await compileEntry(entry,'program')).content));
    try {instance.start(null);assert.equal(instance.result.status,1);assert.deepEqual(instance.result.value,expected);}
    finally {instance.dispose();}
  } finally {await rm(root,{recursive:true,force:true});}
});
