import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {deserialize,serialize} from 'node:v8';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {InstanceSnapshotSchema} from '@bear-forge/contracts/persistence';
import {card,CardProgram,CardMachine,type CardDefinition} from '@bear-forge/card-engine';
import {probabilityOperation} from '../../card-engine/src/probability.ts';
import {createCardLoader} from '../src/loader.ts';
import {memorySnapshotStore} from '../src/store.ts';
import {CardGraph,privateCardGraph} from '../src/graph.ts';
import {ScheduledAdvance} from '../src/scheduled.ts';
import {Controller,type RawStop} from '../../runtime/src/instance.ts';
import {ExecutionSuspended,continuationControl,restoreContinuation} from '../../runtime/src/continuation.ts';

const unwrap=<T>(value:{ok:true;value:T}|{ok:false;error:unknown}):T=>{
  if(!value.ok)throw Error(JSON.stringify(value.error));return value.value;
};
type State={seen:number[]};
type Ports={begin:{input:null;output:number};tail:{input:number;output:number}};
type Result={seen:number[];answer:number;draw:number;tail:number};
function fixture(){
  let initialized=0,draws=0,finished=0;const executed:number[]=[];
  const draw=()=>{draws++;return 11;};
  probabilityOperation(draw,{space:()=>{throw Error('Real execution cannot read a probability law');},resolve:()=>{throw Error('Real execution cannot choose a probability coordinate');}});
  const definition:CardDefinition<State,void,Ports,Result>={id:'scheduled-original-execution',
    schemas:{setup:z.undefined(),result:z.object({seen:z.array(z.number()),answer:z.number(),draw:z.number(),tail:z.number()}),
      ports:{begin:{input:z.null(),output:z.number()},tail:{input:z.number(),output:z.number()}}},
    initialize:()=>{initialized++;return{seen:[]};},entry:'root',effects:[
      {id:'root',steps:[
        card.request(()=>({port:'begin',input:null}),'answer'),
        card.operation<State>(scope=>scope.state.seen,'alias'),
        card.forEach(()=>[1,2,3,4,5],'nested'),
        card.operation<State>(scope=>{assert.equal(scope.locals.alias,scope.state.seen);}),
        card.operation(draw,'draw'),card.request(scope=>({port:'tail',input:scope.locals.answer}),'tail'),
        card.operation<State>(scope=>{assert.equal(scope.locals.alias,scope.state.seen);finished++;}),
        card.return<State>(scope=>({seen:scope.state.seen,answer:scope.locals.answer,draw:scope.locals.draw,tail:scope.locals.tail})),
      ]},
      {id:'nested',steps:[card.invoke('leaf',scope=>scope.input),card.return()]},
      {id:'leaf',steps:[card.operation<State>(scope=>{executed.push(scope.input);scope.state.seen.push(scope.input);}),card.return()]},
    ],
  };
  return{definition,counts:()=>({initialized,draws,finished,executed:[...executed]})};
}

test('renewable execution rejects ambiguous or invalid scheduling configuration',()=>{
  for(const instructionsPerSlice of [0,-1,Infinity,1.5,NaN])assert.throws(()=>createCardLoader({instructionsPerSlice}),/instruction slice/);
  assert.throws(()=>createCardLoader({instructionsPerSlice:1,stepBudget:100}),/renewable scheduling/);
});

for(const controlled of [false,true])test(`real execution yields between original instructions without a cumulative cutoff, controlled=${controlled}`,async()=>{
  const f=fixture(),loaded=unwrap(await createCardLoader({controlled,recordCore:true,instructionsPerSlice:1}).load(f.definition));
  const instance=unwrap(await loaded.core.start(undefined)),initial=CardProgram.prototype.initial;
  let pending:ReturnType<typeof instance.run>|undefined;
  try{
    CardProgram.prototype.initial=function(){throw Error('Scheduling cannot restart the program');};
    unwrap(await instance.bind({begin:async()=>({kind:'reply',value:7})}));
    let settled=false;
    pending=instance.run().then(value=>{settled=true;return value;});
    await yieldTurn();
    assert.equal(settled,false,'the original nested work must let the host run between slices');
    if(controlled){const busy=await loaded.persistence!.save(instance);assert.equal(busy.ok,false);}
    assert.equal(unwrap(await pending).accepted,true);
    const tail=unwrap(await instance.inspect());assert.equal(tail.kind,'call');
    if(tail.kind!=='call')throw Error('Missing original tail request');
    assert.deepEqual(tail.call,{port:'tail',input:7});
    assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:0,executed:[1,2,3,4,5]});
    unwrap(await instance.bind({tail:async()=>({kind:'reply',value:3})}));assert.equal(unwrap(await instance.run()).accepted,true);
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'done',result:{seen:[1,2,3,4,5],answer:7,draw:11,tail:3}});
    assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:1,executed:[1,2,3,4,5]});
    const records=unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})).records;
    assert.deepEqual(records.map(row=>row.kind),['started','called','returned','called','returned','completed']);
    assert.deepEqual(records.filter(row=>row.kind==='returned').map(row=>row.reply.output),[7,3]);
  }finally{await pending?.catch(()=>undefined);CardProgram.prototype.initial=initial;unwrap(await instance.close());unwrap(await loaded.capture!.release(instance.id));}
});

