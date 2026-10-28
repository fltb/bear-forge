import test from 'node:test';
import assert from 'node:assert/strict';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import {PolicyWorkSuspended,policyWork} from '@bear-forge/policies/search/work';
import {cardDefinition} from '../src/card.ts';
import {contract} from '../src/contract.ts';
import type {JsonValue} from '@bear-forge/contracts/game';
import type {StsEvent} from '../src/game.schemas.ts';
import {publicDecision} from '../src/search/information.ts';
import {createSearchPolicy,type StsSearchResult} from '../src/search/policy.ts';
import type {StsCurrentSnapshot,StsExpansionSnapshot} from '../src/search/current-session.ts';
import type {SearchSessionSnapshot} from '@bear-forge/policies/search/session.types';

const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
type SavedWork={entries:{search:SearchSessionSnapshot<StsCurrentSnapshot,StsExpansionSnapshot>}[]};
const suspended=(error:unknown)=>error instanceof PolicyWorkSuspended&&error.reason==='scheduling-yield';

// Full production setup and adventure execution, followed by an unfinished
// combat frontier. This is an integration test, not a win or a bounded solver.
for(const character of ['ironclad','volibear'] as const)test(`${character}: adventure preferences enter combat and preserve an initially unobserved combat frontier`,async()=>{
  const loaded=unwrap(await createCardLoader({controlled:true,recordCore:false}).load(cardDefinition));
  let game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.core.start({seed:'130',character,detailedEvents:true})),contract,persistence:loaded.persistence!}));
  const events:StsEvent[]=[],windows=new Set<string>();let forks=0,evidence:StsSearchResult|undefined;
  const onEvent=async(delivery:{event:StsEvent})=>{events.push(delivery.event);return{kind:'reply' as const,value:null};};
  const makePolicy=()=>createSearchPolicy({character,schedulingMilliseconds:1,forkCurrent:async()=>{forks++;return unwrap(await game.fork!());},onEvidence:result=>{evidence=result;}});
  let policy=makePolicy(),random={state:76,position:0};let memory:JsonValue={};
  const initialize=CardProgram.prototype.initial;
  try{
    unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'pause'}),onEvent}));unwrap(await game.run());
    CardProgram.prototype.initial=()=>{throw Error('Current adventure must not initialize or replay');};
    for(;;){
      const before=unwrap(await game.inspect());if(before.kind!=='request')throw Error('Expected original adventure request');
      const request=before.requests[0]!,visibleHistory=events.map(event=>({event})),decision=publicDecision(request,visibleHistory);
      if(decision.observation.battle){
        assert.ok(decision.actions.length>1);
        await assert.rejects(policy.decide({request,visibleHistory,memory,random,signal:new AbortController().signal}),suspended);
        assert.equal(evidence!.action,null);assert.equal((evidence!.evidence as {status:string}).status,'incomplete');
        assert.ok(forks>0);assert.deepEqual(unwrap(await game.inspect()),before,'search accepts no real action');
        const work=policyWork(policy)!.save() as SavedWork;
        assert.equal(work.entries.length,1);assert.ok(work.entries[0]!.search.steps>0n);assert.ok(work.entries[0]!.search.queue.length>0);
        const checkpoint=unwrap(await game.save!());
        try{
          // Close the old owner before restoring. No old prefix is executed
          // to check the recovered Context, and the next edge is not restarted.
          policyWork(policy)!.close();unwrap(await game.close());
          game=unwrap(await createGameBinder().bind({instance:unwrap(await loaded.persistence!.restore(checkpoint)),contract,persistence:loaded.persistence!}));
          policy=makePolicy();policyWork(policy)!.restore(work);
          const restored=unwrap(await game.inspect());if(restored.kind!=='request')throw Error('Missing recovered combat request');
          assert.deepEqual(restored.requests[0]!.observation,request.observation);
          await assert.rejects(policy.decide({request:restored.requests[0]!,visibleHistory,memory,random,signal:new AbortController().signal}),suspended);
          const continued=policyWork(policy)!.save() as SavedWork;
          assert.equal(continued.entries.length,1);assert.ok(continued.entries[0]!.search.steps>work.entries[0]!.search.steps);
          assert.deepEqual(unwrap(await game.inspect()),restored);
        }finally{unwrap(await loaded.persistence!.release(checkpoint));}
        break;
      }
      windows.add(decision.observation.game.screen);
      const priorForks=forks,advance=CardMachine.prototype.advanceExactProbability;
      let proposal:Awaited<ReturnType<typeof policy.decide>>;
      try{
        CardMachine.prototype.advanceExactProbability=()=>{throw Error('Noncombat preferences must not explore future battles');};
        proposal=await policy.decide({request,visibleHistory,memory,random,signal:new AbortController().signal});
      }finally{CardMachine.prototype.advanceExactProbability=advance;}
      assert.equal(forks,priorForks,'noncombat preferences use the host request without a Context fork');
      assert.equal((policyWork(policy)!.save() as SavedWork).entries.length,0,'validation does not create a battle search');
      assert.equal((evidence!.evidence as {algorithm:string}).algorithm,'public-adventure');
      assert.ok(decision.actions.some(action=>JSON.stringify(action)===JSON.stringify(proposal.action)));
      assert.deepEqual(unwrap(await game.inspect()),before);
      const action=contract.schemas.actions.action.action.parse(proposal.action);
      unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:action}),onEvent}));
      assert.ok(unwrap(await game.run()).accepted,'one current public choice per accepted action');
      random=proposal.nextRandom;memory=proposal.nextMemory;
    }
    assert.ok(windows.has('EVENT_SCREEN'));assert.ok(windows.has('MAP_SCREEN'));
  }finally{CardProgram.prototype.initial=initialize;policyWork(policy)!.close();unwrap(await game.close());}
});
