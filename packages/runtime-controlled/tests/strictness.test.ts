import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {ProgramExecution,decode} from '../src/execution.ts';

const body=`
function attempt(fn){try{return ['ok',fn()];}catch(error){return ['error',error.name];}}
const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(_,io){
  const target=Object.freeze({x:1}),trace=[],result=[];
  result.push(attempt(()=>target.x=(trace.push('rhs'),2)));
  result.push(attempt(()=>delete target.x),attempt(()=>target.x++),attempt(()=>++target.x));
  result.push(attempt(()=>target.x+=2),attempt(()=>target.x||=2),attempt(()=>target.x&&=2));
  result.push(attempt(()=>{[target.x]=[8];return target.x;}));
  result.push(attempt(()=>{for(target.x of [7,8])trace.push('loop');return target.x;}));
  result.push(attempt(()=>{const object={[target.x=2](){'use strict';return 3;}};return object[2]();}));
  result.push(attempt(()=>{class C{[target.x=2](){}}return 3;}));
  result.push(attempt(()=>{class C{[({x:target.x}={x:2})](){}}return 3;}));
  result.push(attempt(()=>{class C{[target.x++](){}}return 3;}));
  result.push(attempt(()=>{class C{static {target.x=2;}}return 3;}));
  result.push(attempt(()=>{const object={get x(){return 1;}};return object.x=3;}));
  result.push(attempt(()=>{const number=3;return number.x=2;}));
  result.push(attempt(()=>{const string='abc';return delete string[0];}));
  result.push(attempt(()=>{const value=null;return value.x=2;}));
  result.push(attempt(()=>{const value=undefined;return delete value.x;}));
  const array=[0,1,2,3];Object.defineProperty(array,'1',{configurable:false});
  result.push(attempt(()=>array.length=0),array.length,Object.keys(array));
  result.push(attempt(function(){'use strict';return target.x=3;}));
  for(const operation of [
    (o,k)=>++o[k],(o,k)=>o[k]++,(o,k)=>--o[k],(o,k)=>o[k]--,
    (o,k)=>o[k]+=(trace.push('rhs'),2),(o,k)=>o[k]=(trace.push('rhs'),2),
    (o,k)=>o[k]&&=(trace.push('rhs'),2),(o,k)=>delete o[k]
  ]){
    let conversions=0;
    const object={first:{valueOf(){trace.push('value');return 3;}},second:9};
    const key={[Symbol.toPrimitive](hint){trace.push('key:'+hint);return ++conversions===1?'first':'second';}};
    result.push(attempt(()=>operation(object,key)),conversions,object.second);
    result.push(attempt(()=>operation(null,key)),conversions);
  }
  class First{constructor(value){this.kind='first';this.value=value;}}
  class Second{constructor(value){this.kind='second';this.value=value;}}
  class Child extends First{constructor(){super((Object.setPrototypeOf(Child,Second),3));}}
  result.push(new Child().kind);
  let suspended;try{suspended=['ok',target.x+=await io.call({port:'step',input:null})];}catch(error){suspended=['error',error.name];}
  return [result,trace,suspended,target.x];
}};
`;

test('linked ESM property writes match original V8 in both backends',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-strict-properties-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const entry=join(root,'entry.mjs');await writeFile(entry,body+'export {program};');
    const original=(await import(pathToFileURL(entry).href)).program;
    const expected=await original.run(null,{call:async()=>4});
    assert.deepEqual(await (await nativeProgram(await compileNativeEntry(entry))).run(null,{call:async()=>4} as any),expected);
    const instance=new ProgramExecution(decode((await compileEntry(entry)).content));
    try{instance.start(null);assert.equal(instance.result.status,0,String(instance.result.value));instance.resume(4);assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);}finally{instance.dispose();}
  }finally{await rm(root,{recursive:true,force:true});}
});
