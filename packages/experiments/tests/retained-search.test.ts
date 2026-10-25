import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {z} from 'zod';
import {card,type CardDefinition} from '@bear-forge/card-engine';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import type {GameContract} from '@bear-forge/contracts/authoring';
import {createScript} from '@bear-forge/policies';
import {registerPolicyWork,PolicyWorkSuspended} from '../../policies/src/search/work.ts';
import {createExperimentRunner} from '../src/runner.ts';
import {ExperimentFiles} from '../src/files.ts';
import type {Registration,TaskResult} from '../src/experiment.types.ts';

type Ports={event:{kind:'event';input:string;output:null};decision:{kind:'request';input:number;output:number}};
type G={setup:null;ports:Ports;programResult:number;view:number;player:'0';observation:number;
  actions:{move:{request:null;action:number;description:never}};event:string;playerEvent:string;result:number;control:never};
const contract:GameContract<G>={
  schemas:{view:z.number(),player:z.literal('0'),observation:z.number(),event:z.string(),playerEvent:z.string(),result:z.number(),
    actions:{move:{request:z.null(),action:z.number(),description:z.never()}}},
  ports:{event:{kind:'event',receive:event=>({events:[event],output:null})},
    decision:{kind:'request',receive:view=>({view,requests:[{key:'choice',player:'0',type:'move',data:null}]}),
      respond:(_view,_request,action)=>action===1?{valid:true,output:action}:{valid:false,reason:'action'}}},
  finish:result=>({view:result,result}),observe:view=>view,projectEvent:event=>({event}),
  inputs:{move:{options:z.object({kind:z.literal('exact'),values:z.array(z.number())}),describe:()=>({kind:'exact',values:[1]})}},
};
function fixture(workUnits:number,followingDecision=false,cooperative=false,eventBatch?:string[],reportCost=false,schedulingOnly=false){
  const counts={initializations:0,prefix:0,accepted:0,closed:0,restores:0,reductions:0,decisions:0},expanded:bigint[]=[];
  const faults:{cleanup:boolean;snapshotWrites:number;afterAccept?:(()=>void);onProject?:(()=>void);onPrepare?:(()=>Promise<void>)}={cleanup:false,snapshotWrites:0};
  const localContract:GameContract<G>={...contract,ports:{...contract.ports,event:{...contract.ports.event,
    receive:event=>eventBatch?{events:[...eventBatch],output:null}:contract.ports.event.receive(event)}},
    projectEvent(event,player){faults.onProject?.();return contract.projectEvent(event,player);}};
  const definition:CardDefinition<{accepted:number},null,Ports,number>={id:'retained-search-fixture',
    schemas:{setup:z.null(),result:z.number(),ports:{event:{input:z.string(),output:z.null()},decision:{input:z.number(),output:z.number()}}},
    initialize:()=>{counts.initializations++;return{accepted:0};},entry:'root',effects:[{id:'root',steps:[
      card.operation(()=>{counts.prefix++;}),card.request(()=>({port:'event',input:'opening'})),
      card.request(()=>({port:'decision',input:0}),'action'),
      card.operation<{accepted:number}>(s=>{s.state.accepted++;counts.accepted++;faults.afterAccept?.();}),
      ...(followingDecision?[card.request(()=>({port:'decision',input:1}),'tail'),card.operation<{accepted:number}>(s=>{s.state.accepted++;counts.accepted++;})]:[]),
      card.return(s=>s.locals.action),
    ]}]};
  const runner=createExperimentRunner<G,{id:string;seed:number},Registration,{id:string;status:string;result:unknown;cost?:TaskResult['cost']}>({
    contract:localContract,execution:{identity:{kind:'card',rule:definition.id},load:({controlled,stepBudget,snapshotDirectory})=>{
      const snapshots=snapshotDirectory?fileSnapshotStore(snapshotDirectory):undefined;
      if(snapshots){
        const remove=snapshots.remove,put=snapshots.put;
        snapshots.remove=async id=>{if(faults.cleanup){faults.cleanup=false;throw Error('fixture-old-snapshot-cleanup');}await remove(id);};
        snapshots.put=async(id,bytes)=>{if(faults.snapshotWrites>0){faults.snapshotWrites--;throw Error('fixture-snapshot-write');}await put(id,bytes);};
      }
      return createCardLoader({controlled,recordCore:false,...(cooperative?{instructionsPerSlice:1}:{stepBudget}),...(snapshots?{snapshots}:{})}).load(definition);
    }},
    parseRegistration:value=>value as Registration,tasks:()=>[{id:'a',seed:1}],setup:()=>null,
    requiresCurrent:()=>true,retainedSearch:true,
    policies:(_task,_resources,forkCurrent)=>{
      let cursor=0n;const edges:bigint[]=[],base=createScript('first');
      const policy={...base,event(memory:any){counts.reductions++;return{events:(memory.events??0)+1};},async decide(input:Parameters<typeof base.decide>[0]){
        counts.decisions++;
        if(counts.accepted===0){assert.equal(input.visibleHistory.length,eventBatch?.length??1);assert.deepEqual(input.memory,{events:eventBatch?.length??1});}
        const fork=await forkCurrent();try{const state=await fork.inspect();assert.ok(state.ok);if(!state.ok)throw Error('inspect');assert.equal(state.value.kind,'request');}finally{await fork.close();}
        if(cursor<BigInt(workUnits)){edges.push(cursor);expanded.push(cursor++);throw new PolicyWorkSuspended(schedulingOnly?'scheduling-yield':'fixture-retained-work');}
        return base.decide(input);
      }};
      registerPolicyWork(policy,{save:()=>({cursor,edges:[...edges]}),restore(value){const saved=value as {cursor:bigint;edges:bigint[]};cursor=saved.cursor;edges.push(...saved.edges);counts.restores++;},prepare:async()=>{await faults.onPrepare?.();},close(){counts.closed++;}});
      return{'0':policy};
    },
    facts:()=>[],summarize:row=>({id:row.id,status:row.status,result:row.result,...(reportCost?{cost:row.cost}:{})}),identity:async()=>({version:1}),
  });
  const config:Registration={id:'retained',engine:'controlled',maxAttempts:1,maxSteps:4,concurrency:1,
    taskMilliseconds:60_000,batchMilliseconds:60_000,memoryBudgetMB:4096,checkpointEvery:0,stopOnFault:true};
  return{runner,config,counts,expanded,faults};
}

