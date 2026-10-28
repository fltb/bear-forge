import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {CardProgram} from '@bear-forge/card-engine';
import {createCardLoader,memorySnapshotStore} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import type {GameHandle} from '@bear-forge/contracts/loading';
import {PolicyWorkSuspended,policyWork} from '@bear-forge/policies/search/work';
import {addMass,unitMass,zeroMass,type ProbabilityMass} from '@bear-forge/card-engine/probability-mass';
import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {stateOf} from '@bear-forge/card-engine/rules-module-internal';
import {inspectRuleQuery} from '@bear-forge/card-engine/rules-inspection';
import {registerCurrentSource} from '@bear-forge/game-host/current';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {createSearchPolicy,type StsSearchResult} from '../src/search/policy.ts';
import {takeStsSearchCurrent,stsExactDomain} from '../src/search/current-session.ts';
import {readStsCurrent} from '../src/search/probability-current.ts';
import {describeAction} from '../src/presentation.ts';
import {contract,type StsTypes} from '../src/contract.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {battles} from '../src/rules/battles.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import type {StsEvent} from '../src/game.schemas.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const store=memorySnapshotStore();
const loadedPromise=createCardLoader({controlled:true,recordCore:false,snapshots:store}).load(combatContentDefinition);
const random={state:76,position:0};
function source(game:GameHandle<StsTypes>){const fork=async()=>unwrap(await game.fork!());registerCurrentSource(fork,game);return fork;}
async function request(game:GameHandle<StsTypes>){const s=unwrap(await game.inspect());if(s.kind!=='request')throw Error(JSON.stringify(s));return s.requests[0]!;}

const evidenceData=(result:StsSearchResult)=>result.evidence as {reason?:string;status:string;steps?:string};
const isSuspension=(reason:string)=>(error:unknown)=>error instanceof PolicyWorkSuspended&&error.reason===reason;

test('heap pressure retains the exact frontier without an action and does not swallow execution errors',async()=>{
  const loaded=unwrap(await loadedPromise),events:StsEvent[]=[];
  const game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character:'ironclad',encounter:encounterId.CULTIST,relics:[],potion:null,durable:true,elite:false,detailedEvents:true})),contract,persistence:loaded.persistence!}));
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async e=>{events.push(e.event);return{kind:'reply',value:null};}}));unwrap(await game.run());
  const before=await request(game),visibleHistory=events.map(event=>({event})),v8=createRequire(import.meta.url)('node:v8');
  const statistics=v8.getHeapStatistics;
  let evidence:StsSearchResult|undefined;
  const input={request:before,visibleHistory,memory:{},random,signal:new AbortController().signal};
  const policy=createSearchPolicy({character:'ironclad',schedulingMilliseconds:1,forkCurrent:source(game),onEvidence:r=>{evidence=r;}});
  const broken=createSearchPolicy({character:'ironclad',forkCurrent:async()=>{throw Error('unrelated execution defect');}});
  try{
    await assert.rejects(policy.decide(input),isSuspension('scheduling-yield'));
    const saved=policyWork(policy)!.save() as {entries:{search:unknown}[]};
    assert.equal(saved.entries.length,1);
    v8.getHeapStatistics=()=>({...statistics(),total_available_size:1});syncBuiltinESMExports();
    // A retained slice may first finish pure bookkeeping before its next
    // original allocation. Scheduling yields keep that work, too.
    for(;;){
      try{await policy.decide(input);assert.fail('Heap pressure cannot select an action');}
      catch(error){if(isSuspension('scheduling-yield')(error))continue;assert.ok(isSuspension('heap-pressure')(error));break;}
    }
    assert.equal(evidence!.action,null);assert.equal(evidenceData(evidence!).status,'incomplete');
    const paused=policyWork(policy)!.save() as {entries:{search:{steps:bigint}}[]};
    assert.equal(paused.entries.length,1,'live frontier is still owned after heap pressure');
    assert.ok(paused.entries[0]!.search.steps>0n);
    assert.deepEqual(await request(game),before);
    v8.getHeapStatistics=statistics;syncBuiltinESMExports();
    await assert.rejects(policy.decide(input),isSuspension('scheduling-yield'));
    const resumed=policyWork(policy)!.save() as typeof paused;
    assert.ok(resumed.entries[0]!.search.steps>paused.entries[0]!.search.steps,'same frontier advances when memory is available');
    await assert.rejects(broken.decide(input),/unrelated execution defect/);
    assert.deepEqual(await request(game),before);
  }finally{v8.getHeapStatistics=statistics;syncBuiltinESMExports();policyWork(policy)!.close();policyWork(broken)!.close();unwrap(await game.close());}
});

