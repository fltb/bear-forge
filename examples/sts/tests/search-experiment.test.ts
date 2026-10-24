import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchRegistrationSchema,searchTasks,createSearchExperiment} from '../src/search/experiment.ts';
import {ExperimentFiles} from '@bear-forge/experiments';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const input={id:'bounded-search',phase:'pilot',characters:['ironclad','volibear'],algorithms:['r0','r1','r2'],modes:['work','wall'],gameSeeds:[1234567],searchSeeds:[6789],batchMilliseconds:100};
test('search tasks pair game seeds independently of policy random seeds and preserve both cost modes',()=>{
  const tasks=searchTasks(SearchRegistrationSchema.parse(input));
  assert.equal(tasks.length,12);
  assert.ok(tasks.every(t=>t.seed===6789&&t.gameSeed===1234567));
  assert.deepEqual(tasks.slice(0,3).map(t=>t.algorithm),['r0','r1','r2']);
  assert.ok(tasks.some(t=>t.mode==='wall')&&tasks.some(t=>t.mode==='work'));
});
test('registration rejects expanded budgets, duplicate seeds, and known confirmation contamination',()=>{
  for(const patch of [{concurrency:2},{worlds:9},{attempts:65},{milliseconds:2001},{maxAttempts:2},{stopOnFault:false},
    {gameSeeds:[130]},{gameSeeds:[1,1]},{gameSeeds:[1234567],excludedGameSeeds:[1234567]},
    {phase:'development',batchMilliseconds:600001},{phase:'development',gameSeeds:Array.from({length:9},(_,i)=>i)}]){
    assert.equal(SearchRegistrationSchema.safeParse({...input,...patch}).success,false,JSON.stringify(patch));
  }
});

test('search host costs are checkpointed separately from deterministic accepted policy memory',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-costs-'));
  const files=new ExperimentFiles(directory,row=>row);
  let checkpoint:any;
  try {
    const config=SearchRegistrationSchema.parse({...input,phase:'development',characters:['ironclad'],
      algorithms:['r0'],modes:['work'],maxSteps:2,checkpointEvery:1,batchMilliseconds:60_000});
    const result=await createSearchExperiment().runExperiment(directory,config,undefined,{
      point:async(stage,id)=>{if(stage==='before-commit')checkpoint=await files.read('checkpoint-'+id);},
    });
    assert.equal(result.results.length,1);assert.ok(checkpoint);
    const finalResources=result.results[0]!.policyResources!;
    assert.deepEqual(finalResources['0']!.costs,checkpoint.policyResources['0'].costs);
    assert.ok(finalResources['0']!.milliseconds>=checkpoint.policyResources['0'].milliseconds,'the checkpoint write tail remains charged in the live account');
    assert.ok(checkpoint.policyResources['0'].milliseconds>0);
    assert.equal(checkpoint.policyResources['0'].costs.length,checkpoint.decisions.length);
    assert.ok(checkpoint.policyResources['0'].costs.every((cost:any)=>cost.phases.projection.calls===1));
    assert.equal(checkpoint.policy.actors['0'].memory.searchMilliseconds,undefined);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a durable task resumes within maxAttempts=1 and conservatively charges unknown interrupted work',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-recovery-'));
  try {
    for(const interrupted of [false,true]){
      const output=join(directory,String(interrupted)),files=new ExperimentFiles(output,row=>row);
      const config=SearchRegistrationSchema.parse({...input,phase:'development',characters:['ironclad'],
        algorithms:['r0'],modes:['work'],maxSteps:3,checkpointEvery:1,taskMilliseconds:10_000,batchMilliseconds:60_000});
      const id=searchTasks(config)[0]!.id,runner=createSearchExperiment();
      let advances=0;
      await assert.rejects(runner.runExperiment(output,config,undefined,{point:stage=>{
        if(stage==='before-advance'&&++advances===2&&interrupted)throw Error('fixture-stop-after-durable-boundary');
        if(stage==='before-commit')throw Error('fixture-no-terminal-commit');
      }}),/fixture-no-terminal-commit/);
      const checkpoint:any=await files.read('checkpoint-'+id);
      const previous:any=await files.read('attempt-'+id);
      if(interrupted){
        // A hard exit at the next before-advance boundary leaves exactly these
        // durable inputs: checkpoint plus an unfinished attempt, no final row.
        const unfinished={attempt:1,started:previous.started,status:'started'};
        await files.write('attempt-'+id,unfinished);await files.write('attempt-history-'+id+'-1',unfinished);
      }
      const result=await runner.runExperiment(output);
      assert.equal(result.results.length,1,JSON.stringify({interrupted,previous,result}));assert.equal(result.results[0]!.status,'truncated');
      const row:any=await files.read('task-'+id);
      assert.equal(row.attempt,1);assert.equal(row.attempts.length,1);
      assert.deepEqual(row.decisions,checkpoint.decisions);
      assert.deepEqual(row.policy,checkpoint.policy);
      assert.equal(row.cost.steps,checkpoint.step,'recovery must not charge an advance that never ran');
      if(interrupted){
        assert.match(row.error,/wall budget/);assert.equal(row.cost.reservedMilliseconds,10_000);
        assert.ok(row.policyResources['0'].reservedMilliseconds>0);
      }else assert.ok(row.cost.milliseconds>=previous.cost.milliseconds);
      const repeated=await runner.runExperiment(output);assert.deepEqual(repeated.results,result.results);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});


test('production R1/R2 run through the registered host with nonzero search and durable accepted evidence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-search-production-'));
  try{
    const config=SearchRegistrationSchema.parse({...input,phase:'development',gameSeeds:[130],modes:['work'],algorithms:['r1','r2'],maxSteps:3,decisions:2,simulations:32,worlds:2,checkpointEvery:1,batchMilliseconds:60_000});
    const runner=createSearchExperiment(),result=await runner.runExperiment(directory,config);
    assert.equal(result.results.length,4,JSON.stringify(result));
    const files=new ExperimentFiles(directory,row=>row);
    for(const summary of result.results){
      assert.equal(summary.status,'truncated',JSON.stringify(summary));assert.equal(summary.decisions,3);
      assert.ok(summary.searched>0);assert.ok(summary.simulations>0);assert.equal(summary.fallbacks,summary.decisions-summary.searched);
      const row:any=await files.read('task-'+summary.id);
      assert.ok(row.decisions.every((d:any)=>d.proposal.nextMemory.evidence.completed>0));
      assert.ok(row.decisions.every((d:any)=>d.proposal.nextMemory.evidence.method==='actual-current'));
      assert.equal(row.policy.actors['0'].random.position,row.decisions.at(-1).proposal.nextRandom.position);
    }
    assert.deepEqual((await runner.runExperiment(directory)).results,result.results,'committed search tasks resume without repeating actions');
  }finally{await rm(directory,{recursive:true,force:true});}
});
