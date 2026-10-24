import test from 'node:test';
import assert from 'node:assert/strict';
import {deserialize,serialize} from 'node:v8';
import {CardProgram} from '@bear-forge/card-engine';
import {createCardLoader,memorySnapshotStore} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {SearchBudget,defaultSearchLimits,search,type SearchDomain} from '@bear-forge/policies';
import {searchWindowsDefinition,type WindowSetup} from './search-windows-fixture.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {contract,type StsTypes} from '../src/contract.ts';
import type {GameHandle} from '@bear-forge/contracts/loading';
import {createStsProbabilityContinuation} from '../src/search/probability-current.ts';
import {position,baseline} from '../src/search/evaluation.ts';
import {publicDecision,type PublicDecision} from '../src/search/information.ts';
import {searchEntropyWord} from '../../../packages/policies/src/search/entropy.ts';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {stateOf} from '../../../packages/card-engine/src/rules-module-internal.ts';
import {encounterId,eventId,type RelicId} from '../src/identifiers.ts';
import type {StsEvent} from '../src/game.schemas.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const store=memorySnapshotStore();
const loadedPromise=createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(searchWindowsDefinition);
const combatPromise=createCardLoader({controlled:true,recordCore:false}).load(combatContentDefinition);
const limits={...defaultSearchLimits,mode:'work' as const,worlds:2,decisions:1,simulations:128};
async function attach(instance:any,persistence:any){
  const game=unwrap(await createGameBinder().bind({instance,contract,persistence})),events:StsEvent[]=[];
  const onEvent=async(e:{event:StsEvent})=>{events.push(e.event);return{kind:'reply' as const,value:null};};
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent}));unwrap(await game.run());
  return{game,events,onEvent};
}
async function window(character:'ironclad'|'volibear',setup:Partial<WindowSetup>){
  const loaded=unwrap(await loadedPromise);
  return{...await attach(unwrap(await loaded.core.start({seed:'130',character,detailedEvents:true,mode:'room',act:1,room:'REST',event:0,owned:[],relic:'ASTROLABE',...setup})),loaded.persistence!),loaded};
}
async function inspect(game:GameHandle<StsTypes>,events:StsEvent[]){const before=unwrap(await game.inspect());if(before.kind!=='request')throw Error('Expected original request: '+JSON.stringify(before));return{before,decision:publicDecision(before.requests[0]!,events.map(event=>({event})))};}
async function check(game:GameHandle<StsTypes>,events:StsEvent[],algorithm:'r1'|'r2'='r2'){
  const {before,decision}=await inspect(game,events),adapter=createStsProbabilityContinuation(),root=position(decision);
  const domain:SearchDomain={root,baseline,next:adapter.next,async current(random,budget){const current=await adapter.take(async()=>unwrap(await game.fork!()),events,budget);budget.accepted++;return{particles:[{current,weight:1}],representation:'exact',random,method:'actual-current',reason:null};}};
  const result=await search(domain,algorithm,{state:76,position:0},new SearchBudget(limits,new AbortController().signal));
  assert.ok(result.evidence.completed>0,decision.observation.game.screen+': '+result.evidence.reason);
  assert.equal(result.evidence.coverageComplete,true,decision.observation.game.screen+': '+result.evidence.reason);
  assert.ok(result.evidence.actions.every(row=>Math.abs(row.outcomes.reduce((sum,o)=>sum+o.probability,0)-1)<1e-12));
  assert.deepEqual(unwrap(await game.inspect()),before);return{result,decision};
}
const cases:{name:string;setup:Partial<WindowSetup>;steps:number}[]=[
  {name:'Neow',setup:{mode:'neow'},steps:2},
  {name:'act3 rest/red key',setup:{room:'REST',act:3},steps:2},
  {name:'act2 merchant restock',setup:{room:'SHOP',act:2,owned:['THE_COURIER','MEMBERSHIP_CARD']},steps:2},
  {name:'chest/reward/blue key',setup:{room:'TREASURE'},steps:3},
  {name:'green and blue reward keys',setup:{mode:'keys'},steps:3},
  {name:'act2 original event',setup:{room:'EVENT',act:2,event:eventId.ANCIENT_WRITING},steps:2},
  {name:'act3 original event',setup:{room:'EVENT',act:3,event:eventId.MINDBLOOM},steps:1},
  ...(['ASTROLABE','EMPTY_CAGE','DOLLYS_MIRROR','CALLING_BELL','CAULDRON','TINY_HOUSE'] as RelicId[]).map(relic=>({name:relic,setup:{mode:'relic' as const,relic},steps:3})),
  ...[1,2,3].map(act=>({name:`act ${act} transition`,setup:{mode:'transition' as const,act},steps:1})),
];
for(const character of ['ironclad','volibear'] as const)test(`${character}: R1/R2 cover original adventure windows, nested acquisition, keys and act transitions`,async t=>{
  for(const item of cases){
    const f=await window(character,item.setup),initial=CardProgram.prototype.initial;
    CardProgram.prototype.initial=function(){throw Error('Current window search cannot initialize or replay');};
    try{for(let step=0;step<item.steps;step++){
      const {decision}=await inspect(f.game,f.events);
      if(step>0&&decision.observation.game.screen==='MAP_SCREEN')break;
      for(const algorithm of ['r1','r2'] as const)await check(f.game,f.events,algorithm);
      if(step+1===item.steps)break;
      // Advance only this actual current once. Prefer an original key action,
      // otherwise the first original option; no stored path or reset.
      const action=decision.actions.find(action=>decision.observation.game.screen==='REST_ROOM'?action.bits===2:decision.observation.game.screen==='REWARDS'&&action.bits===(2<<27))??decision.actions[0]!;
      unwrap(await f.game.bind({player:'0',onRequest:async()=>({kind:'reply',value:action}),onEvent:f.onEvent}));
      assert.ok(unwrap(await f.game.run()).accepted);
    }t.diagnostic(item.name+': original nonzero search passed');}
    finally{CardProgram.prototype.initial=initial;unwrap(await f.game.close());}
  }
});

