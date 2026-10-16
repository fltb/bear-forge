import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeProgram} from '@bear-forge/runtime-native';
import {compileNativeEntry,compileJavaScript} from '@bear-forge/compiler';
import {ProgramExecution,decode} from '../src/execution.ts';

async function program(_:unknown,io:any){
  const trace:any[]=[],source=new Uint8Array([2,3,4]);
  let shift=await io.call({port:'step',input:null});
  function Species(...args:any[]){trace.push(new.target===Species);return Reflect.construct(Uint8Array,args);}
  Object.defineProperty(source,'constructor',{get(){trace.push('constructor');return {[Symbol.species]:Species};}});
  const mapped=source.map((value,index,array)=>{trace.push(array===source);return value+shift;});
  const from=Uint8Array.from.call(Species,source,value=>value+shift);
  const of=Uint8Array.of.call(Species,shift,9);
  const filtered=source.filter(value=>value>2);
  const sliced=source.slice(1),view=source.subarray(1);
  function BufferSpecies(length:number){trace.push(new.target===BufferSpecies);return new ArrayBuffer(length);}
  source.buffer.constructor={[Symbol.species]:BufferSpecies} as any;
  const copied=source.buffer.slice(1);
  shift+=await io.call({port:'step',input:null});
  view[0]=shift;mapped[0]=shift;from[0]=shift;of[0]=shift;
  return {trace,source:[...source],mapped:[...mapped],from:[...from],of:[...of],filtered:[...filtered],sliced:[...sliced],copied:[...new Uint8Array(copied)],alias:view.buffer===source.buffer};
}

test('byte species constructors and captured state survive both sides of IO, fork and restore',async()=>{
  const artifact=decode(compileJavaScript(`export const program={schemas:{},run:${program.toString()}};`).content);
  const parent=new ProgramExecution(artifact);parent.start(null);
  assert.equal(parent.result.status,0,String(parent.result.value));
  const snapshot=parent.snapshot(),restored=parent.fresh();restored.restore(snapshot);
  for(const [index,instance]of[parent,parent.fork(),restored].entries()){
    const first=index+5;instance.resume(first);
    assert.equal(instance.result.status,0,String(instance.result.value));
    const saved=instance.snapshot(),restoredAfter=instance.fresh();restoredAfter.restore(saved);
    for(const [other,branch]of[instance,instance.fork(),restoredAfter].entries()){
      const second=other+10,replies=[first,second];
      const expected=await program(null,{call:async()=>replies.shift()});
      branch.resume(second);
      assert.equal(branch.result.status,1,String(branch.result.value));
      assert.deepEqual(branch.result.value,expected);
    }
  }
});


test('native production compilation preserves byte result constructor calls across IO',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-byte-constructors-'));
  try{
    await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{allowJs:true,noEmit:true,target:'ES2023',module:'NodeNext',skipLibCheck:true},include:['*.mjs']}));
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`const schema={parse(value){return value;}};
      export const program={schemas:{setup:schema,result:schema,ports:{step:{input:schema,output:schema}}},run:${program.toString()}};`);
    const artifact=await compileNativeEntry(entry);
    for(const first of [2,5]){
      const referenceInputs=[first,10],actualInputs=[first,10];
      const expected=await program(null,{call:async()=>referenceInputs.shift()});
      const actual=await (await nativeProgram(artifact)).run(null,{call:async()=>actualInputs.shift()} as any);
      assert.deepEqual(actual,expected);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
