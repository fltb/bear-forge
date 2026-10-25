import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {describeAction} from '../src/presentation.ts';
import {createSimulator} from '../src/simulator.ts';
import {openSimulatorStore} from '../src/simulator-store.ts';
import type {EventBatch} from '../src/simulator.types.ts';
const run=promisify(execFile),fixture=fileURLToPath(new URL('./simulator-process-fixture.ts',import.meta.url));
function command(batch:EventBatch,id='test'){
  const r=batch.state.request!;assert.equal(r.options.kind,'exact');if(r.options.kind!=='exact')throw Error('exact');
  return {id,sessionId:batch.state.sessionId,revision:batch.revision,action:r.options.values[0]};
}

test('one Context: boundary input rejection, serialized duplicate, failure retry and isolation',async()=>{
  const dirs=await Promise.all([1,2].map(()=>mkdtemp(join(tmpdir(),'sts-session-'))));
  const stores=await Promise.all(dirs.map(p=>openSimulatorStore(p,'new')));let fail=false,failPending=false;
  const wrapped={...stores[0]!,pending:async(sessionId:string,revision:number)=>{await stores[0]!.pending(sessionId,revision);if(failPending)throw Error('pending sync failed');},commit:async(...args:Parameters<typeof stores[0]['commit']>)=>{if(fail)throw Error('disk full');await stores[0]!.commit(...args);}};
  const a=await createSimulator({store:wrapped,setup:{seed:'574853884',character:'ironclad'}}),b=await createSimulator({store:stores[1]!,setup:{seed:'574853884',character:'ironclad'}});
  try{
    const initial=await a.observe(),other=await b.observe(),c=command(initial);
    await assert.rejects(createSimulator({store:wrapped,setup:{seed:'130'}}),/已属于/);
    failPending=true;assert.equal((await a.act(c)).accepted,false);assert.deepEqual(await a.observe(),initial);
    failPending=false;await a.save();assert.equal((await stores[0]!.read()).revision,0,'live current save repairs an uncertain pre-execution marker without replay');
    for(const input of [{...c,action:{bits:-1}},{...c,action:null},{...c,revision:12},{...c,sessionId:'foreign'},{...c,action:{bits:0,extra:true}}])assert.equal((await a.act(input)).accepted,false);
    assert.deepEqual(await a.observe(),initial);
    const both=await Promise.all([a.act(c),a.act(c)]);assert.ok(both.every(r=>r.accepted));assert.equal(both[1]!.accepted&&both[1]!.duplicate,true);
    assert.equal((await a.observe()).revision,1);assert.deepEqual(await b.observe(),other);
    assert.equal((await a.act({...c,id:'stale'})).accepted,false);
    assert.equal((await a.act({...c,action:{bits:999}})).accepted,false);
    fail=true;const next=command(await a.observe(),'failed-save'),response=await a.act(next);
    assert.equal(response.accepted,true);if(!response.accepted)throw Error('Expected accepted action');assert.equal(response.saved,false);
    const current=await a.observe();assert.equal(current.revision,2);assert.equal((await a.act(command(current,'blocked'))).accepted,false);
    assert.equal((await a.act(next)).accepted,true);assert.equal((await a.observe()).revision,2);
    fail=false;await a.save();assert.equal((await a.act(next)).accepted,true);
    const record=await stores[0]!.read();assert.equal(record.revision,2);assert.equal(record.lastCommand!.id,'failed-save');
    assert.ok(record.context.length>1000);assert.deepEqual(record.batch,current);
    assert.ok(current.events.every((event,index)=>index===0||event.sequence===current.events[index-1]!.sequence+1));
    assert.ok(current.events.every(event=>event.actionId==='failed-save'));
    assert.equal('rng' in current.state.observation.game,false);
    if(current.state.observation.battle)assert.equal(current.state.observation.battle.draw,undefined);
    assert.ok(Object.keys(current.identities).every(key=>/^e\d+$/.test(key)));
    const detached=await a.observe();detached.state.observation.game.hp=-100;assert.notEqual((await a.observe()).state.observation.game.hp,-100);
  }finally{await a.close();await b.close();await Promise.all(dirs.map(p=>rm(p,{recursive:true,force:true})));}
});

test('storage refuses overwrite, concurrent owner, and uncommitted crash; committed marker is safe',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-durable-'));
  const store=await openSimulatorStore(dir,'new'),session=await createSimulator({store,setup:{seed:'130'}});
  try{
    await assert.rejects(openSimulatorStore(dir,'resume'),/正在被/);
    const before=await session.observe();await store.pending(before.state.sessionId,1);
    await assert.rejects(store.read(),/最新进展可能已丢失/);
    await session.save(); // No original action has executed in this test, so marker still refuses rollback.
    await assert.rejects(store.read(),/禁止恢复旧状态/);
    await session.close();
    await assert.rejects(openSimulatorStore(dir,'new'),/空存档目录/);
    await assert.rejects(openSimulatorStore(dir,'resume'),/禁止恢复旧状态/);
    assert.ok((await readFile(join(dir,'current.sts'))).length>0);
  }finally{await session.close();await rm(dir,{recursive:true,force:true});}
});

