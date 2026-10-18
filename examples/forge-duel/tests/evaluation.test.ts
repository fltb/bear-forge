import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {baseDeck} from '../src/index.ts';
import {EvaluationSchema,runEvaluation} from '../src/evaluation/execution.ts';
import {createEvaluationTasks} from '../src/evaluation/tasks.ts';
import {analyzeEvaluation,nextEvaluationBatch,screen} from '../src/evaluation/analysis.ts';
import {ExperimentFiles,createForgeRunner,RegistrationSchema} from '../src/experiment/execution.ts';
import type {EvaluationBatch,EvaluationRow} from '../src/evaluation/evaluation.types.ts';
const changed=[...baseDeck];changed[8]='blast';
const config=()=>EvaluationSchema.parse({id:'evaluation-test',game:'forge-duel-v1',seed:91,
  decks:[{id:'base',cards:baseDeck},{id:'blast',cards:changed}],
  comparisons:[{id:'replace',kind:'replacement',baseline:'base',candidate:'blast',description:'spark -> blast'}],
  opponents:[{id:'last',deck:'base',policy:'last',weight:1}],policies:['first','rule'],discoveryBlocks:[64],confirmationMaxBlocks:2048,maxGames:20000});
const discovery:EvaluationBatch={id:'d',phase:'discovery',from:0,to:64,candidates:[],familySize:0};
function fake(batch:EvaluationBatch,effect:(policy:string,variant:string)=>number):EvaluationRow[]{
  return createEvaluationTasks(config(),batch).map(input=>({id:input.id,input,attempt:1,status:'ended',result:{scores:{[input.seat]:effect(input.policy,input.variant)}},cost:{milliseconds:1,steps:1},opportunities:{},lineage:{kind:'actual',rootTaskId:input.id,parentTaskId:null}}));
}
test('paired explicit decks, both seats, separate seeds, shared baselines and schema guards',()=>{
  const c=config();
  const tasks=createEvaluationTasks(c,discovery);
  assert.equal(tasks.length,512);
  assert.deepEqual(tasks.find(t=>t.variant==='blast'&&t.seat==='1')!.decks['1'],changed);
  const confirmation={...discovery,id:'c',phase:'confirmation' as const,candidates:['replace/first/last'],familySize:1};
  const confirmationSeeds=new Set(createEvaluationTasks(c,confirmation).map(t=>t.seed));
  assert.ok(tasks.every(t=>!confirmationSeeds.has(t.seed)));
  assert.throws(()=>EvaluationSchema.parse({...c,maxGames:1}),/Budget/);
  assert.throws(()=>EvaluationSchema.parse({...c,comparisons:[{...c.comparisons[0],candidate:'base'}]}));
  assert.throws(()=>EvaluationSchema.parse({...c,discoveryBlocks:[128,64]}));
  const shared={...c,comparisons:[...c.comparisons,{...c.comparisons[0]!,id:'second'}]};
  assert.equal(createEvaluationTasks(shared,discovery).length,tasks.length);
});
test('independent confirmation, policy dependence, equivalence and no degenerate certainty',()=>{
  const c=config(),d=fake(discovery,(p,v)=>v==='blast'?(p==='first'?1:0):(p==='first'?0:1));
  const dr=analyzeEvaluation(c,d,[discovery]);
  const candidates=screen(c,dr);assert.equal(candidates.length,2);
  const confirm:EvaluationBatch={id:'c',phase:'confirmation',from:0,to:1024,candidates,familySize:2};
  const rows=[...d,...fake(confirm,(p,v)=>v==='blast'?(p==='first'?1:0):(p==='first'?0:1))];
  const report=analyzeEvaluation(c,rows,[discovery,confirm]);
  assert.equal(report.relations.find(r=>r.policy==='first'&&r.confirmed)!.status,'positive');
  assert.equal(report.relations.find(r=>r.policy==='rule'&&r.confirmed)!.status,'negative');
  assert.equal(report.dependencies.filter(x=>x.phase==='confirmation').length,1);
  assert.ok(report.weighted.some(x=>x.phase==='confirmation'&&x.interval));
  const same=analyzeEvaluation(c,[...d,...fake({...confirm,to:2048},()=>0.5)],[discovery,{...confirm,to:2048}]);
  assert.ok(same.relations.filter(r=>r.confirmed).every(r=>r.status==='equivalent'));
  const unconfirmed=analyzeEvaluation(c,[...d,...fake(confirm,()=>0.5)],[discovery,confirm]);
  assert.deepEqual(unconfirmed.candidates,report.candidates);
  assert.throws(()=>analyzeEvaluation(c,[...rows,rows[0]!],[discovery,confirm]),/independent/);
  const missing=analyzeEvaluation(c,rows.slice(0,-1),[discovery,confirm]);
  assert.ok(missing.relations.some(r=>r.confirmed&&r.missing===1&&r.status==='unknown'));
});
test('discovery adds only whole affordable blocks; confirmation budget and candidates freeze',()=>{
  const c=config();
  const report=analyzeEvaluation(c,fake(discovery,(_,v)=>v==='blast'?1:0),[discovery]);
  const decision=nextEvaluationBatch(c,[discovery],report);
  assert.equal(decision.next!.phase,'confirmation');
  assert.ok(decision.next!.to<=2048);
  assert.ok(report.cost.tasks+createEvaluationTasks(c,decision.next!).length<=c.maxGames);
  assert.equal(nextEvaluationBatch({...c,maxGames:512},[discovery],report).reason,'insufficient-confirmation-budget');
  const empty={...report,relations:report.relations.map(r=>({...r,effect:0.01,variance:0.5,status:'unknown' as const}))};
  assert.equal(nextEvaluationBatch({...c,discoveryBlocks:[64,128,256]},[discovery],empty).next!.to,128);
  assert.equal(nextEvaluationBatch(c,[discovery],empty).next,null);
});
test('real runner resumes after durable commit, enforces budget and creates no unnecessary confirmation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-evaluation-'));
  const c={...config(),policies:['first'],maxGames:256,maxSteps:1};
  let interrupted=false;
  try{
    await assert.rejects(runEvaluation(directory,c,undefined,{point:(stage)=>{
      if(stage==='after-commit'&&!interrupted){interrupted=true;throw Error('simulated stop');}
    }}),/simulated stop/);
    const files=new ExperimentFiles(directory);
    assert.equal((await files.summaries()).length,1);
    const before=await stat(join(directory,'task-'+(await files.summaries())[0]!.id+'.bin'));
    const resumed=await runEvaluation(directory);
    assert.equal(resumed.pending,null);
    assert.equal(resumed.result!.cost.tasks,256);
    assert.equal(resumed.result!.cost.truncated,256);
    assert.equal(resumed.result!.reason,'incomplete-blocks');
    assert.equal(resumed.completed.filter(b=>b.phase==='confirmation').length,0);
    const after=await stat(join(directory,'task-'+(await files.summaries())[0]!.id+'.bin'));
    assert.equal(after.mtimeMs,before.mtimeMs);
    assert.deepEqual(await runEvaluation(directory),resumed);
    await assert.rejects(runEvaluation(directory,{...c,seed:92}),/Frozen/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('factorial conditions compose changes and detect a known synergy',()=>{
  const c=config(),repair=[...baseDeck],both=[...changed];repair[2]='repair';both[2]='repair';
  const expanded=EvaluationSchema.parse({...c,policies:['first'],decks:[...c.decks,{id:'repair',cards:repair},{id:'both',cards:both}],
    comparisons:[{id:'combo',kind:'interaction',baseline:'base',candidate:'both',xOnly:'blast',yOnly:'repair',description:'blast + repair'}]});
  const d=createEvaluationTasks(expanded,discovery);
  assert.equal(d.length,512);
  const confirm:EvaluationBatch={id:'c',phase:'confirmation',from:0,to:1024,candidates:['combo/first/last'],familySize:1};
  const rows=createEvaluationTasks(expanded,confirm).map(input=>({id:input.id,input,attempt:1,status:'ended' as const,result:{scores:{[input.seat]:input.variant==='both'?1:0}},cost:{milliseconds:1,steps:1},opportunities:{}}));
  const r=analyzeEvaluation(expanded,rows,[confirm]).relations[0]!;
  assert.equal(r.effect,1);assert.equal(r.status,'positive');
  assert.throws(()=>EvaluationSchema.parse({...expanded,decks:expanded.decks.map(d=>d.id==='both'?{...d,cards:baseDeck}:d)}),/compose|Identical/);
});

test('real Card Core executes all factorial decks in both seats and captures their actual carry facts',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-evaluation-factorial-'));
  const c=config(),repair=[...baseDeck],both=[...changed];repair[2]='repair';both[2]='repair';
  const expanded=EvaluationSchema.parse({...c,policies:['rule'],opponents:[{id:'last',deck:'base',policy:'last'}],
    decks:[...c.decks,{id:'repair',cards:repair},{id:'both',cards:both}],
    comparisons:[{id:'combo',kind:'interaction',baseline:'base',candidate:'both',xOnly:'blast',yOnly:'repair',description:'blast + repair'}]});
  const tasks=createEvaluationTasks(expanded,{...discovery,to:1});
  const runner=createForgeRunner({tasks:()=>tasks});
  const registration=RegistrationSchema.parse({version:1,game:'forge-duel-v1',id:'factorial',blocks:1,seed:91,policies:['rule'],opponents:['last'],
    maxSteps:1000,maxAttempts:1,minimumBlocks:64,margin:0.03,bootstrap:2000,analysisSeed:91});
  try{
    const result=await runner.runExperiment(directory,registration);
    assert.equal(result.results.length,8);
    for(const task of tasks){
      const row=(await result.files.read<any>('task-'+task.id))!;
      assert.equal(row.status,'ended');
      const carried=row.facts.filter((f:any)=>f.kind==='carry'&&f.actor===task.seat).map((f:any)=>f.definition).sort();
      assert.deepEqual(carried,[...task.decks[task.seat]].sort());
      assert.ok(row.decisions.length>0);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
