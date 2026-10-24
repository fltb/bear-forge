import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {search,SearchBudget,defaultSearchLimits,type SearchDomain} from '@bear-forge/policies';
import {ProbabilityCurrent} from '../../../packages/runtime-card/src/probability.ts';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {contract} from '../src/contract.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import type {StsEvent} from '../src/game.schemas.ts';
import {createStsProbabilityContinuation} from '../src/search/probability-current.ts';
import {publicDecision,actionKey,type PublicDecision} from '../src/search/information.ts';
import {withStsProbabilityTracking} from '../src/search/tracking.ts';
import {searchEntropyWord} from '../../../packages/policies/src/search/entropy.ts';
import {registerCurrentSource} from '../../../packages/game-host/src/current.ts';
import {openStsSearchBudget} from '../src/search/resources.ts';
import type {SearchCurrent} from '@bear-forge/policies';
import {position,baseline} from '../src/search/evaluation.ts';

const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const cursor={state:76,position:0};
async function fixture(){
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(combatContentDefinition));
  const instance=unwrap(await loaded.core.start({seed:'130',encounter:encounterId.CULTIST,relics:[],potion:potionId.ATTACK_POTION,durable:false,elite:false,detailedEvents:true}));
  const game=unwrap(await createGameBinder().bind({instance,contract})),events:StsEvent[]=[];
  unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent:async e=>{events.push(e.event);return{kind:'reply',value:null};}}));
  unwrap(await game.run());
  const before=unwrap(await game.inspect());if(before.kind!=='request')throw Error('Expected root request');
  const root=position(publicDecision(before.requests[0]!,events.map(event=>({event}))));
  const domain=():SearchDomain=>{
    const adapter=createStsProbabilityContinuation();
    return{root,baseline,next:adapter.next,async current(random,budget){
      const current=await adapter.take(unwrap(await game.fork!()),events,budget);budget.accepted++;
      return{particles:[{current,weight:1}],representation:'exact',random,method:'actual-current-probability',reason:null};
    }};
  };
  return{game,before,root,domain};
}
const budget=(nodes=10000,signal=new AbortController().signal)=>new SearchBudget({...defaultSearchLimits,mode:'work',worlds:4,decisions:1,simulations:64,nodes},signal);

test('real R1/R2 search consumes production weighted successors and events without reinitializing the root',async()=>{
  const f=await fixture(),initialize=CardProgram.prototype.initial;
  try{
    CardProgram.prototype.initial=function(){throw Error('Search must not initialize');};
    for(const algorithm of ['r1','r2'] as const){
      const first=await search(f.domain(),algorithm,cursor,budget()),second=await search(f.domain(),algorithm,cursor,budget());
      assert.equal(first.evidence.coverageComplete,true);assert.equal(first.evidence.completed,f.root.actions.length);
      assert.equal(first.evidence.representation,'particles');assert.ok(first.evidence.advances>f.root.actions.length);
      assert.ok(first.random.position>cursor.position);assert.deepEqual(first.random,second.random);
      assert.deepEqual(first.evidence,second.evidence);assert.deepEqual(first.action,second.action);
      assert.ok(first.cost.phases.fork!.calls>0);assert.ok(first.cost.phases.advance!.calls>first.evidence.advances);
      assert.ok(first.evidence.actions.some(action=>action.outcomes.length>1));
      assert.deepEqual(unwrap(await f.game.inspect()),f.before);
    }
  }finally{CardProgram.prototype.initial=initialize;unwrap(await f.game.close());}
});

test('a production probability node budget discards partial action mass and releases internal branches',async()=>{
  const f=await fixture(),fork=ProbabilityCurrent.prototype.fork,close=ProbabilityCurrent.prototype.close,active=new Set<object>();
  try{
    ProbabilityCurrent.prototype.fork=function(){const child=fork.call(this);active.add(child);return child;};
    ProbabilityCurrent.prototype.close=function(){close.call(this);active.delete(this);};
    const result=await search(f.domain(),'r2',cursor,budget(5));
    assert.equal(result.evidence.reason,'node-budget');assert.equal(result.evidence.coverageComplete,false);
    assert.ok(result.evidence.nodes<=5);assert.equal(result.evidence.completed,0);
    assert.ok(result.evidence.actions.every(action=>action.outcomes.length===0));assert.equal(active.size,0);
    assert.deepEqual(unwrap(await f.game.inspect()),f.before);
  }finally{ProbabilityCurrent.prototype.fork=fork;ProbabilityCurrent.prototype.close=close;unwrap(await f.game.close());}
});

test('cancellation inside real chance generation closes partial outcomes and leaves the actual game unchanged',async()=>{
  const f=await fixture(),domain=f.domain(),next=domain.next,controller=new AbortController();
  const fork=ProbabilityCurrent.prototype.fork,close=ProbabilityCurrent.prototype.close,active=new Set<object>();
  let words=0;
  domain.next=async function*(current,expansion){yield* next(current,{...expansion,word(){const result=expansion.word();if(++words===2)controller.abort();return result;}});};
  try{
    ProbabilityCurrent.prototype.fork=function(){const child=fork.call(this);active.add(child);return child;};
    ProbabilityCurrent.prototype.close=function(){close.call(this);active.delete(this);};
    const result=await search(domain,'r2',cursor,budget(10000,controller.signal));
    assert.equal(result.evidence.reason,'cancelled');assert.equal(result.evidence.coverageComplete,false);assert.equal(words,2);
    assert.equal(active.size,0);assert.deepEqual(unwrap(await f.game.inspect()),f.before);
  }finally{ProbabilityCurrent.prototype.fork=fork;ProbabilityCurrent.prototype.close=close;unwrap(await f.game.close());}
});


