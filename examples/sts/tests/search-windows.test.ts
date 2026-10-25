import {unpackProbabilitySnapshot} from '../../../packages/runtime-card/src/probability.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {deserialize,serialize} from 'node:v8';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {createCardLoader,memorySnapshotStore} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {policyWork} from '../../../packages/policies/src/search/work.ts';
import {addMass,multiplyMass,unitMass,zeroMass,type ProbabilityMass} from '../../../packages/card-engine/src/probability-mass.ts';
import {searchWindowsDefinition,type WindowSetup} from './search-windows-fixture.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {contract,type StsTypes} from '../src/contract.ts';
import type {GameHandle} from '@bear-forge/contracts/loading';
import {readStsCurrent} from '../src/search/probability-current.ts';
import {takeStsSearchCurrent,stsExactDomain} from '../src/search/current-session.ts';
import {createSearchPolicy,type StsSearchResult} from '../src/search/policy.ts';
import {publicDecision} from '../src/search/information.ts';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {stateOf} from '../../../packages/card-engine/src/rules-module-internal.ts';
import {encounterId,eventId,type RelicId} from '../src/identifiers.ts';
import type {StsEvent} from '../src/game.schemas.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const store=memorySnapshotStore();
const loadedPromise=createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(searchWindowsDefinition);
const combatPromise=createCardLoader({controlled:true,recordCore:false}).load(combatContentDefinition);
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
async function check(game:GameHandle<StsTypes>,events:StsEvent[],character:'ironclad'|'volibear'='ironclad'){
  const {before,decision}=await inspect(game,events);let evidence:StsSearchResult|undefined;
  assert.equal(decision.observation.battle,null);
  const policy=createSearchPolicy({character,
    forkCurrent:async()=>unwrap(await game.fork!()),onEvidence:result=>{evidence=result;}});
  const advance=CardMachine.prototype.advanceExactProbability;
  try{
    CardMachine.prototype.advanceExactProbability=()=>{throw Error('Adventure preferences must not search another battle');};
    const result=await policy.decide({request:before.requests[0]!,visibleHistory:events.map(event=>({event})),memory:{},random:{state:76,position:0},signal:new AbortController().signal});
    assert.equal((evidence!.evidence as {algorithm:string}).algorithm,'public-adventure');
    assert.ok(decision.actions.some(action=>JSON.stringify(action)===JSON.stringify(result.action)));
    assert.deepEqual(unwrap(await game.inspect()),before);return{result,decision};
  }finally{CardMachine.prototype.advanceExactProbability=advance;policyWork(policy)!.close();}
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
for(const character of ['ironclad','volibear'] as const)test(`${character}: public preferences cover original adventure windows, nested acquisition, keys and act transitions`,async t=>{
  for(const item of cases){
    const f=await window(character,item.setup),initial=CardProgram.prototype.initial;
    CardProgram.prototype.initial=function(){throw Error('Current window search cannot initialize or replay');};
    try{for(let step=0;step<item.steps;step++){
      const {decision}=await inspect(f.game,f.events);
      if(step>0&&decision.observation.game.screen==='MAP_SCREEN')break;
      await check(f.game,f.events,character);
      if(step+1===item.steps)break;
      // Advance only this actual current once. Prefer an original key action,
      // otherwise the first original option; no stored path or reset.
      const action=decision.actions.find(action=>decision.observation.game.screen==='REST_ROOM'?action.bits===2:decision.observation.game.screen==='REWARDS'&&action.bits===(2<<27))??decision.actions[0]!;
      unwrap(await f.game.bind({player:'0',onRequest:async()=>({kind:'reply',value:action}),onEvent:f.onEvent}));
      assert.ok(unwrap(await f.game.run()).accepted);
    }t.diagnostic(item.name+': original public decision inspected');}
    finally{CardProgram.prototype.initial=initial;unwrap(await f.game.close());}
  }
});

for(const character of ['ironclad','volibear'] as const)test(`${character}: every original encounter retains an exact end-turn frontier through the sole combat executor`,async t=>{
  const loaded=unwrap(await combatPromise);
  for(const [name,encounter] of Object.entries(encounterId)){
    if(name==='INVALID')continue;
    const f=await attach(unwrap(await loaded.core.start({seed:'130',character,encounter,relics:[],potion:null,durable:true,elite:false,detailedEvents:true})),loaded.persistence!);
    const initial=CardProgram.prototype.initial;CardProgram.prototype.initial=function(){throw Error('Encounter continuation cannot initialize');};
    const root=await takeStsSearchCurrent(async()=>unwrap(await f.game.fork!()),f.events);
    const view=readStsCurrent(root.current,root.events),domain=stsExactDomain(root.current.machine.program,view.decision.observation,f.events.length);
    const end=view.decision.actions.find(action=>action.bits>>>29===4);assert.ok(end);
    let expansion=domain.next(root,String(end.bits));
    const before=root.current.machine.storage.export(root.current.machine.root);
    try{
      // Inspect a bounded amount of work, keeping all remaining support. This
      // test makes no assertion that an entire encounter has been solved.
      for(let step=0;step<32&&!expansion.complete;step++)expansion.step();
      const saved=deserialize(serialize(expansion.save()));
      const pending=saved.pending.reduce((sum:ProbabilityMass,row:any)=>addMass(sum,row.phase==='chance'?[{mass:row.mass,cursor:row.cursor},...row.remainder??[]].reduce((total:ProbabilityMass,piece:any)=>addMass(total,multiplyMass(piece.mass,piece.cursor.remaining)),zeroMass()):row.mass),zeroMass());
      const ready=saved.ready.reduce((sum:ProbabilityMass,row:any)=>addMass(sum,row.mass),zeroMass());
      assert.deepEqual(addMass(addMass(pending,ready),saved.transferred),unitMass());
      assert.ok(saved.pending.every((row:any)=>unpackProbabilitySnapshot(row).context.stop.kind!=='chance'||unpackProbabilitySnapshot(row).context.stop.space.kind!=='unavailable'));
      expansion.close();expansion=domain.restoreExpansion(saved);assert.deepEqual(expansion.save(),saved);
      if(!expansion.complete)assert.equal(expansion.step(),true);
      assert.deepEqual(root.current.machine.storage.export(root.current.machine.root),before);
      t.diagnostic(name+': original exact frontier inspected');
    }finally{CardProgram.prototype.initial=initial;expansion.close();domain.close(root);unwrap(await f.game.close());}
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
    assert.deepEqual(left.result,right.result);
    const distributions:Map<string,ProbabilityMass>[]=[];
    for(const game of [f.game,restored]){
      const root=await takeStsSearchCurrent(async()=>unwrap(await game.fork!()),f.events),view=readStsCurrent(root.current,root.events);
      const domain=stsExactDomain(root.current.machine.program,view.decision.observation,f.events.length);
      // This is an original-action probability test, not adventure planning.
      // The combat objective is not used for these noncombat successors.
      const open=view.decision.actions.find(action=>action.bits===0);assert.ok(open);
      const expansion=domain.next(root,String(open.bits)),law=new Map<string,ProbabilityMass>();let total=zeroMass();
      try{
        for(;;){
          const row=expansion.take();
          if(row){try{
            const decision=readStsCurrent(row.current.current,row.current.events).decision;
            assert.equal(decision.observation.game.screen,'REWARDS');
            const information=JSON.stringify(decision);law.set(information,addMass(law.get(information)??zeroMass(),row.mass));total=addMass(total,row.mass);
          }finally{domain.close(row.current);}}
          else if(expansion.complete)break;else expansion.step();
        }
        assert.deepEqual(total,unitMass());assert.ok(law.size>1);distributions.push(law);
      }finally{expansion.close();domain.close(root);}
    }
    assert.deepEqual(distributions[0],distributions[1],'complete visible successor weights ignore cached secrets and real future RNG');
  }finally{CardProgram.prototype.initial=initial;unwrap(await restored.close());unwrap(await f.game.close());unwrap(await f.loaded.persistence!.release(saved));}
});