for(const character of ['ironclad','volibear'] as const)test(`${character}: every original encounter has weighted end-turn successors through the sole combat executor`,async t=>{
  const loaded=unwrap(await combatPromise);
  for(const [name,encounter] of Object.entries(encounterId)){
    if(name==='INVALID')continue;
    const f=await attach(unwrap(await loaded.core.start({seed:'130',character,encounter,relics:[],potion:null,durable:true,elite:false,detailedEvents:true})),loaded.persistence!);
    const initial=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('Encounter continuation cannot initialize');};
    try{await check(f.game,f.events);t.diagnostic(name+': nonzero original search passed');}
    finally{CardProgram.prototype.initial=initial;unwrap(await f.game.close());}
  }
});

test('opening an unrevealed chest ignores cached gold/tier and real RNG while preserving the original joint law',async()=>{
  const f=await window('ironclad',{room:'TREASURE'}),saved=unwrap(await f.game.save!());
  const data=deserialize((await store.get(saved.snapshotId))!),graph=privateCardGraph(data.root,data.immutable);let changed=0,rngs=0;
  for(const entity of Object.values(stateOf(graph.root.state).entities))for(const [key,value] of Object.entries(entity.components)){
    if(value&&typeof value==='object'&&'chest' in value&&value.chest){
      entity.components[Number(key)]={...value,chest:{...value.chest,haveGold:!value.chest.haveGold,tier:value.chest.tier==='uncommon'?(value.chest.size===0?'common':'rare'):'uncommon'}};changed++;
    }
    if(value&&typeof value==='object'&&typeof value.seed0==='bigint'){entity.components[Number(key)]={...value,seed0:value.seed0^99n,seed1:value.seed1^57n};rngs++;}
  }
  assert.equal(changed,1);assert.ok(rngs>0);
  try{await store.put(saved.snapshotId,serialize({...data,...graph.snapshot()}));}finally{graph.close();}
  const initial=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('Changed current restore must not initialize');};
  const restored=unwrap(await createGameBinder().bind({instance:unwrap(await f.loaded.persistence!.restore(saved)),contract,persistence:f.loaded.persistence!}));
  try{
    assert.deepEqual((await inspect(restored,f.events)).decision,(await inspect(f.game,f.events)).decision);
    const left=await check(f.game,f.events),right=await check(restored,f.events);
    assert.deepEqual(left.result.evidence,right.result.evidence);assert.deepEqual(left.result.random,right.result.random);assert.deepEqual(left.result.action,right.result.action);
    const distributions=[];
    for(const game of [f.game,restored]){
      const adapter=createStsProbabilityContinuation(),budget=new SearchBudget({...limits,worlds:8},new AbortController().signal),root=await adapter.take(async()=>unwrap(await game.fork!()),f.events,budget);
      let cursor={state:76,position:0};const rows=[];
      try{for await(const edge of adapter.next(root,{budget,word(){const draw=searchEntropyWord(cursor);cursor=draw.random;return draw.value;}})){
        try{rows.push({action:edge.action,outcomes:edge.outcomes.map(row=>({probability:row.probability,information:row.current.position.information}))});}
        finally{for(const row of edge.outcomes)await row.current.close();}
      }}finally{await root.close();}
      distributions.push(rows);
    }
    assert.deepEqual(distributions[0],distributions[1],'full visible successor weights ignore both cached secrets');
    const open=distributions[0]!.find(row=>row.action==='0')!;assert.ok(open.outcomes.length>1);
    assert.ok(open.outcomes.every(row=>(JSON.parse(row.information) as PublicDecision).observation.game.screen==='REWARDS'));
  }finally{CardProgram.prototype.initial=initial;unwrap(await restored.close());unwrap(await f.game.close());unwrap(await f.loaded.persistence!.release(saved));}
});