test('cold continuation can change scheduling quantum but cannot silently reintroduce a cumulative fault budget',async()=>{
  const f=fixture(),store=memorySnapshotStore();
  const loaded=unwrap(await createCardLoader({snapshots:store,instructionsPerSlice:1,recordCore:false}).load(f.definition));
  let instance=unwrap(await loaded.core.start(undefined));
  const initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Cold continuation cannot initialize');};
    unwrap(await instance.bind({begin:async()=>({kind:'reply',value:7})}));unwrap(await instance.run());
    const current=unwrap(await instance.inspect()),saved=unwrap(await loaded.persistence!.save(instance));
    const data=deserialize((await store.get(saved.snapshotId))!);
    assert.equal(data.cooperative,true);assert.equal(data.root.budget,0);
    const counts=f.counts();unwrap(await instance.close());
    const bounded=unwrap(await createCardLoader({snapshots:store,recordCore:false}).load(f.definition));
    const rejected=await bounded.persistence!.restore(saved);assert.equal(rejected.ok,false);
    assert.deepEqual(f.counts(),counts);
    const resumed=unwrap(await createCardLoader({snapshots:store,instructionsPerSlice:3,recordCore:false}).load(f.definition));
    instance=unwrap(await resumed.persistence!.restore(saved));assert.deepEqual(unwrap(await instance.inspect()),current);
    assert.deepEqual(f.counts(),counts);
    unwrap(await instance.bind({tail:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'done',result:{seen:[1,2,3,4,5],answer:7,draw:11,tail:3}});
    assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:1,executed:[1,2,3,4,5]});
    unwrap(await resumed.persistence!.release(saved));
  }finally{CardProgram.prototype.initial=initial;unwrap(await instance.close());}
});

test('private original instruction currents restore without initialization or probability replacement',()=>{
  const f=fixture(),program=new CardProgram(f.definition);
  let work=new ScheduledAdvance(new CardMachine(program,privateCardGraph(program.initial(undefined,0)))),slices=0;
  try{
    assert.throws(()=>work.save(),/No committed/);
    work.step(1);assert.deepEqual(work.current(),{kind:'call',call:{port:'begin',input:null}});
    work=new ScheduledAdvance(work.machine,7);
    while(!work.ready){
      work.step(1);const snapshot=deserialize(serialize(work.save())),counts=f.counts();
      assert.equal(snapshot.kernel,'original');assert.equal(snapshot.root.budget,0);
      if(snapshot.root.stop.kind==='yield'){
        slices++;assert.throws(()=>program.validate(snapshot.root),/snapshot root/);
        const wrongPhase=deserialize(serialize(snapshot));wrongPhase.phase='ready';
        assert.throws(()=>ScheduledAdvance.restore(program,wrongPhase),/phase disagrees/);
        const wrongKernel=deserialize(serialize(snapshot));wrongKernel.kernel='probability';
        assert.throws(()=>ScheduledAdvance.restore(program,wrongKernel),/Invalid original/);
        const chance=deserialize(serialize(snapshot));chance.root.stop={kind:'chance',space:{kind:'uniform',size:2n}};
        assert.throws(()=>ScheduledAdvance.restore(program,chance),/Invalid original execution Context/);
      }
      work.machine.storage.close?.();work=ScheduledAdvance.restore(program,snapshot);
      assert.deepEqual(f.counts(),counts,'restoring the current must execute neither initializers nor original operations');
    }
    assert.ok(slices>1);assert.deepEqual(work.current(),{kind:'call',call:{port:'tail',input:7}});
    work=new ScheduledAdvance(work.machine,3);while(!work.ready)work.step(2);
    assert.deepEqual(work.current(),{kind:'done',result:{seen:[1,2,3,4,5],answer:7,draw:11,tail:3}});
    assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:1,executed:[1,2,3,4,5]});
  }finally{work.machine.storage.close?.();}
});