test('a cold host resumes exact work and the actual Context in the same attempt without accepting a paused action',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-host-')),f=fixture(3),files=new ExperimentFiles(directory,row=>row);
  try{
    for(let i=0;i<3;i++){
      const result=await f.runner.runExperiment(directory,i===0?f.config:undefined);
      assert.deepEqual(result.results,[]);assert.equal(result.stopReason,'search-incomplete:fixture-retained-work');
      assert.equal(await files.read('task-a'),null);
      const checkpoint:any=await files.read('checkpoint-a'),attempt:any=await files.read('attempt-a');
      const active:any=await files.read('active-work-a');assert.equal(active.token,checkpoint.workToken);
      assert.equal(attempt.attempt,1);assert.equal(attempt.status,'incomplete');assert.equal(attempt.checkpointRequired,true);
      assert.equal(checkpoint.policyWork['0'].cursor,BigInt(i+1));
      assert.deepEqual(checkpoint.policyWork['0'].edges,Array.from({length:i+1},(_,index)=>BigInt(index)));
      assert.deepEqual(checkpoint.decisions,[]);assert.equal(checkpoint.policy.lastCommitId,null);
      assert.deepEqual(checkpoint.policy.actors['0'].memory,{});
      assert.equal(checkpoint.policy.actors['0'].history.length,0);
      assert.equal(checkpoint.routerPending.events.length,1,'the original event stays in the pending transaction');
      assert.equal(checkpoint.packets.length,0,'uncommitted packets must not be duplicated into the committed prefix');
      assert.equal(f.counts.reductions,i+1,'checkpoint saving/restoring must not invoke event reducers');
      assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);assert.equal(f.counts.accepted,0);
    }
    const done=await f.runner.runExperiment(directory);
    assert.deepEqual(done.results,[{id:'a',status:'ended',result:1}]);
    const row:any=await files.read('task-a');assert.equal(row.attempt,1);assert.equal(row.attempts.length,1);assert.equal(row.decisions.length,1);
    assert.equal(row.packets.filter((packet:any)=>packet.kind==='event').length,1);assert.equal(row.policy.actors['0'].history.length,1);
    assert.equal(f.counts.reductions,4);
    assert.deepEqual(f.expanded,[0n,1n,2n]);assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);assert.equal(f.counts.accepted,1);assert.equal(f.counts.restores,3);assert.equal(f.counts.closed,4);
    assert.deepEqual((await f.runner.runExperiment(directory)).results,done.results);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.accepted,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('cold resume releases checkpoint work inputs after the policy owns its current',async()=>{
  if(!globalThis.gc){
    await promisify(execFile)(process.execPath,['--expose-gc','--experimental-strip-types','--test','--test-name-pattern=^cold resume releases checkpoint work inputs after the policy owns its current$',fileURLToPath(import.meta.url)]);
    return;
  }
  const directory=await mkdtemp(join(tmpdir(),'retained-search-input-lifetime-')),f=fixture(1),read=ExperimentFiles.prototype.read;
  const inputs:WeakRef<object>[]=[];let checked=false,retained=-1,inspected=0;
  try{
    await f.runner.runExperiment(directory,f.config);
    ExperimentFiles.prototype.read=async function<T>(key:string):Promise<T|null>{
      const value=await read.call(this,key) as T|null;
      if(key==='checkpoint-a'&&value&&typeof value==='object'&&'policyWork' in value&&value.policyWork)inputs.push(new WeakRef(value.policyWork as object));
      return value;
    };
    const result=await f.runner.runExperiment(directory,undefined,undefined,{point:async stage=>{
      if(stage!=='before-advance'||checked)return;
      // End the jobs that created the weak references before requesting GC.
      await nextTurn();globalThis.gc!({type:'major',execution:'sync',flavor:'last-resort'});
      inspected=inputs.length;retained=inputs.filter(input=>input.deref()!==undefined).length;
      checked=true;
    }});
    assert.ok(checked);assert.deepEqual(result.results,[{id:'a',status:'ended',result:1}]);
    assert.ok(inspected>=2,'exercise both outer attempt inspection and actual restoration');
    assert.equal(retained,0,'no scheduler or loader should retain a duplicate input frontier');
    assert.deepEqual(f.expanded,[0n]);assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);assert.equal(f.counts.accepted,1);
  }finally{ExperimentFiles.prototype.read=read;await rm(directory,{recursive:true,force:true});}
});

