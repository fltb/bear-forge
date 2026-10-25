import {SearchSession} from '../../policies/src/search/session.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Writable} from 'node:stream';
import {runStsSearch} from '../src/sts-search.ts';
import {ExperimentFiles} from '@bear-forge/experiments';
import {searchRegistration} from '@bear-forge/sts';
import {searchTasks} from '../../../examples/sts/src/search/experiment.ts';
// These fixtures exercise scheduling/cancellation/storage, not process RSS.
// Shared test-process imports must not preempt the boundary under assertion;
// memory-pressure behavior has separate controlled runner regressions.
const input={id:'exact-cli',phase:'development',characters:['ironclad'],gameSeeds:[918273],policySeeds:[42],batchMilliseconds:120000,memoryBudgetMB:4096};

test('CLI scheduling exhaustion saves a current continuation and resume advances the same attempt',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-cli-'));
  let output='';const sink=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  try{
    const config=join(directory,'config.json'),out=join(directory,'experiment');
    const registration=searchRegistration({...input,maxSteps:1,checkpointEvery:1});
    await writeFile(config,JSON.stringify(registration));await runStsSearch([out,config],sink);
    const first=JSON.parse(output.trim());assert.equal(first.completed,0);assert.equal(first.stopReason,'search-incomplete:scheduling-step-yield');
    const files=new ExperimentFiles(out,row=>row),id=searchTasks(registration)[0]!.id,before:any=await files.read('checkpoint-'+id);
    assert.equal(before.step,1);assert.equal(await files.read('task-'+id),null);
    assert.ok(before.policyResources['0'].milliseconds>0);
    output='';await runStsSearch([out],sink);
    const resumed=JSON.parse(output.trim());assert.equal(resumed.completed,0);assert.equal(resumed.stopReason,'search-incomplete:scheduling-step-yield');
    const after:any=await files.read('checkpoint-'+id),attempt:any=await files.read('attempt-'+id);
    assert.equal(after.step,2);assert.equal(attempt.attempt,1);assert.equal(attempt.status,'incomplete');
    assert.deepEqual(after.decisions.slice(0,before.decisions.length),before.decisions);
    assert.equal(after.decisions.length,before.decisions.length+1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('an uncommitted prior fault stops the CLI before starting another task',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-prior-fault-')),previousExitCode=process.exitCode;
  let output='';const sink=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  try{
    const config=searchRegistration({...input,id:'prior-fault'}),tasks=searchTasks(config),files=new ExperimentFiles(directory,row=>row);
    await files.register(config,tasks);await files.write('attempt-'+tasks[0]!.id,{attempt:1,started:0,finished:1,status:'fault',error:'fixture-fault',cost:{milliseconds:1,steps:0}});
    await runStsSearch([directory],sink);
    const result=JSON.parse(output.trim());assert.equal(result.stopReason,'prior-fault');assert.equal(result.completed,0);assert.equal(process.exitCode,1);
    assert.equal(await files.read('task-'+tasks[0]!.id),null);
  }finally{process.exitCode=previousExitCode;await rm(directory,{recursive:true,force:true});}
});

test('CLI cancellation preserves the unfinished production probability graph and restores it directly',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-frontier-')),write=ExperimentFiles.prototype.write;
  let output='';const sink=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  const registration=searchRegistration({...input,gameSeeds:[130],schedulingMilliseconds:1,maxSteps:32,checkpointEvery:0});
  const id=searchTasks(registration)[0]!.id;
  const stepLocal=SearchSession.prototype.stepLocal;
  SearchSession.prototype.stepLocal=function(){const result=stepLocal.call(this);process.emit('SIGINT');return result;};
  try{
    const config=join(directory,'config.json'),out=join(directory,'experiment');await writeFile(config,JSON.stringify(registration));
    await runStsSearch([out,config],sink);const first=JSON.parse(output.trim());
    assert.equal(first.completed,0);assert.equal(first.cancelled,true);assert.equal(first.stopReason,'search-incomplete:cancelled');
    const files=new ExperimentFiles(out,row=>row),before:any=await files.read('checkpoint-'+id);
    assert.ok(before.policyWork['0'].entries[0].search.steps>0n);assert.equal(await files.read('task-'+id),null);
    output='';await runStsSearch([out],sink);const resumed=JSON.parse(output.trim());assert.equal(resumed.completed,0);
    const after:any=await files.read('checkpoint-'+id);
    assert.ok(after.policyWork['0'].entries[0].search.steps>before.policyWork['0'].entries[0].search.steps);
    assert.deepEqual(after.decisions,before.decisions);assert.deepEqual(after.policy,before.policy);
  }finally{SearchSession.prototype.stepLocal=stepLocal;ExperimentFiles.prototype.write=write;await rm(directory,{recursive:true,force:true});}
});

test('CLI reports a live persistence wait and publishes the same unfinished step once storage recovers',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-write-wait-')),write=ExperimentFiles.prototype.write;
  let output='',fail=true;const sink=new Writable({write(chunk,_encoding,done){output+=String(chunk);done();}});
  const registration=searchRegistration({...input,id:'write-wait',maxSteps:1,checkpointEvery:1});
  const id=searchTasks(registration)[0]!.id;
  ExperimentFiles.prototype.write=async function(key,value){
    if(key==='checkpoint-'+id&&fail){fail=false;throw Error('fixture-checkpoint-unavailable');}
    await write.call(this,key,value);
  };
  try{
    const config=join(directory,'config.json'),out=join(directory,'experiment');await writeFile(config,JSON.stringify(registration));
    await runStsSearch([out,config],sink);
    const lines=output.trim().split('\n').map(line=>JSON.parse(line));assert.equal(lines.length,2);
    assert.deepEqual(lines[0],{status:'persistence-wait',durable:false,taskId:id,stage:'checkpoint',failures:1,error:'Error: fixture-checkpoint-unavailable'});
    assert.equal(lines[1].completed,0);assert.equal(lines[1].stopReason,'search-incomplete:scheduling-step-yield');
    const files=new ExperimentFiles(out,row=>row),saved:any=await files.read('checkpoint-'+id),active:any=await files.read('active-work-'+id);
    assert.equal(saved.step,1);assert.equal(saved.commits.length,1);assert.equal(saved.decisions.length,1);assert.equal(saved.workToken,active.token);
    assert.equal(await files.read('task-'+id),null);
  }finally{ExperimentFiles.prototype.write=write;await rm(directory,{recursive:true,force:true});}
});