test('both characters reuse the actual Runic Dome intent and original settlement across consecutive turns and direct restore',async()=>{
  const definition=withStsProbabilityTracking(combatContentDefinition);
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(definition));
  for(const character of ['ironclad','volibear'] as const){
    const instance=unwrap(await loaded.core.start({seed:'130',character,encounter:encounterId.BOOK_OF_STABBING,relics:['RUNIC_DOME'],potion:null,durable:true,elite:true,detailedEvents:true}));
    const game=unwrap(await createGameBinder().bind({instance,contract,persistence:loaded.persistence!})),events:StsEvent[]=[];
    const onEvent=async(e:{event:StsEvent})=>{events.push(e.event);return{kind:'reply' as const,value:null};};
    unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent}));
    unwrap(await game.run());
    const initialize=CardProgram.prototype.initial,losses:number[]=[];
    CardProgram.prototype.initial=function(){throw Error('Search cannot initialize or replay');};
    try{for(let turn=0;turn<2;turn++){
      const before=unwrap(await game.inspect());if(before.kind!=='request')throw Error('Expected actual current');
      const decision=publicDecision(before.requests[0]!,events.map(event=>({event}))),end=decision.actions.find(action=>action.bits>>>29===4);assert.ok(end);
      assert.equal(decision.observation.battle!.intentHidden,true);
      assert.deepEqual(decision.observation.battle!.intents,[],'search authorization must not change the original public contract');
      // Continue an owned sibling through normal production execution exactly
      // once. It is the settlement reference for this CURRENT action, not a
      // second damage formula or an initialization/history reconstruction.
      const reference=unwrap(await game.fork!());let expectedHp:number,expectedTurn:number;
      try{
        let sent=false;
        unwrap(await reference.bind({player:'0',onRequest:async()=>{if(sent)return{kind:'pause'};sent=true;return{kind:'reply',value:end};},onEvent:async()=>({kind:'reply',value:null})}));
        while(unwrap(await reference.run()).accepted){}
        const after=unwrap(await reference.inspect());if(after.kind!=='request')throw Error('Expected original next turn');
        const observation=publicDecision(after.requests[0]!,[]).observation;
        expectedHp=observation.battle!.player.hp;expectedTurn=observation.battle!.turn;
        assert.ok(expectedTurn>decision.observation.battle!.turn);
        losses.push(decision.observation.battle!.player.hp-expectedHp);
      }finally{unwrap(await reference.close());}
      const saved=unwrap(await game.save!()),restoredInstance=unwrap(await loaded.persistence!.restore(saved));
      const restored=unwrap(await createGameBinder().bind({instance:restoredInstance,contract,persistence:loaded.persistence!}));
      try{
        const collected=[];
        for(const source of [game,restored]){
          const forkSource=async()=>unwrap(await source.fork!());registerCurrentSource(forkSource,source);
          const resources=await openStsSearchBudget(forkSource,{...defaultSearchLimits,mode:'work',worlds:8,decisions:1},new AbortController().signal,0);
          const adapter=createStsProbabilityContinuation(),limits=resources.budget;
          assert.ok(limits.cost().phases.preparation!.milliseconds>0);
          let root:SearchCurrent|undefined;
          try{
            root=await adapter.take(forkSource,events,limits);
            assert.equal(root.position.information,position(decision).information);assert.equal(adapter.representation(root),'exact');
            let random={state:76,position:0},reached=false;
            for await(const edge of adapter.next(root,{budget:limits,word(){const draw=searchEntropyWord(random);random=draw.random;return draw.value;}})){
              try{
                if(edge.action!==actionKey(end))continue;
                reached=true;assert.equal(edge.representation,'particles');
                assert.ok(Math.abs(edge.outcomes.reduce((sum,row)=>sum+row.probability,0)-1)<1e-12);
                assert.ok(edge.outcomes.length>1,'future draws and subsequent AI rolls still expand through the original probability kernel');
                for(const row of edge.outcomes){
                  const child=JSON.parse(row.current.position.information) as PublicDecision;
                  assert.equal(child.observation.battle!.turn,expectedTurn);
                  assert.equal(child.observation.battle!.player.hp,expectedHp,'every branch settles the actual current intent with its original hit counts and callbacks');
                  assert.equal(child.observation.battle!.intentHidden,true);
                }
                collected.push({random,outcomes:edge.outcomes.map(row=>({information:row.current.position.information,probability:row.probability}))});
                break;
              }finally{for(const row of edge.outcomes)await row.current.close();}
            }
            assert.equal(reached,true);assert.ok(limits.cost().phases.advance!.calls>0);
          }finally{await root?.close();assert.ok(resources.close()>0);}
          if(source===restored){
            const exhausted=await openStsSearchBudget(forkSource,defaultSearchLimits,new AbortController().signal,60_000);
            try{assert.throws(()=>exhausted.budget.check(),/game-search-budget/);}
            finally{assert.ok(exhausted.close()>=60_000);}
          }
        }
        assert.deepEqual(collected[0],collected[1],'direct restore preserves current intent, future weights and search entropy');
        assert.deepEqual(unwrap(await game.inspect()),before,'all search and reference branches leave their parent unchanged');
      }finally{unwrap(await restored.close());unwrap(await loaded.persistence!.release(saved));}
      if(turn===0){
        let sent=false;
        unwrap(await game.bind({player:'0',onRequest:async()=>{if(sent)return{kind:'pause'};sent=true;return{kind:'reply',value:end};},onEvent}));
        while(unwrap(await game.run()).accepted){}
      }
    }
    assert.equal(new Set(losses).size,2,'the retained seed must exercise both the original single-stab and multi-stab turns');
    }finally{CardProgram.prototype.initial=initialize;unwrap(await game.close());}
  }
});