test('search preparation completes before dirty marking and a failed restoration preserves the durable current',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-prepare-')),f=fixture(2),files=new ExperimentFiles(directory,row=>row);
  try{
    await f.runner.runExperiment(directory,f.config);
    const saved:any=await files.read('checkpoint-a'),marker=await files.read('active-work-a'),expanded=[...f.expanded];
    let prepared=false;
    f.faults.onPrepare=async()=>{
      await nextTurn();
      assert.deepEqual(await files.read('active-work-a'),marker,'restoration must not publish a new execution token');
      assert.deepEqual(f.expanded,expanded);prepared=true;throw Error('fixture-restore-unavailable');
    };
    const stopped=await f.runner.runExperiment(directory);
    assert.ok(prepared);assert.deepEqual(stopped.results,[]);
    assert.equal(stopped.stopReason,'search-incomplete:search-restore-failed: Error: fixture-restore-unavailable');
    assert.deepEqual(await files.read('checkpoint-a'),saved);assert.deepEqual(await files.read('active-work-a'),marker);
    assert.deepEqual(f.expanded,expanded);assert.equal(f.counts.accepted,0);assert.equal(await files.read('task-a'),null);
    f.faults.onPrepare=async()=>{
      await nextTurn();assert.deepEqual(await files.read('active-work-a'),marker);
    };
    const resumed=await f.runner.runExperiment(directory);
    assert.equal(resumed.stopReason,'search-incomplete:fixture-retained-work');
    assert.deepEqual(f.expanded,[0n,1n]);
    const current:any=await files.read('checkpoint-a'),active:any=await files.read('active-work-a');
    assert.notEqual(current.workToken,saved.workToken);assert.equal(current.workToken,active.token);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('memory pressure before execution retains an unstarted attempt and does not consume maxAttempts',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-prestart-')),f=fixture(0),files=new ExperimentFiles(directory,row=>row);
  const original=process.memoryUsage;let reads=0;
  try{
    // The first RSS check admits the batch; the second is immediately before
    // loading/starting this task. No game instruction has executed at the stop.
    process.memoryUsage=Object.assign(()=>({...original(),rss:++reads===2?8192*1024**2:original().rss}),{rss:original.rss});
    const paused=await f.runner.runExperiment(directory,f.config);process.memoryUsage=original;
    assert.deepEqual(paused.results,[]);assert.equal(paused.stopReason,'search-incomplete:pre-execution-memory-budget');
    const attempt:any=await files.read('attempt-a');assert.equal(attempt.checkpointRequired,false);assert.equal(attempt.attempt,1);
    assert.equal(await files.read('checkpoint-a'),null);assert.equal(f.counts.initializations,0);
    assert.deepEqual((await f.runner.runExperiment(directory)).results,[{id:'a',status:'ended',result:1}]);
    const row:any=await files.read('task-a');assert.equal(row.attempt,1);assert.equal(f.counts.initializations,1);
  }finally{process.memoryUsage=original;await rm(directory,{recursive:true,force:true});}
});

for(const reclaimed of [false,true])test(`memory pressure collects once before deciding whether the original work must pause; reclaimed=${reclaimed}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-collection-')),f=fixture(1);
  const memory=process.memoryUsage,collect=globalThis.gc;let collections=0,pressure=true;
  process.memoryUsage=Object.assign(()=>({...memory(),rss:pressure?8*1024**3:128*1024**2}),memory);
  globalThis.gc=((options:NodeJS.GCOptions)=>{assert.deepEqual(options,{type:'major',execution:'sync',flavor:'last-resort'});collections++;if(reclaimed)pressure=false;}) as typeof globalThis.gc;
  try{
    const first=await f.runner.runExperiment(directory,f.config);
    assert.equal(collections,1);
    assert.equal(first.stopReason,reclaimed?'search-incomplete:fixture-retained-work':'memory-budget');
    assert.deepEqual(f.expanded,reclaimed?[0n]:[]);assert.equal(f.counts.initializations,reclaimed?1:0);
    pressure=false;
    const second=await f.runner.runExperiment(directory);
    if(reclaimed)assert.deepEqual(second.results,[{id:'a',status:'ended',result:1}]);
    else{assert.equal(second.stopReason,'search-incomplete:fixture-retained-work');assert.deepEqual((await f.runner.runExperiment(directory)).results,[{id:'a',status:'ended',result:1}]);}
    assert.deepEqual(f.expanded,[0n]);assert.equal(f.counts.initializations,1);assert.equal(f.counts.accepted,1);assert.equal(collections,1);
  }finally{process.memoryUsage=memory;if(collect)globalThis.gc=collect;else Reflect.deleteProperty(globalThis,'gc');await rm(directory,{recursive:true,force:true});}
});

test('failure to release an obsolete snapshot retains the newly saved frontier',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-cleanup-')),f=fixture(2),files=new ExperimentFiles(directory,row=>row);
  try{
    await f.runner.runExperiment(directory,f.config);
    const before:any=await files.read('checkpoint-a');f.faults.cleanup=true;
    const paused=await f.runner.runExperiment(directory);
    assert.deepEqual(paused.results,[]);assert.match(paused.stopReason??'',/^search-incomplete:snapshot-cleanup-failed:/);
    const after:any=await files.read('checkpoint-a');assert.notEqual(after.snapshot.snapshotId,before.snapshot.snapshotId);
    assert.equal(after.policyWork['0'].cursor,2n);assert.deepEqual(after.policyWork['0'].edges,[0n,1n]);
    assert.equal(await files.read('task-a'),null);
    assert.deepEqual((await f.runner.runExperiment(directory)).results,[{id:'a',status:'ended',result:1}]);
    assert.deepEqual(f.expanded,[0n,1n]);assert.equal(f.counts.initializations,1);assert.equal(f.counts.accepted,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

for(const failure of ['snapshot','checkpoint','checkpoint-after-write'] as const)test(`failed ${failure} persistence keeps live work until the same frontier is durable`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-write-')),f=fixture(1),files=new ExperimentFiles(directory,row=>row);
  const write=ExperimentFiles.prototype.write,controller=new AbortController();
  let failures=2;const observed:{stage:string;failures:number;closed:number;accepted:number;expanded:bigint[]}[]=[],snapshotIds:string[]=[];
  if(failure==='snapshot')f.faults.snapshotWrites=2;
  ExperimentFiles.prototype.write=async function(key,value){
    if(this.directory===directory&&key==='checkpoint-a'){
      snapshotIds.push((value as any).snapshot.snapshotId);
      if(failure!=='snapshot'&&failures-->0){
        if(failure==='checkpoint-after-write')await write.call(this,key,value);
        throw Error('fixture-checkpoint-write');
      }
    }
    await write.call(this,key,value);
  };
  try{
    const result=await f.runner.runExperiment(directory,f.config,undefined,{signal:controller.signal,persistenceWait:state=>{
      observed.push({stage:state.stage,failures:state.failures,closed:f.counts.closed,accepted:f.counts.accepted,expanded:[...f.expanded]});
      controller.abort();
    }});
    assert.deepEqual(result.results,[]);assert.equal(result.stopReason,'search-incomplete:cancelled');
    assert.deepEqual(observed,[1,2].map(failures=>({stage:failure==='snapshot'?'game-snapshot':'checkpoint',failures,closed:0,accepted:0,expanded:[0n]})));
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.closed,1);assert.deepEqual(f.expanded,[0n]);
    assert.equal(new Set(snapshotIds).size,1,'checkpoint write retries must retain the already-created game snapshot');
    const checkpoint:any=await files.read('checkpoint-a');assert.deepEqual(checkpoint.policyWork['0'],{cursor:1n,edges:[0n]});
    assert.equal(await files.read('task-a'),null);
    ExperimentFiles.prototype.write=write;
    const done=await f.runner.runExperiment(directory);assert.deepEqual(done.results,[{id:'a',status:'ended',result:1}]);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);assert.equal(f.counts.accepted,1);assert.deepEqual(f.expanded,[0n]);
  }finally{ExperimentFiles.prototype.write=write;await rm(directory,{recursive:true,force:true});}
});

test('cancellation after an accepted action saves the next logical step and never accepts that action twice',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-accepted-')),f=fixture(0,true),files=new ExperimentFiles(directory,row=>row);
  const controller=new AbortController();f.faults.afterAccept=()=>controller.abort();
  try{
    const paused=await f.runner.runExperiment(directory,f.config,undefined,{signal:controller.signal});
    assert.deepEqual(paused.results,[]);assert.match(paused.stopReason??'',/^search-incomplete:/);
    const checkpoint:any=await files.read('checkpoint-a');
    assert.equal(checkpoint.step,1);assert.equal(checkpoint.commits.length,1);assert.equal(checkpoint.commits[0].logicalStep,0);
    assert.equal(checkpoint.decisions.length,1);assert.equal(f.counts.accepted,1);
    delete f.faults.afterAccept;
    const done=await f.runner.runExperiment(directory);assert.deepEqual(done.results,[{id:'a',status:'ended',result:1}]);
    const row:any=await files.read('task-a');assert.deepEqual(row.commits.map((entry:any)=>entry.logicalStep),[0,1]);
    assert.equal(row.decisions.length,2);assert.equal(f.counts.accepted,2);assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

for(const failures of [0,2])test(`original instruction cancellation persists the uncommitted accepted action and resumes it once, failed writes=${failures}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-original-current-')),f=fixture(0,true,true),files=new ExperimentFiles(directory,row=>row);
  const cancellation=new AbortController(),waits:{stage:string;accepted:number;closed:number;decisions:number}[]=[];
  f.faults.afterAccept=()=>{f.faults.snapshotWrites=failures;cancellation.abort();};
  try{
    const paused=await f.runner.runExperiment(directory,f.config,undefined,{signal:cancellation.signal,
      persistenceWait:state=>{waits.push({stage:state.stage,accepted:f.counts.accepted,closed:f.counts.closed,decisions:f.counts.decisions});}});
    assert.deepEqual(paused.results,[]);assert.equal(paused.stopReason,'search-incomplete:cancelled');
    assert.deepEqual(waits,Array.from({length:failures},()=>({stage:'game-continuation',accepted:1,closed:0,decisions:1})));
    const checkpoint:any=await files.read('checkpoint-a');assert.equal(checkpoint.step,0);assert.deepEqual(checkpoint.commits,[]);
    assert.deepEqual(checkpoint.decisions,[]);assert.deepEqual(checkpoint.packets,[]);assert.equal(checkpoint.policy.lastCommitId,null);
    assert.equal(checkpoint.routerPending.candidates.length,1);assert.equal(checkpoint.routerPending.events.length,1);
    assert.equal(checkpoint.gameContinuation.run.accepted,null);
    assert.deepEqual(checkpoint.gameContinuation.run.pending.accepted.reply.requestId,checkpoint.routerPending.candidates[0].request.id);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);assert.equal(f.counts.accepted,1);assert.equal(f.counts.decisions,1);
    const originalAccepted=checkpoint.gameContinuation.run.pending.accepted;
    delete f.faults.afterAccept;
    if(failures===0){
      f.faults.onPrepare=async()=>{throw Error('fixture-restore-after-original-continuation');};
      const stopped=await f.runner.runExperiment(directory);
      assert.equal(stopped.stopReason,'search-incomplete:search-restore-failed: Error: fixture-restore-after-original-continuation');
      const advanced:any=await files.read('checkpoint-a'),active:any=await files.read('active-work-a');
      assert.equal(advanced.step,1);assert.equal(advanced.decisions.length,1);assert.equal(advanced.workToken,active.token);
      assert.deepEqual(advanced.commits[0].accepted,originalAccepted,'the resumed original edge is durable before reporting a search preparation error');
      assert.equal(f.counts.accepted,1);assert.equal(f.counts.decisions,1);
      delete f.faults.onPrepare;
    }
    const done=await f.runner.runExperiment(directory);assert.deepEqual(done.results,[{id:'a',status:'ended',result:1}]);
    const row:any=await files.read('task-a');assert.deepEqual(row.commits.map((entry:any)=>entry.logicalStep),[0,1]);
    assert.deepEqual(row.commits[0].accepted,originalAccepted);assert.equal(row.decisions.length,2);
    assert.equal(row.packets.filter((packet:any)=>packet.kind==='event').length,1);assert.equal(row.policy.actors['0'].history.length,1);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);assert.equal(f.counts.accepted,2);assert.equal(f.counts.decisions,2);
    assert.equal(row.attempt,1);assert.equal(row.attempts.length,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('cancellation racing a local event receipt preserves the acknowledged prefix across cold restore',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-event-receipts-'));
  const f=fixture(0,false,true,['opening','second','third']),files=new ExperimentFiles(directory,row=>row);
  const cancellation=new AbortController();let projections=0;
  f.faults.onProject=()=>{
    if(++projections===1)queueMicrotask(()=>queueMicrotask(()=>cancellation.abort()));
  };
  try{
    const paused=await f.runner.runExperiment(directory,f.config,undefined,{signal:cancellation.signal});
    assert.deepEqual(paused.results,[]);assert.equal(paused.stopReason,'search-incomplete:Error: Experiment cancelled');
    const checkpoint:any=await files.read('checkpoint-a');
    assert.equal(checkpoint.gameContinuation,undefined);assert.equal(checkpoint.gameDelivery.progress.rows.length,1);
    assert.equal(checkpoint.gameDelivery.progress.rows[0].acknowledged,true);
    assert.equal(checkpoint.gameDelivery.progress.rows[0].delivery.event,'opening');
    assert.equal(checkpoint.policy.actors['0'].history.length,1);assert.equal(checkpoint.decisions.length,0);
    assert.equal(f.counts.accepted,0);assert.equal(f.counts.decisions,0);assert.equal(projections,1);
    const originalId=checkpoint.policy.actors['0'].history[0].id;
    const done=await f.runner.runExperiment(directory);assert.deepEqual(done.results,[{id:'a',status:'ended',result:1}]);
    const row:any=await files.read('task-a'),history=row.policy.actors['0'].history;
    assert.deepEqual(history.map((delivery:any)=>delivery.event),['opening','second','third']);
    assert.deepEqual(history.map((delivery:any)=>delivery.id.index),[0,1,2]);assert.deepEqual(history[0].id,originalId);
    assert.notEqual(history[1].id.instanceId,originalId.instanceId);assert.equal(history[1].id.callId,originalId.callId);
    assert.equal(history[2].id.instanceId,history[1].id.instanceId);
    assert.equal(row.packets.filter((packet:any)=>packet.kind==='event').length,3);assert.equal(projections,3);
    assert.equal(f.counts.reductions,3);assert.equal(f.counts.decisions,1);assert.equal(f.counts.accepted,1);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('terminal publication and accounting retries are charged without changing the immutable result or running another game',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-terminal-cost-')),f=fixture(0,false,false,undefined,true),files=new ExperimentFiles(directory,row=>row);
  const write=ExperimentFiles.prototype.write;let summaryFailures=2,accountingFailures=1,waited=0;
  ExperimentFiles.prototype.write=async function(key,value){
    if(this.directory===directory){
      if(key==='summary-a'&&summaryFailures-->0)throw Error('fixture-summary-cost-write');
      if(key==='attempt-a'&&(value as any).publication?.complete&&accountingFailures-->0)throw Error('fixture-accounting-cost-write');
    }
    return write.call(this,key,value);
  };
  try{
    const done=await f.runner.runExperiment(directory,f.config,undefined,{persistenceWait:async()=>{
      const start=performance.now();await new Promise(resolve=>setTimeout(resolve,30));waited+=performance.now()-start;
      assert.equal(f.counts.accepted,1);assert.equal(f.counts.initializations,1);
    }});
    const raw:any=await files.read('task-a'),attempt:any=await files.read('attempt-a'),history:any=await files.read('attempt-history-a-1'),summary:any=await files.read('summary-a');
    assert.ok(waited>0);assert.equal(attempt.publication.complete,true);
    assert.ok(attempt.publication.milliseconds>=waited,'all failed publication waits precede the final cost sample');
    assert.equal(raw.cost.publicationMilliseconds,undefined,'execution evidence is immutable after task commit');
    assert.equal(summary.cost.publicationMilliseconds,attempt.publication.milliseconds);
    assert.equal(summary.cost.milliseconds,raw.cost.milliseconds+attempt.publication.milliseconds);
    assert.deepEqual(history,attempt);assert.deepEqual(done.results,[summary]);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);assert.equal(f.counts.accepted,1);
    const counts={...f.counts};assert.deepEqual((await f.runner.runExperiment(directory)).results,done.results);
    assert.deepEqual(f.counts,counts);assert.deepEqual(await files.read('task-a'),raw);assert.deepEqual(await files.read('attempt-a'),attempt,'a complete publication is not charged again');
  }finally{ExperimentFiles.prototype.write=write;await rm(directory,{recursive:true,force:true});}
});

for(const complete of [false,true])test(`a cold terminal publication repair uses the committed result only, accounting complete=${complete}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-terminal-repair-')),f=fixture(0,false,false,undefined,true),files=new ExperimentFiles(directory,row=>row);
  try{
    await f.runner.runExperiment(directory,f.config);
    const raw:any=await files.read('task-a'),record:any=await files.read('attempt-a'),counts={...f.counts};
    // These are the two file-boundary interruption states: pending publication,
    // or completed cost records with the older derived summary still present.
    const interrupted={...record,publication:{startedAt:Date.now()-1000,milliseconds:10,complete}};
    await files.write('attempt-a',interrupted);await files.write('attempt-history-a-1',interrupted);
    await files.write('summary-a',{id:'a',status:raw.status,result:raw.result,cost:raw.cost});
    const restored=await f.runner.runExperiment(directory),attempt:any=await files.read('attempt-a');
    assert.equal(attempt.publication.complete,true);assert.ok(attempt.publication.milliseconds>=1000);
    assert.deepEqual(await files.read('task-a'),raw);assert.deepEqual(f.counts,counts,'publication repair never creates or restores a game');
    assert.equal(restored.results[0]!.cost!.milliseconds,raw.cost.milliseconds+attempt.publication.milliseconds);
    assert.deepEqual(await files.read('attempt-history-a-1'),attempt);
    const again=await f.runner.runExperiment(directory);assert.deepEqual(again.results,restored.results);assert.deepEqual(f.counts,counts);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a failed terminal summary write retries publication of the existing result without starting another game',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-result-')),f=fixture(0),files=new ExperimentFiles(directory,row=>row);
  const write=ExperimentFiles.prototype.write;let fail=true;const seen:number[]=[];
  ExperimentFiles.prototype.write=async function(key,value){
    if(this.directory===directory&&key==='summary-a'&&fail){fail=false;throw Error('fixture-summary-write');}
    await write.call(this,key,value);
  };
  try{
    const done=await f.runner.runExperiment(directory,f.config,undefined,{persistenceWait:()=>{seen.push(f.counts.accepted);}});
    assert.deepEqual(done.results,[{id:'a',status:'ended',result:1}]);assert.deepEqual(seen,[1]);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.accepted,1);assert.equal(f.counts.closed,1);
    const row:any=await files.read('task-a');assert.equal(row.decisions.length,1);
    assert.deepEqual(await files.read('summary-a'),{id:'a',status:'ended',result:1});
  }finally{ExperimentFiles.prototype.write=write;await rm(directory,{recursive:true,force:true});}
});

for(const marker of [{token:'a-later-unpublished-execution'},{}])test(`an unmatched active-work marker cannot resume an older Context: ${JSON.stringify(marker)}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-lost-tail-')),f=fixture(2),files=new ExperimentFiles(directory,row=>row);
  try{
    await f.runner.runExperiment(directory,f.config);
    const saved=await files.read('checkpoint-a'),counts={...f.counts},expanded=[...f.expanded];
    // Model the durable evidence left by an interrupted interval. No old
    // execution is run to manufacture or reconstruct its missing tail.
    await files.write('active-work-a',marker);
    for(let check=0;check<2;check++){
      const paused=await f.runner.runExperiment(directory);
      assert.deepEqual(paused.results,[]);assert.equal(paused.stopReason,'search-incomplete:uncheckpointed-current-lost');
      assert.deepEqual(await files.read('checkpoint-a'),saved);assert.deepEqual(f.counts,counts);assert.deepEqual(f.expanded,expanded);
      assert.equal(await files.read('task-a'),null);
      const attempt:any=await files.read('attempt-a');assert.equal(attempt.attempt,1);assert.equal(attempt.status,'incomplete');
      assert.equal(attempt.reason,'uncheckpointed-current-lost');
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('an interrupted first start with no checkpoint is reported as lost current rather than a new start or exhausted result',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-lost-start-')),f=fixture(0),files=new ExperimentFiles(directory,row=>row);
  try{
    await files.write('attempt-a',{attempt:1,status:'started',started:Date.now()});
    await files.write('active-work-a',{token:'interrupted-first-initialization'});
    const paused=await f.runner.runExperiment(directory,f.config);
    assert.deepEqual(paused.results,[]);assert.equal(paused.stopReason,'search-incomplete:uncheckpointed-current-lost');
    assert.equal(f.counts.initializations,0);assert.equal(f.counts.prefix,0);assert.equal(f.counts.accepted,0);
    assert.equal(await files.read('task-a'),null);assert.equal(await files.read('checkpoint-a'),null);
    const attempt:any=await files.read('attempt-a');assert.equal(attempt.attempt,1);assert.equal(attempt.status,'incomplete');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a registered attempt interrupted before its work marker may initialize once in that same attempt',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'retained-search-not-started-')),f=fixture(0),files=new ExperimentFiles(directory,row=>row);
  try{
    await files.write('attempt-a',{attempt:1,status:'started',started:Date.now()});
    const done=await f.runner.runExperiment(directory,f.config);
    assert.deepEqual(done.results,[{id:'a',status:'ended',result:1}]);
    assert.equal(f.counts.initializations,1);assert.equal(f.counts.prefix,1);assert.equal(f.counts.accepted,1);
    const row:any=await files.read('task-a');assert.equal(row.attempt,1);assert.equal(row.attempts.length,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

 test('ordinary scheduling yields continue live without intermediate checkpoint writes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'continuous-search-host-')),f=fixture(3,false,false,undefined,false,true);
 const write=ExperimentFiles.prototype.write;let checkpoints=0;
 ExperimentFiles.prototype.write=async function(key,value){if(this.directory===directory&&key==='checkpoint-a')checkpoints++;return write.call(this,key,value);};
 try{
  const result=await f.runner.runExperiment(directory,f.config);
  assert.deepEqual(result.results,[{id:'a',status:'ended',result:1}]);assert.equal(result.stopReason,null);
  assert.equal(checkpoints,0);assert.deepEqual(f.expanded,[0n,1n,2n]);assert.equal(f.counts.initializations,1);assert.equal(f.counts.accepted,1);assert.equal(f.counts.restores,0);
 }finally{ExperimentFiles.prototype.write=write;await rm(directory,{recursive:true,force:true});}
});
