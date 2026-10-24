import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Writable} from 'node:stream';
import {runStsSearch} from '../src/sts-search.ts';
import {ExperimentFiles} from '@bear-forge/experiments';
import {SearchRegistrationSchema} from '@bear-forge/sts';
import {searchTasks} from '../../../examples/sts/src/search/experiment.ts';
test('search CLI uses the registered experiment, truncates a bounded run, and resume does not duplicate it',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-cli-'));
  let output='';const sink=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  try{
    const config=join(directory,'config.json'),out=join(directory,'experiment');
    await writeFile(config,JSON.stringify({id:'search-smoke',phase:'development',characters:['ironclad'],algorithms:['r0'],modes:['work'],gameSeeds:[918273],searchSeeds:[42],maxSteps:2,batchMilliseconds:60000,checkpointEvery:1}));
    await runStsSearch([out,config],sink);
    const first=JSON.parse(output.trim());assert.equal(first.completed,1);assert.equal(first.results[0].status,'truncated');
    const accounting=first.results[0].policyResources['0'];
    assert.equal(accounting.costs.length,first.results[0].decisions);
    assert.ok(accounting.milliseconds>0);
    assert.ok(accounting.milliseconds>=accounting.costs.reduce((sum:number,cost:{milliseconds:number})=>sum+cost.milliseconds,0));
    output='';await runStsSearch([out],sink);
    const resumed=JSON.parse(output.trim());assert.deepEqual(resumed.results,first.results);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('an uncommitted prior fault stops the CLI with failure status before starting another task',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-prior-fault-'));
  const previousExitCode=process.exitCode;
  let output='';const sink=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  try{
    const config=SearchRegistrationSchema.parse({id:'prior-fault',phase:'development',characters:['ironclad'],
      algorithms:['r0'],modes:['work'],gameSeeds:[918273],searchSeeds:[42],batchMilliseconds:60000});
    const tasks=searchTasks(config),files=new ExperimentFiles(directory,row=>row);
    await files.register(config,tasks);
    await files.write('attempt-'+tasks[0]!.id,{attempt:1,started:0,finished:1,status:'fault',error:'fixture-fault',cost:{milliseconds:1,steps:0}});
    await runStsSearch([directory],sink);
    const result=JSON.parse(output.trim());assert.equal(result.stopReason,'prior-fault');
    assert.equal(result.completed,0);assert.equal(process.exitCode,1);
    assert.equal(await files.read('task-'+tasks[0]!.id),null);
  }finally{process.exitCode=previousExitCode;await rm(directory,{recursive:true,force:true});}
});


test('search CLI runs R1/R2 with real weighted futures and preserves completed evidence on resume',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-current-'));
  let output='';const sink=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  try{
    const config=join(directory,'config.json'),run=join(directory,'run');
    await writeFile(config,JSON.stringify({id:'actual-current',phase:'development',characters:['ironclad'],algorithms:['r1','r2'],modes:['work'],gameSeeds:[130],searchSeeds:[42],maxSteps:2,decisions:2,worlds:2,simulations:32,batchMilliseconds:60000}));
    await runStsSearch([run,config],sink);
    const result=JSON.parse(output.trim());assert.equal(result.completed,2);
    for(const row of result.results){assert.equal(row.status,'truncated',JSON.stringify(row));assert.ok(row.searched>0);assert.ok(row.simulations>0);}
    output='';await runStsSearch([run],sink);assert.deepEqual(JSON.parse(output.trim()).results,result.results);
  }finally{await rm(directory,{recursive:true,force:true});}
});