for(const character of ['ironclad','volibear'] as const)test(`${character}: original draw action expands the same complete weighted law despite hidden future changes, without initialization`,async()=>{
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
    const laws:Map<string,ProbabilityMass>[]=[];
    for(const current of [game,other]){
      const root=await takeStsSearchCurrent(source(current),events),view=readStsCurrent(root.current,root.events);
      const originalRoot=root.current.machine.storage.export(root.current.machine.root);
      const domain=stsExactDomain(root.current.machine.program,view.decision.observation,events.length);
      const action=view.decision.actions.find(action=>describeAction(view.decision.observation,action.bits).kind==='drink-potion');assert.ok(action);
      let expansion=domain.next(root,String(action.bits)),total=zeroMass();const law=new Map<string,ProbabilityMass>();
      try{
        // Transfer the live prefix once to a cold owner; never execute it again.
        expansion.step();const savedExpansion=deserialize(serialize(expansion.save()));expansion.close();expansion=domain.restoreExpansion(savedExpansion);
        for(;;){
          const outcome=expansion.take();
          if(outcome){
            try{const information=domain.position(outcome.current).information;law.set(information,addMass(law.get(information)??zeroMass(),outcome.mass));total=addMass(total,outcome.mass);}
            finally{domain.close(outcome.current);}
          }else if(expansion.complete)break;else expansion.step();
        }
        assert.deepEqual(total,unitMass());assert.deepEqual(expansion.delivered,unitMass());assert.ok(law.size>1);
        assert.deepEqual(root.current.machine.storage.export(root.current.machine.root),originalRoot,'root and authorized current enemy intent remain untouched');
        laws.push(law);
      }finally{expansion.close();domain.close(root);}
    }
    assert.deepEqual(laws[0],laws[1],'all public successors and their exact masses are invariant under hidden future changes');
    assert.deepEqual(await request(game),before);
    const account={milliseconds:60_000};let evidence:StsSearchResult|undefined;
    const policy=createSearchPolicy({character,schedulingMilliseconds:1,forkCurrent:source(game),account,onEvidence:r=>{evidence=r;}});
    const controller=new AbortController();controller.abort();
    try{
      await assert.rejects(policy.decide({request:before,visibleHistory,memory:{},random,signal:new AbortController().signal}),isSuspension('scheduling-yield'));
      assert.equal(evidence!.action,null);assert.ok(BigInt(evidenceData(evidence!).steps!)>0n);assert.ok(account.milliseconds>60_000,'old total accounting is not a search cutoff');
      const savedWork=policyWork(policy)!.save() as {entries:unknown[]};
      await assert.rejects(policy.decide({request:before,visibleHistory,memory:{},random,signal:controller.signal}),isSuspension('cancelled'));
      assert.deepEqual((policyWork(policy)!.save() as typeof savedWork).entries,savedWork.entries,'cancellation preserves pending work');
    }finally{policyWork(policy)!.close();}
    assert.deepEqual(await request(game),before);
  }finally{CardProgram.prototype.initial=original;unwrap(await other.close());unwrap(await game.close());unwrap(await loaded.persistence!.release(saved));}
});
