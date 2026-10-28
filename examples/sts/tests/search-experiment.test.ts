import {SearchSession} from '@bear-forge/policies/search/session';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardMachine,CardProgram} from '@bear-forge/card-engine';
import {searchRegistration,searchTasks,createSearchExperiment,summarizeSearch} from '../src/search/experiment.ts';
import {createSearchPolicy} from '../src/search/policy.ts';
import {ExperimentFiles} from '@bear-forge/experiments';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const input={id:'exact-search',phase:'pilot',characters:['ironclad','volibear'],gameSeeds:[1234567],policySeeds:[6789],batchMilliseconds:60_000};

test('summary counts newly performed search work across adopted roots without counting forced actions as searches',()=>{
 const task=searchTasks(searchRegistration(input))[0]!;
 const common={algorithm:'exact-current-combat',method:'retained-information-sets',status:'proven-action',pendingEdges:0};
 const evidence=[{...common,steps:'100',decisionSteps:'100'},
  {algorithm:'exact-current-combat',method:'forced-action',status:'selected',searchComplete:false},
  {...common,steps:'127',decisionSteps:'27'},
  {...common,steps:'127',decisionSteps:'0'}];
 const summary=summarizeSearch({id:task.id,input:task,attempt:1,status:'ended',result:null,packets:[],facts:[],policy:{},
  decisions:evidence.map(value=>({proposal:{nextMemory:{evidence:value}}})),cost:{milliseconds:1,steps:4}});
 assert.equal(summary.decisions,4);assert.equal(summary.searched,3);assert.equal(summary.provenDecisions,3);assert.equal(summary.searchSteps,'127');
 for(const method of ['conservative-local-utility','public-prior-local-utility']){
 const local=summarizeSearch({id:task.id,input:task,attempt:1,status:'ended',result:null,packets:[],facts:[],policy:{},
  decisions:[{proposal:{nextMemory:{evidence:{algorithm:'local-current-combat',method,status:'estimated-action',searchComplete:false,steps:'5',pendingEdges:20}}}}],cost:{milliseconds:1,steps:1}});
 assert.equal(local.searched,1);assert.equal(local.estimatedDecisions,1);assert.equal(local.provenDecisions,0);assert.equal(local.exhaustedFrontiers,0);assert.equal(local.searchSteps,'5');
 }
});

test('continuous defaults spend milliseconds on a decision and do not schedule checkpoints',()=>{
 const config=searchRegistration(input);assert.equal(config.schedulingMilliseconds,100);assert.equal(config.checkpointEvery,0);
 assert.equal(config.maxSteps,Number.MAX_SAFE_INTEGER);assert.equal(config.taskMilliseconds,Number.MAX_SAFE_INTEGER);
});

test('tasks pair actual games with adventure preference cursors, not sampled future worlds',()=>{
  const tasks=searchTasks(searchRegistration({...input,policySeeds:[6789,7890]}));
  assert.equal(tasks.length,4);assert.ok(tasks.every(t=>t.gameSeed===1234567));
  assert.deepEqual(tasks.map(t=>t.seed),[6789,7890,6789,7890]);
  assert.ok(tasks.every(t=>!('algorithm' in t)&&!('limits' in t)&&!('mode' in t)));
});

test('development counts and scheduling resources do not impose search-space or total-run limits',()=>{
  for(const phase of ['development','confirmation']){
    const parsed=searchRegistration({...input,phase,gameSeeds:Array.from({length:40},(_,i)=>1000+i),policySeeds:[1,2,3],
      schedulingMilliseconds:2500,maxSteps:5000,taskMilliseconds:2_000_000,batchMilliseconds:2_000_000,memoryBudgetMB:2048,concurrency:2});
    assert.equal(parsed.gameSeeds.length,40);assert.equal(parsed.policySeeds.length,3);assert.equal(parsed.maxSteps,5000);
  }
});