for(const kind of ['yield','call','done'] as const)test(`failed original ${kind} publication preserves the committed current for cold continuation`,()=>{
  const f=fixture(),program=new CardProgram(f.definition);
  let work=new ScheduledAdvance(new CardMachine(program,privateCardGraph(program.initial(undefined,0))));
  work.step(1);work=new ScheduledAdvance(work.machine,7);
  if(kind==='done'){while(!work.ready)work.step(1);work=new ScheduledAdvance(work.machine,3);}
  const exporter=CardGraph.prototype.export;let failed=false;
  CardGraph.prototype.export=function<T>(value:T):T{
    if(!failed&&value&&typeof value==='object'&&(value as {kind?:string}).kind===kind){failed=true;throw Error('publication interrupted');}
    return exporter.call(this,value) as T;
  };
  try{
    assert.throws(()=>{while(!work.ready)work.step(1);},/publication interrupted/);assert.equal(failed,true);
    CardGraph.prototype.export=exporter;
    assert.equal(work.machine.root.stop.kind,kind,'export errors cannot replace the original current with a fault');
    const saved=deserialize(serialize(work.save())),counts=f.counts();assert.equal(saved.phase,'publish');
    work.machine.storage.close?.();work=ScheduledAdvance.restore(program,saved);
    assert.deepEqual(f.counts(),counts);
    work.step(1);assert.deepEqual(f.counts(),counts,'retry only publishes the already-executed boundary');
    while(!work.ready)work.step(1);
    if(kind!=='done'){assert.deepEqual(work.current(),{kind:'call',call:{port:'tail',input:7}});work=new ScheduledAdvance(work.machine,3);while(!work.ready)work.step(1);}
    assert.deepEqual(work.current(),{kind:'done',result:{seen:[1,2,3,4,5],answer:7,draw:11,tail:3}});
    assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:1,executed:[1,2,3,4,5]});
    const finished=f.counts();work.step(1);assert.deepEqual(f.counts(),finished);
  }finally{CardGraph.prototype.export=exporter;work.machine.storage.close?.();}
});

for(const recording of [false,true])test(`accepted Controller reply and original instruction current resume together, recording=${recording}`,async()=>{
  const f=fixture(),program=new CardProgram(f.definition);
  let work=new ScheduledAdvance(new CardMachine(program,privateCardGraph(program.initial(undefined,0))));
  work.step(1);let raw:RawStop=work.current(),callbacks=0,oldClosed=false;
  let entered!:()=>void,abandon!:()=>void;
  const atSlice=new Promise<void>(resolve=>{entered=resolve;});
  const detached=new Promise<void>(resolve=>{abandon=resolve;});
  const original=new Controller<void,Ports,Result>({current:()=>raw,async advance(output){
    work=new ScheduledAdvance(work.machine,output);work.step(1);entered();
    // Transfer the saved live current below. The old execution never resumes
    // its pending edge; rejection only lets its now-obsolete host unwind.
    await detached;throw Error('Original owner relinquished');
  },dispose(){work.machine.storage.close?.();}},f.definition.schemas,undefined,undefined,recording);
  const handle=original.handle();let pending:ReturnType<typeof handle.run>|undefined;
  let restored:Controller<void,Ports,Result>|undefined;
  try{
    unwrap(await handle.bind({begin:async()=>{callbacks++;return{kind:'reply',value:7};}}));
    pending=handle.run();await atSlice;
    const saved=deserialize(serialize({kernel:work.save(),host:original.saveContinuation()}));
    assert.equal(saved.host.accepted.phase,'advance');assert.equal(saved.host.recording,recording);
    assert.deepEqual(saved.host.records.filter((row:{kind:string})=>row.kind==='returned').map((row:{reply:{output:number}})=>row.reply.output),recording?[7]:[]);
    const counts=f.counts();abandon();unwrap(await pending);unwrap(await handle.close());oldClosed=true;
    work=ScheduledAdvance.restore(program,saved.kernel);
    restored=new Controller<void,Ports,Result>({
      current:()=>{if(!work.ready)throw Error('No public IO during a pending original instruction');return work.current();},
      async advance(output){work=new ScheduledAdvance(work.machine,output);while(!work.ready)work.step(1);},
      async resume(){while(!work.ready)work.step(1);},dispose(){work.machine.storage.close?.();}
    },f.definition.schemas,undefined,saved.host,saved.host.recording);
    assert.deepEqual(f.counts(),counts);assert.equal(callbacks,1);
    const current=restored.handle();
    for(const outcome of [await current.inspect(),await current.run(),await current.transfer(),await current.bind(null),await current.close()]){
      assert.equal(outcome.ok,false);if(outcome.ok)throw Error('Pending current exposed as public IO');assert.equal(outcome.error.code,'instance_busy');
    }
    assert.deepEqual(restored.saveContinuation(),saved.host);
    const next=await restored.resumeContinuation();assert.equal(next.accepted,true);assert.equal(next.pause,null);
    assert.equal(next.state.kind,'call');if(next.state.kind!=='call')throw Error('Missing next call');
    assert.deepEqual(next.state.call,{port:'tail',input:7});assert.notEqual(next.state.callId,saved.host.accepted.callId);
    assert.equal(callbacks,1);assert.throws(()=>restored!.saveContinuation(),/No accepted/);
    await assert.rejects(()=>restored!.resumeContinuation(),/unavailable/);
    unwrap(await current.bind({tail:async()=>({kind:'reply',value:3})}));unwrap(await current.run());
    assert.deepEqual(unwrap(await current.inspect()),{kind:'done',result:{seen:[1,2,3,4,5],answer:7,draw:11,tail:3}});
    assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:1,executed:[1,2,3,4,5]});
    if(recording)assert.deepEqual(restored.records!.slice().map(row=>row.kind),['started','called','returned','called','returned','completed']);
    else assert.equal(restored.records,null);
    unwrap(await current.close());
  }finally{
    abandon();await pending?.catch(()=>undefined);
    if(!oldClosed)await handle.close();
    work.machine.storage.close?.();
  }
});

