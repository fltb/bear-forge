import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram,isNativeBudgetError} from '../src/index.ts';
import {NativeHostError} from '../src/module.ts';

test('async native initialization preserves falsy rejections and sticky capability faults',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-native-init-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    for(const [index,value] of [0,null,undefined].entries()){
      const entry=join(root,`reject${index}.mjs`);
      await writeFile(entry,`await 0;throw ${String(value)};export const program={};`);
      await assert.rejects(import(pathToFileURL(entry).href),error=>error===value);
      await assert.rejects(nativeProgram(await compileNativeEntry(entry)),error=>error===value);
    }
    const entry=join(root,'fault.mjs');
    await writeFile(entry,`await 0;try{Math['random']();}catch{} export const program={};`);
    await assert.rejects(nativeProgram(await compileNativeEntry(entry)),NativeHostError);
    await writeFile(entry,`await 0;try{for(let n=0;n<1000;n++){} }catch{} export const program={};`);
    await assert.rejects(nativeProgram(await compileNativeEntry(entry),{stepBudget:10}),isNativeBudgetError);
  }finally{await rm(root,{recursive:true,force:true});}
});