test('production saves unfinished combat work and cold-resumes it without accepting a fallback or replaying setup',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-exact-search-recovery-'));
  const files=new ExperimentFiles(directory,row=>row),write=ExperimentFiles.prototype.write,initial=CardProgram.prototype.initial;
  const advance=CardMachine.prototype.advance,scheduled=CardMachine.prototype.advanceScheduled,stepLocal=SearchSession.prototype.stepLocal;
  SearchSession.prototype.stepLocal=function(){const result=stepLocal.call(this);controller.abort();return result;};
  let starts=0,realSlices=0,controller=new AbortController(),checkpoint:any;
  const config=searchRegistration({...input,phase:'development',characters:['ironclad'],gameSeeds:[130],
    schedulingMilliseconds:1,maxSteps:32,checkpointEvery:0,taskMilliseconds:120_000,batchMilliseconds:120_000});
  const id=searchTasks(config)[0]!.id,runner=createSearchExperiment();
  CardProgram.prototype.initial=function(...args:Parameters<typeof initial>){starts++;return initial.apply(this,args);};
  CardMachine.prototype.advance=function(){throw Error('Search experiments cannot use a cumulative fault budget');};
  CardMachine.prototype.advanceScheduled=function(...args:Parameters<typeof scheduled>){realSlices++;return scheduled.apply(this,args);};
  ExperimentFiles.prototype.write=async function(key,value){
    await write.call(this,key,value);
    const saved=value as any;
    if(key==='checkpoint-'+id&&saved.policyWork?.['0']?.entries.length){checkpoint=saved;}
  };
  try{
    const first=await runner.runExperiment(directory,config,undefined,{signal:controller.signal});
    assert.deepEqual(first.results,[]);assert.equal(first.stopReason,'search-incomplete:cancelled');assert.ok(checkpoint);
    const before:any=await files.read('checkpoint-'+id),search=before.policyWork['0'].entries[0].search;
    assert.ok(search.steps>0n);assert.ok(search.queue.length>0);assert.equal(await files.read('task-'+id),null);
    assert.ok(before.policyResources['0'].costs.length>before.decisions.length,'suspended work is charged without an accepted proposal');
    assert.equal(before.policy.actors['0'].memory.searchMilliseconds,undefined);
    assert.ok(before.decisions.every((d:any)=>d.proposal.nextMemory.evidence.algorithm==='public-adventure'||d.proposal.nextMemory.evidence.status==='proven-action'||d.proposal.nextMemory.evidence.method==='forced-action'));
    assert.equal(starts,1);assert.ok(realSlices>0);const beforeSlices=realSlices;
    controller=new AbortController();const resumed=await runner.runExperiment(directory,undefined,undefined,{signal:controller.signal});
    assert.deepEqual(resumed.results,[]);assert.equal(resumed.stopReason,'search-incomplete:cancelled');
    const after:any=await files.read('checkpoint-'+id),attempt:any=await files.read('attempt-'+id);
    assert.equal(after.policyWork['0'].entries.length,before.policyWork['0'].entries.length);
    assert.ok(after.policyWork['0'].entries[0].search.steps>search.steps,'restoration cost cannot starve expansion');
    assert.deepEqual(after.decisions,before.decisions);assert.deepEqual(after.policy,before.policy);
    assert.ok(after.policyResources['0'].milliseconds>=before.policyResources['0'].milliseconds);
    assert.equal(attempt.attempt,1);assert.equal(attempt.status,'incomplete');assert.equal(starts,1);
    assert.equal(realSlices,beforeSlices,'resuming unfinished search must not advance the actual game again');
  }finally{SearchSession.prototype.stepLocal=stepLocal;ExperimentFiles.prototype.write=write;CardProgram.prototype.initial=initial;CardMachine.prototype.advance=advance;CardMachine.prototype.advanceScheduled=scheduled;await rm(directory,{recursive:true,force:true});}
});