for(const recordCore of [false,true])test(`production loader suspends and cold-restores every original slice without repeating its accepted callback, records=${recordCore}`,async()=>{
  const f=fixture(),store=memorySnapshotStore();
  const loaded=unwrap(await createCardLoader({snapshots:store,instructionsPerSlice:1,recordCore}).load(f.definition));
  let instance=unwrap(await loaded.core.start(undefined)),control=continuationControl(instance)!;
  let callbacks=0,checkpoints=0;
  try{
    control.schedule(()=> 'test-original-slice');
    unwrap(await instance.bind({begin:async()=>{callbacks++;return{kind:'reply',value:7};}}));
    await assert.rejects(()=>instance.run(),ExecutionSuspended);
    for(;;){
      assert.equal(control.pending(),true);assert.equal((await instance.inspect()).ok,false);
      const before=f.counts(),snapshot=await control.save();checkpoints++;
      const data=deserialize((await store.get(snapshot.snapshotId))!);
      assert.equal(data.kind,'original-continuation');assert.equal(data.host.accepted.callId,control.callId());
      assert.equal((await loaded.persistence!.restore(snapshot)).ok,false,'private instruction snapshots cannot masquerade as public IO snapshots');
      const previous=control,oldId=instance.id;await control.close();
      if(recordCore)unwrap(await loaded.capture!.release(oldId));
      assert.throws(()=>previous.pending(),/owner is unavailable/);
      instance=await restoreContinuation(loaded,snapshot);control=continuationControl(instance)!;
      assert.deepEqual(f.counts(),before,'cold restore cannot call initializers, original operations or original RNG');
      control.schedule(()=> 'test-original-slice');
      try{
        const next=await control.resume();assert.equal(next.accepted,true);assert.equal(next.state.kind,'call');
        if(next.state.kind!=='call')throw Error('Missing tail');assert.deepEqual(next.state.call,{port:'tail',input:7});
        unwrap(await loaded.persistence!.release(snapshot));break;
      }catch(error){
        if(!(error instanceof ExecutionSuspended))throw error;
        unwrap(await loaded.persistence!.release(snapshot));
      }
    }
    assert.ok(checkpoints>2);assert.equal(callbacks,1);control.schedule(null);
    unwrap(await instance.bind({tail:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'done',result:{seen:[1,2,3,4,5],answer:7,draw:11,tail:3}});
    assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:1,executed:[1,2,3,4,5]});
    if(recordCore){
      const records=unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})).records;
      assert.deepEqual(records.map(row=>row.kind),['started','called','returned','called','returned','completed']);
    }
  }finally{
    if(control.pending())await control.close();else unwrap(await instance.close());
    if(recordCore)unwrap(await loaded.capture!.release(instance.id));
  }
});

