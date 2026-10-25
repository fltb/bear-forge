import test from 'node:test';
import assert from 'node:assert/strict';
import {deserialize,serialize} from 'node:v8';
import {z} from 'zod';
import {card,CardProgram,type CardDefinition} from '@bear-forge/card-engine';
import type {Instance} from '@bear-forge/contracts/instance';
import {probabilityOperation} from '../../card-engine/src/probability.ts';
import {addMass,compareMass,probabilityMass,unitMass,zeroMass} from '../../card-engine/src/probability-mass.ts';
import {createCardLoader} from '../src/loader.ts';
import {memorySnapshotStore} from '../src/store.ts';
import {takeProbabilityCurrent} from '../src/probability.ts';
import {ProbabilityExpansion} from '../src/probability-expansion.ts';

type Ports={begin:{input:null;output:null};event:{input:number;output:null};decision:{input:number;output:number}};
type State={known:number;hidden:number;chosen:number;a:{value:number};b:{value:number}};
type Result={known:number;chosen:number;value:number};
const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{
  if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;
};
function fixture(){
  let initializations=0,prefix=0,realDraws=0,resolutions=0,updates=0;
  const draw=()=>{realDraws++;return 1;};
  probabilityOperation<State>(draw,{space:()=>({kind:'uniform',size:3n}),resolve:(_scope,coordinate)=>{resolutions++;return Number(coordinate);}});
  const definition:CardDefinition<State,void,Ports,Result>={id:'current-loader-without-posterior',
    schemas:{setup:z.undefined(),result:z.object({known:z.number(),chosen:z.number(),value:z.number()}),ports:{
      begin:{input:z.null(),output:z.null()},event:{input:z.number(),output:z.null()},decision:{input:z.number(),output:z.number()},
    }},
    initialize:()=>{initializations++;const shared={value:5};return{known:41,hidden:13,chosen:-1,a:shared,b:shared};},
    entry:'root',effects:[{id:'root',steps:[
      card.operation<State>(scope=>{prefix++;scope.state.known++;}),
      card.request(()=>({port:'begin',input:null})),card.operation(draw,'choice'),
      card.operation<State>(scope=>{updates++;scope.state.chosen=scope.locals.choice;scope.state.a.value+=scope.locals.choice;}),
      card.request<State>(scope=>({port:'event',input:scope.state.chosen})),
      card.request<State>(scope=>({port:'decision',input:scope.state.chosen}),'answer'),
      card.operation<State>(scope=>{scope.state.b.value+=scope.locals.answer;}),
      card.return<State>(scope=>({known:scope.state.known,chosen:scope.state.chosen,value:scope.state.a.value})),
    ]}],
  };
  return{definition,counts:()=>({initializations,prefix,realDraws,resolutions,updates})};
}
async function toDecision(instance:Instance<Ports,Result>){
  unwrap(await instance.bind({begin:async()=>({kind:'reply',value:null}),event:async()=>({kind:'reply',value:null}),decision:async()=>({kind:'pause'})}));
  while(unwrap(await instance.run()).accepted){}
  const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'call');
  if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected original decision');return stop;
}

for(const controlled of [false,true])test(`ordinary controlled=${controlled} execution performs one real draw and no probability expansion`,async()=>{
  const f=fixture(),loaded=unwrap(await createCardLoader({controlled,recordCore:false}).load(f.definition));
  const instance=unwrap(await loaded.core.start(undefined)),initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Accepted input must continue its current');};
    assert.equal((await toDecision(instance)).call.input,1);
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,realDraws:1,resolutions:0,updates:1});
    unwrap(await instance.bind({decision:async()=>({kind:'reply',value:2})}));
    while(unwrap(await instance.run()).accepted){}
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'done',result:{known:42,chosen:1,value:8}});
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,realDraws:1,resolutions:0,updates:1});
  }finally{CardProgram.prototype.initial=initial;unwrap(await instance.close());}
});

