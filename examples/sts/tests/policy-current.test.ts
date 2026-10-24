import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {ProbabilityCurrent} from '../../../packages/runtime-card/src/probability.ts';
import {CardProgram} from '@bear-forge/card-engine';
import {createCardLoader,memorySnapshotStore} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import type {GameHandle} from '@bear-forge/contracts/loading';
import {defaultSearchLimits,type SearchResult} from '@bear-forge/policies';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {stateOf} from '../../../packages/card-engine/src/rules-module-internal.ts';
import {inspectRuleQuery} from '../../../packages/card-engine/src/rules-inspection.ts';
import {registerCurrentSource} from '../../../packages/game-host/src/current.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {withStsProbabilityTracking} from '../src/search/tracking.ts';
import {createSearchPolicy} from '../src/search/policy.ts';
import {contract,type StsTypes} from '../src/contract.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {battles} from '../src/rules/battles.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import type {StsEvent} from '../src/game.schemas.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const store=memorySnapshotStore(),definition=withStsProbabilityTracking(combatContentDefinition);
const loadedPromise=createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(definition);
const limits={...defaultSearchLimits,mode:'work' as const,decisions:2,worlds:4,simulations:64};
const random={state:76,position:0};
function source(game:GameHandle<StsTypes>){const fork=async()=>unwrap(await game.fork!());registerCurrentSource(fork,game);return fork;}
async function request(game:GameHandle<StsTypes>){const s=unwrap(await game.inspect());if(s.kind!=='request')throw Error(JSON.stringify(s));return s.requests[0]!;}

test('actual probability heap exhaustion returns a labelled legal fallback, releases its root, and does not swallow execution errors',async()=>{
  const loaded=unwrap(await loadedPromise),events:StsEvent[]=[];
  const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',encounter:encounterId.CULTIST,relics:[],potion:null,durable:true,elite:false,detailedEvents:true})),contract,persistence:loaded.persistence!}));
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async e=>{events.push(e.event);return{kind:'reply',value:null};}}));unwrap(await game.run());
  const before=await request(game),visibleHistory=events.map(event=>({event})),v8=createRequire(import.meta.url)('node:v8');
  const statistics=v8.getHeapStatistics,close=ProbabilityCurrent.prototype.close,fork=ProbabilityCurrent.prototype.fork;
  let closes=0,evidence:SearchResult|undefined;
  const input={request:before,visibleHistory,memory:{},random,signal:new AbortController().signal};
  try{
    ProbabilityCurrent.prototype.close=function(){closes++;return close.call(this);};
    v8.getHeapStatistics=()=>({...statistics(),total_available_size:1});syncBuiltinESMExports();
    const output=await createSearchPolicy({character:'ironclad',algorithm:'r2',limits,forkCurrent:source(game),onEvidence:r=>{evidence=r;}}).decide(input);
    assert.equal(evidence!.evidence.reason,'heap-budget');assert.equal(evidence!.evidence.coverageComplete,false);assert.equal(evidence!.evidence.completed,0);
    assert.ok(before.options.kind==='exact'&&before.options.values.some(a=>JSON.stringify(a)===JSON.stringify(output.action)));
    assert.ok(closes>0,'the search-owned root closes after the resource stop');assert.deepEqual(await request(game),before);
    v8.getHeapStatistics=statistics;syncBuiltinESMExports();
    ProbabilityCurrent.prototype.fork=function(){throw Error('unrelated execution defect');};
    await assert.rejects(createSearchPolicy({character:'ironclad',algorithm:'r2',limits,forkCurrent:source(game)}).decide(input),/unrelated execution defect/);
    assert.deepEqual(await request(game),before);
  }finally{v8.getHeapStatistics=statistics;syncBuiltinESMExports();ProbabilityCurrent.prototype.close=close;ProbabilityCurrent.prototype.fork=fork;unwrap(await game.close());}
});