test('suspended original persistence retains one identity across uncertain writes and rejects mismatched host data',async()=>{
  const f=fixture(),memory=memorySnapshotStore(),ids:string[]=[];
  let failures=2;
  const store={...memory,async put(id:string,bytes:Uint8Array){
    ids.push(id);if(failures===2){failures--;throw Error('before original write');}
    await memory.put(id,bytes);if(failures===1){failures--;throw Error('after original write');}
  }};
  const loaded=unwrap(await createCardLoader({snapshots:store,instructionsPerSlice:1,recordCore:true}).load(f.definition));
  let instance=unwrap(await loaded.core.start(undefined)),control=continuationControl(instance)!;
  try{
    control.schedule(()=> 'hold');unwrap(await instance.bind({begin:async()=>({kind:'reply',value:7})}));
    await assert.rejects(()=>instance.run(),ExecutionSuspended);const counts=f.counts();
    await assert.rejects(()=>control.save(),/before original write/);await assert.rejects(()=>control.save(),/after original write/);
    const saved=await control.save();assert.equal(new Set(ids).size,1);assert.deepEqual(f.counts(),counts);
    const bytes=(await memory.get(saved.snapshotId))!;
    for(const corrupt of [
      (data:any)=>{data.host.accepted.callId=randomUUID();},
      (data:any)=>{data.kernel.phase='ready';},
      (data:any)=>{data.host.records.pop();},
      (data:any)=>{data.rule='different-rule';},
      (data:any)=>{data.host.recording=false;},
    ]){
      const data=deserialize(bytes);corrupt(data);const snapshot=InstanceSnapshotSchema.parse({snapshotId:randomUUID()});
      await memory.put(snapshot.snapshotId,serialize(data));
      // The saved identity is parsed at the private external boundary.
      await assert.rejects(()=>restoreContinuation(loaded,snapshot));
      assert.deepEqual(f.counts(),counts);assert.equal(control.pending(),true);
    }
    const old=instance,stale=control;instance=control.transfer();control=continuationControl(instance)!;
    assert.equal((await old.inspect()).ok,false);assert.throws(()=>stale.callId(),/owner is unavailable/);
    assert.equal(control.callId(),deserialize(bytes).host.accepted.callId);
    control.schedule(null);assert.equal((await control.resume()).accepted,true);
    unwrap(await instance.bind({tail:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());
    assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:1,executed:[1,2,3,4,5]});
  }finally{
    if(control.pending())await control.close();else unwrap(await instance.close());
    unwrap(await loaded.capture!.release(instance.id));
  }
});

for(const kind of ['yield','call','done'] as const)test(`production original ${kind} export failure suspends its committed instruction instead of faulting or replaying it`,async()=>{
  const f=fixture(),loaded=unwrap(await createCardLoader({instructionsPerSlice:1,recordCore:false}).load(f.definition));
  let instance=unwrap(await loaded.core.start(undefined)),control=continuationControl(instance)!,callbacks=0;
  const exporter=CardGraph.prototype.export;let failed=false;
  try{
    unwrap(await instance.bind({begin:async()=>{callbacks++;return{kind:'reply',value:7};}}));
    if(kind==='done'){
      unwrap(await instance.run());unwrap(await instance.bind({tail:async()=>{callbacks++;return{kind:'reply',value:3};}}));
    }
    CardGraph.prototype.export=function<T>(value:T):T{
      if(!failed&&value&&typeof value==='object'&&(value as {kind?:string}).kind===kind){failed=true;throw Error('original export unavailable');}
      return exporter.call(this,value) as T;
    };
    await assert.rejects(()=>instance.run(),error=>error instanceof ExecutionSuspended&&error.reason.startsWith('original-publication-failed:'));
    CardGraph.prototype.export=exporter;assert.equal(failed,true);assert.equal(control.pending(),true);
    const snapshot=await control.save(),before=f.counts();await control.close();
    instance=await restoreContinuation(loaded,snapshot);control=continuationControl(instance)!;
    assert.deepEqual(f.counts(),before);assert.equal((await control.resume()).accepted,true);
    if(kind!=='done'){
      unwrap(await instance.bind({tail:async()=>{callbacks++;return{kind:'reply',value:3};}}));unwrap(await instance.run());
    }
    assert.equal(callbacks,2);assert.deepEqual(f.counts(),{initialized:1,draws:1,finished:1,executed:[1,2,3,4,5]});
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'done',result:{seen:[1,2,3,4,5],answer:7,draw:11,tail:3}});
    unwrap(await loaded.persistence!.release(snapshot));
  }finally{CardGraph.prototype.export=exporter;if(control.pending())await control.close();else unwrap(await instance.close());}
});
