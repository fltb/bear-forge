import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileEntry,compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../../runtime-native/src/index.ts';
import {decode,ProgramExecution} from '../src/execution.ts';

test('strict directives, class methods and ESM functions retain their original receivers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-strict-receivers-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext'},include:['*.mjs']}));
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`function receiver(a=this){return [a===this,this];} class C{method(){return this;}} export const program={schemas:{setup:{parse:v=>v},result:{parse:v=>v},ports:{}},async run(){return [receiver()[1]===undefined,receiver.call(3)[1]===3,receiver.call(3)[0],C.prototype.method.call(null)===null];}};`);
    const expected=await (await import(pathToFileURL(entry).href)).program.run();
    assert.deepEqual(await (await nativeProgram(await compileNativeEntry(entry))).run(null,{} as any),expected);
    const instance=new ProgramExecution(decode((await compileEntry(entry)).content));
    try{instance.start(null);assert.equal(instance.result.status,1,String(instance.result.value));assert.deepEqual(instance.result.value,expected);}finally{instance.dispose();}
  }finally{await rm(root,{recursive:true,force:true});}
});
