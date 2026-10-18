import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runBatches} from '../src/batches.ts';
import {ExperimentFiles} from '../src/files.ts';
test('a frozen pending batch survives an interrupted transition and terminal runs only republish',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-batches-'));
  const calls:number[]=[];let interrupt=true;
  const options={directory,verify:async()=>{},initialize:async()=>1,
    execute:async(b:number)=>{calls.push(b);},
    advance:async(completed:number[])=>{
      if(interrupt){interrupt=false;throw Error('stop before transition');}
      return {next:completed.length<2?2:null,result:completed.length};
    },publish:async()=>{}};
  try{
    await assert.rejects(runBatches(options),/stop/);
    const state=await new ExperimentFiles(directory,x=>x).read<any>('evaluation-state');
    assert.equal(state.pending,1);assert.deepEqual(state.completed,[]);
    const result=await runBatches(options);assert.equal(result.result,2);
    assert.deepEqual(calls,[1,1,2]);
    await runBatches(options);assert.deepEqual(calls,[1,1,2]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('evaluation publishes immutable task files without copying their contents',async()=>{
  const {stat,unlink}=await import('node:fs/promises');
  const directory=await mkdtemp(join(tmpdir(),'bear-publish-'));
  const root=new ExperimentFiles(directory,(x:{id:string})=>x);
  const source=new ExperimentFiles(join(directory,'batch'),(x:{id:string})=>x);
  try{
    await source.commit('one',{id:'one'});
    await unlink(join(directory,'batch/summary-one.bin')); // crash after task commit, before derived summary
    await root.linkCommit('one',source);await root.linkCommit('one',source);
    assert.equal((await stat(join(directory,'task-one.bin'))).ino,(await stat(join(directory,'batch/task-one.bin'))).ino);
    await unlink(join(directory,'batch/task-one.bin'));
    assert.deepEqual(await root.read('task-one'),{id:'one'});
    assert.deepEqual(await root.summaries(),[{id:'one'}]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
