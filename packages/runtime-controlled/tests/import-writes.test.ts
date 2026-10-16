import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

async function compare(body:string,dependency='export let value=1;export function change(v){value=v;}',defaultImport=false){
  const directory=await mkdtemp(join(tmpdir(),'bear-import-writes-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    await writeFile(join(directory,'dependency.mjs'),dependency);
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`import ${defaultImport?'target,{change}':'{value as target,change}'} from './dependency.mjs';
      import * as namespace from './dependency.mjs';
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){${body}}};`);
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
}

test('import binding writes preserve runtime errors, short circuiting and pattern/loop effects',async()=>{
  await compare(`
    const reply=await io.call({port:'step',input:null}),trace=[],results=[];
    function right(){trace.push('rhs');return reply;}
    function attempt(name,action){trace.push(name);try{results.push(action());}catch(error){results.push(error.name);}}
    change(1);attempt('assign',()=>target=right());
    attempt('plus',()=>target+=right());attempt('multiply',()=>target*=right());
    attempt('prefix',()=>++target);attempt('postfix',()=>target--);
    attempt('and',()=>target&&=right());attempt('or-skip',()=>target||=right());
    attempt('nullish-skip',()=>target??=right());change(null);
    attempt('and-skip',()=>target&&=right());attempt('or',()=>target||=right());
    attempt('nullish',()=>target??=right());
    attempt('array-default',()=>[target=right()]=[]);
    attempt('object',()=>({value:target}={get value(){trace.push('get');return reply;}}));
    attempt('rest',()=>[...target]=[1,2]);
    attempt('object-rest',()=>({...target}={a:1}));
    const iterable={*[Symbol.iterator](){try{yield 1;yield 2;}finally{trace.push('close');}}};
    attempt('loop',()=>{for(target of iterable)trace.push('body');});
    attempt('in',()=>{for(target in {a:1})trace.push('body');});
    attempt('class-name',()=>target=class{static{trace.push(this.name);}});
    attempt('class-default-name',()=>[target=class{static{trace.push(this.name);}}]=[]);
    return [trace,results,target];
  `);
});

test('default imports use the same immutable semantics and local shadows stay writable',async()=>{
  await compare(`
    const reply=await io.call({port:'step',input:null});change(3);const trace=[];
    function shadow(target){target+=reply;return target;}
    try{target=class{static{trace.push(this.name);}};}catch(error){trace.push(error.name);}
    return [shadow(5),target,trace];
  `,'export let value=1;export {value as default};export function change(v){value=v;}',true);
});

test('cyclic imports distinguish immutable writes from uninitialized reads before module evaluation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-import-tdz-'));
  try{
    await writeFile(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    await writeFile(join(directory,'dependency.mjs'),`import {probe} from './entry.mjs';
      export const trace=[];probe(trace);export let value=7;`);
    const entry=join(directory,'entry.mjs');
    await writeFile(entry,`import {value as target,trace} from './dependency.mjs';
      export function probe(trace){
        try{target=(trace.push('rhs'),9);}catch(error){trace.push(error.name);}
        try{target++;}catch(error){trace.push(error.name);}
        try{target+=(trace.push('compound-rhs'),9);}catch(error){trace.push(error.name);}
        try{target||=(trace.push('logical-rhs'),9);}catch(error){trace.push(error.name);}
        try{[target]=[9];}catch(error){trace.push(error.name);}
      }
      export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(){return [trace,target];}};`);
    const expected=await (await import(pathToFileURL(entry).href)).program.run();
    const native=await compileNativeEntry(entry);
    assert.deepEqual(await (await nativeProgram(native)).run(null,{} as any),expected);
    const instance=new ProgramExecution(decode((await compileEntry(entry)).content));
    try{instance.start(null);assert.equal(instance.result.status,1);assert.deepEqual(instance.result.value,expected);}
    finally{instance.dispose();}
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('namespace property writes and deletes retain computed keys, values and native failure timing',async()=>{
  await compare(`
    const reply=await io.call({port:'step',input:null}),trace=[],results=[];change(1);
    const key={toString(){trace.push('key');return 'value';}};
    function right(){trace.push('rhs');return reply;}
    function attempt(name,action){trace.push(name);try{results.push(action());}catch(error){results.push(error.name);}}
    attempt('write',()=>namespace[key]=right());attempt('compound',()=>namespace[key]+=right());
    attempt('update',()=>namespace[key]++);attempt('delete',()=>delete namespace[key]);
    attempt('delete-missing',()=>delete namespace.absent);
    attempt('missing-write',()=>namespace.absent=right());
    attempt('namespace-binding',()=>namespace=right());
    attempt('pattern',()=>[namespace.value]=[reply]);
    return [trace,results,target];
  `);
});

for(const target of ['target','namespace.value'])for(const operator of ['=','+='])
  test(`import write reference survives IO and independent restoration (${target} ${operator})`,async()=>{
    await compare(`
      const trace=[];change({valueOf(){trace.push('convert');return 4;}});
      try{${target} ${operator} (change(9),await io.call({port:'step',input:null}));}
      catch(error){trace.push(error.name);}
      return [trace,target,namespace.value];
    `);
  });

test('imported values retain V8 numeric conversion before immutable update errors',async()=>{
  await compare(`
    await io.call({port:'step',input:null});const trace=[];
    for(const value of [1n,Symbol('value'),{valueOf(){trace.push('conversion');throw new RangeError();}}]){
      change(value);try{target++;}catch(error){trace.push(error.name);}
    }
    return trace;
  `);
});

test('numeric export keys preserve namespace identity, ordering and runtime write failures',async()=>{
  await compare(`
    const reply=await io.call({port:'step',input:null});change(reply);const trace=[];
    for(const key of ['0','1','4294967294','4294967295','01']){
      trace.push(namespace[key],Reflect.set(namespace,key,99));
      try{namespace[key]=99;}catch(error){trace.push(error.name);}
      try{delete namespace[key];}catch(error){trace.push(error.name);}
    }
    return [Object.getOwnPropertyNames(namespace),trace,target];
  `,`export let value=1;export function change(v){value=v;}
    export {value as '0',value as '1',value as '4294967294',value as '4294967295',value as '01'};`);
});