for(const recordCore of [false,true])test(`the exact root is the complete actual Context and owns future outcomes without modifying the live instance; records=${recordCore}`,async()=>{
  const f=fixture(),store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({controlled:true,recordCore,snapshots:store}).load(f.definition));
  const instance=unwrap(await loaded.core.start(undefined)),initial=CardProgram.prototype.initial;
  const snapshot=unwrap(await loaded.persistence!.save(instance)),saved=deserialize((await store.get(snapshot.snapshotId))!);
  const current=await takeProbabilityCurrent<Ports,Result>(unwrap(await instance.fork!()));
  const options={continueCall(stop:Extract<ReturnType<typeof current.inspect>,{kind:'call'}>,data:number[]){
    if(stop.call.port==='event')return{reply:null,data:[...data,stop.call.input]};
  }};
  let expansion=ProbabilityExpansion.from(current,null,[] as number[],options);
  const outcomes:NonNullable<ReturnType<typeof expansion.take>>[]=[];
  try{
    CardProgram.prototype.initial=function(){throw Error('Current handoff or cold search continuation cannot initialize');};
    assert.deepEqual(current.machine.storage.export(current.machine.root),saved.root);
    const state=current.machine.root.state as State;assert.equal(state.known,42);assert.equal(state.hidden,13);assert.equal(state.a,state.b);
    assert.deepEqual(current.machine.storage.export(current.machine.root),saved.root);
    while(!expansion.complete){
      expansion.step();const masses=expansion.masses();
      assert.equal(compareMass(addMass(addMass(masses.pending,masses.ready),masses.transferred),unitMass()),0);
      for(let row=expansion.take();row;row=expansion.take())outcomes.push(row);
      const pending=deserialize(serialize(expansion.save()));expansion.close();
      expansion=ProbabilityExpansion.restore(current.machine.program,pending,options);
    }
    for(let row=expansion.take();row;row=expansion.take())outcomes.push(row);
    assert.equal(outcomes.length,3);
    assert.deepEqual(outcomes.reduce((mass,row)=>addMass(mass,row.mass),zeroMass()),unitMass());
    for(const row of outcomes){
      const state=row.current.machine.root.state as State;
      assert.equal(row.current.machine.program,current.machine.program);assert.equal(state.hidden,13);assert.equal(state.known,42);
      assert.equal(state.a,state.b);assert.equal(state.a.value,5+state.chosen);assert.deepEqual(row.data,[state.chosen]);
      assert.deepEqual(row.mass,probabilityMass(1n,3n));
      assert.deepEqual(row.current.inspect(),{kind:'call',call:{port:'decision',input:state.chosen}});
    }
    assert.deepEqual(outcomes.map(row=>(row.current.machine.root.state as State).chosen).sort(),[0,1,2]);
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,realDraws:0,resolutions:3,updates:3});
    assert.deepEqual(current.machine.storage.export(current.machine.root),saved.root);
    assert.deepEqual(unwrap(await instance.inspect()),saved.state);
  }finally{
    CardProgram.prototype.initial=initial;for(const row of outcomes)row.current.close();expansion.close();current.close();
    unwrap(await instance.close());unwrap(await loaded.persistence!.release(snapshot));
  }
});

test('a failed snapshot write preserves the actual current and later cold continuation consumes each accepted reply once',async()=>{
  const f=fixture(),store=memorySnapshotStore(),put=store.put;let failWrite=true;
  const writes:string[]=[];
  store.put=async(id,bytes)=>{writes.push(id);if(failWrite)throw Error('disk unavailable');return put(id,bytes);};
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(f.definition));
  let instance=unwrap(await loaded.core.start(undefined));const initial=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Cold restore cannot initialize');};
    const before=unwrap(await instance.inspect()),failed=await loaded.persistence!.save(instance);
    assert.equal(failed.ok,false);assert.deepEqual(unwrap(await instance.inspect()),before);
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,realDraws:0,resolutions:0,updates:0});
    failWrite=false;const saved=unwrap(await loaded.persistence!.save(instance));
    assert.deepEqual(writes,[saved.snapshotId,saved.snapshotId],'retry reuses the exact pending snapshot identity');
    const bytes=deserialize((await store.get(saved.snapshotId))!);assert.equal(Object.hasOwn(bytes,'tracking'),false);
    assert.equal(bytes.root.state.a,bytes.root.state.b);assert.equal(bytes.root.state.hidden,13);
    unwrap(await instance.close());instance=unwrap(await loaded.persistence!.restore(saved));
    assert.deepEqual(unwrap(await instance.inspect()),before);
    await toDecision(instance);
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,realDraws:1,resolutions:0,updates:1});
    const next=unwrap(await loaded.persistence!.save(instance));unwrap(await instance.close());
    instance=unwrap(await loaded.persistence!.restore(next));
    unwrap(await instance.bind({decision:async()=>({kind:'reply',value:2})}));
    while(unwrap(await instance.run()).accepted){}
    assert.deepEqual(unwrap(await instance.inspect()),{kind:'done',result:{known:42,chosen:1,value:8}});
    assert.deepEqual(f.counts(),{initializations:1,prefix:1,realDraws:1,resolutions:0,updates:1});
    unwrap(await loaded.persistence!.release(saved));unwrap(await loaded.persistence!.release(next));
  }finally{CardProgram.prototype.initial=initial;unwrap(await instance.close());}
});