for(const character of ['ironclad','volibear'] as const)test(`${character}: production R1/R2 ignore hidden draw, future pools and RNG, restore directly, and retain actual current intent`,async()=>{
  const loaded=unwrap(await loadedPromise),events:StsEvent[]=[];
  const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character,encounter:encounterId.BOOK_OF_STABBING,relics:['RUNIC_DOME'],potion:potionId.SWIFT_POTION,durable:true,elite:true,detailedEvents:true})),contract,persistence:loaded.persistence!}));
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async e=>{events.push(e.event);return{kind:'reply',value:null};}}));unwrap(await game.run());
  const before=await request(game),saved=unwrap(await game.save!()),original=CardProgram.prototype.initial;
  const data=deserialize((await store.get(saved.snapshotId))!),graph=privateCardGraph(data.root,data.immutable);
  const query=<I,O>(q:Parameters<typeof inspectRuleQuery<I,O>>[2],i:I)=>inspectRuleQuery(combatContentDefinition,graph.root.state,q,i);
  const run=query(adventures.exports.instances,undefined)[0]!,session=query(combatSessions.exports.current,query(combatSessions.exports.forRun,run)!);
  const draw=query(cardPiles.exports.bindings,query(battles.exports.status,session.battle).piles).draw,order=query(zones.exports.members,draw);
  const components=stateOf(graph.root.state).entities[draw]!.components;
  const key=Object.entries(components).find(([,value])=>Array.isArray(value)&&JSON.stringify(value)===JSON.stringify(order))?.[0];assert.ok(key);assert.ok(order.length>1);
  components[Number(key)]=[...order].reverse();let rngs=0,pools=0;
  for(const entity of Object.values(stateOf(graph.root.state).entities))for(const [index,value] of Object.entries(entity.components)){
    if(!value||typeof value!=='object')continue;
    if(typeof value.seed0==='bigint'){entity.components[Number(index)]={...value,seed0:value.seed0^99n,seed1:value.seed1^57n};rngs++;}
    if(value.relicPools?.common?.length>1){entity.components[Number(index)]={...value,relicPools:{...value.relicPools,common:[...value.relicPools.common].reverse()}};pools++;}
  }
  assert.ok(rngs>0&&pools>0);
  try{await store.put(saved.snapshotId,serialize({...data,...graph.snapshot()}));}finally{graph.close();}
  CardProgram.prototype.initial=function(){throw Error('Current restore/search must not initialize');};
  const other=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.persistence!.restore(saved)),contract,persistence:loaded.persistence!}));
  try{
    const visibleHistory=events.map(event=>({event}));
    assert.deepEqual((await request(other)).observation,before.observation);
    for(const algorithm of ['r1','r2'] as const){
      const outputs=[];
      for(const current of [game,other]){
        let evidence:SearchResult|undefined;
        const policy=createSearchPolicy({character,algorithm,limits,forkCurrent:source(current),onEvidence:r=>{evidence=r;}});
        outputs.push(await policy.decide({request:await request(current),visibleHistory,memory:{},random,signal:new AbortController().signal}));
        assert.ok(evidence!.evidence.completed>0);assert.equal(evidence!.evidence.coverageComplete,true);
        assert.equal(evidence!.evidence.method,'actual-current');assert.ok(evidence!.cost.phases.advance!.calls>0);
      }
      assert.deepEqual(outputs[0],outputs[1],'all accepted policy fields are invariant under real hidden future changes');
    }
    assert.deepEqual(await request(game),before);
    const account={milliseconds:60_000};let evidence:SearchResult|undefined;
    const exhausted=createSearchPolicy({character,algorithm:'r2',limits,forkCurrent:source(game),account,onEvidence:r=>{evidence=r;}});
    await exhausted.decide({request:before,visibleHistory,memory:{},random,signal:new AbortController().signal});
    assert.equal(evidence!.evidence.reason,'game-search-budget');assert.equal(evidence!.evidence.completed,0);assert.ok(account.milliseconds>=60_000);
    const controller=new AbortController();controller.abort();
    await assert.rejects(createSearchPolicy({character,algorithm:'r2',limits,forkCurrent:source(game)}).decide({request:before,visibleHistory,memory:{},random,signal:controller.signal}),/cancelled/i);
    assert.deepEqual(await request(game),before);
  }finally{CardProgram.prototype.initial=original;unwrap(await other.close());unwrap(await game.close());unwrap(await loaded.persistence!.release(saved));}
});