for(const prefix of ['normal','middle'])test(`${prefix}: close process, restore exact Context without initialization, then advance once`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-cold-'));
  try{
    const first=JSON.parse((await run(process.execPath,['--experimental-strip-types',fixture,prefix+'-create',dir],{maxBuffer:8*1024*1024})).stdout);
    const next=JSON.parse((await run(process.execPath,['--experimental-strip-types',fixture,prefix+'-resume',dir],{maxBuffer:8*1024*1024})).stdout);
    assert.deepEqual(first.before.state.observation,next.before.state.observation);
    assert.equal(first.before.state.sessionId,next.before.state.sessionId);
    assert.equal(first.before.revision,next.before.revision);assert.equal(next.after.revision,next.before.revision+1);
    assert.deepEqual(first.before.events,next.before.events);assert.equal(first.before.cursor,next.before.cursor);
    if(prefix==='middle'){
      assert.equal(next.before.state.observation.battle.select.task,'SECRET_TECHNIQUE');
      assert.equal(next.after.state.observation.battle.select,undefined);
      assert.equal(next.after.state.observation.battle.hand.some((c:{id:string})=>c.id==='SECRET_TECHNIQUE'),false);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('original production run reaches real death; terminal input cannot advance or restart it',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-terminal-')),store=await openSimulatorStore(dir,'new');
  const session=await createSimulator({store,setup:{seed:'574853884',character:'ironclad'}});
  try{
    let batch=await session.observe();
    // Explicit acceptance inputs: Neow colorless offer, leave reward, enter first
    // monster, then end turns. This is not a shipped player policy or a replay.
    for(let step=0;batch.state.request;step++){
      assert.ok(step<30,'the fixture must reach actual death, never a manufactured cutoff');
      const request=batch.state.request;assert.equal(request.options.kind,'exact');if(request.options.kind!=='exact')throw Error('exact');
      const kind=batch.state.observation.battle?'end-turn':batch.state.observation.game.screen==='REWARDS'?'leave':batch.state.observation.game.screen==='MAP_SCREEN'?'travel':'neow';
      const action=request.options.values.find(value=>describeAction(batch.state.observation,(value as {bits:number}).bits).kind===kind);assert.ok(action);
      const response=await session.act({id:'acceptance-'+step,sessionId:batch.state.sessionId,revision:batch.revision,action});assert.ok(response.accepted);if(!response.accepted)throw Error('not accepted');batch=response.batch;
    }
    assert.equal(batch.state.termination,'death');assert.equal(batch.state.result!.hp,0);
    assert.equal((await session.act({id:'after-end',sessionId:batch.state.sessionId,revision:batch.revision,action:{bits:0}})).accepted,false);
    assert.deepEqual(await session.observe(),batch);await session.close();
    const restored=await createSimulator({store:await openSimulatorStore(dir,'resume'),resume:true});
    try{assert.deepEqual((await restored.observe()).state.result,batch.state.result);assert.equal((await restored.observe()).state.request,null);}finally{await restored.close();}
  }finally{await session.close();await rm(dir,{recursive:true,force:true});}
});

test('accepted Policy memory and independent random cursor survive autosave and direct restore',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-policy-state-'));let session=await createSimulator({store:await openSimulatorStore(dir,'new'),setup:{seed:'574853884'}});
  const policy:import('@bear-forge/policies').Policy={version:'acceptance-memory/1',encoderVersion:'public/1',async decide(input){
    const n=Number(input.memory??0);assert.equal(input.random.position,n);
    assert.equal(input.request.options.kind,'exact');if(input.request.options.kind!=='exact')throw Error('exact');
    return {action:input.request.options.values[0]!,nextMemory:n+1,nextRandom:{state:42,position:n+1},policyVersion:this.version,encoderVersion:this.encoderVersion,logProbability:null};
  }};
  try{
    assert.equal((await session.decide(policy,new AbortController().signal)).accepted,true);await session.close();
    const store=await openSimulatorStore(dir,'resume');session=await createSimulator({store,resume:true});
    assert.equal((await session.decide(policy,new AbortController().signal)).accepted,true);
    const save=await store.read();assert.equal(save.policyState.memory,2);assert.equal(save.policyState.random.position,2);
  }finally{await session.close();await rm(dir,{recursive:true,force:true});}
});
