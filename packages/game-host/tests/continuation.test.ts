import test from 'node:test';
import assert from 'node:assert/strict';
import {serialize,deserialize} from 'node:v8';
import {z} from 'zod';
import {card,type CardDefinition} from '@bear-forge/card-engine';
import type {GameContract} from '@bear-forge/contracts/authoring';
import {createCardLoader} from '@bear-forge/runtime-card';
import {memorySnapshotStore} from '../../runtime-card/src/store.ts';
import {ExecutionSuspended,restoreContinuation,continuationControl} from '../../runtime/src/continuation.ts';
import {createGameBinder,restoreGameContinuation} from '../src/binder.ts';
import {gameExecutionControl} from '../src/current.ts';

type Ports={ask:{kind:'request';input:number;output:number};event:{kind:'event';input:number;output:null}};
type G={setup:null;ports:Ports;programResult:number;view:number;player:'a';observation:number;
  actions:{pick:{request:null;action:number;description:never}};event:number;playerEvent:number;result:number;control:never};
const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};

test('a whole GameHost transaction survives cold suspension in both its accepted action and later event',async()=>{
  const counts={initial:0,operations:0,decisions:0,events:0,adapters:0};
  const definition:CardDefinition<{n:number},null,Ports,number>={id:'game-original-continuation',
    schemas:{setup:z.null(),result:z.number(),ports:{ask:{input:z.number(),output:z.number()},event:{input:z.number(),output:z.null()}}},
    initialize(){counts.initial++;return{n:0};},entry:'root',effects:[{id:'root',steps:[
      card.request(()=>({port:'ask',input:0}),'answer'),
      card.operation<{n:number}>(s=>{s.state.n++;counts.operations++;}),
      card.request(s=>({port:'event',input:s.locals.answer})),
      card.operation<{n:number}>(s=>{s.state.n++;counts.operations++;}),card.return(s=>s.locals.answer),
    ]}]};
  const contract:GameContract<G>={
    schemas:{view:z.number(),player:z.literal('a'),observation:z.number(),event:z.number(),playerEvent:z.number(),result:z.number(),
      actions:{pick:{request:z.null(),action:z.number(),description:z.never()}}},
    ports:{ask:{kind:'request',receive(view){counts.adapters++;return{view,requests:[{key:'pick',player:'a',type:'pick',data:null}]};},
      respond(_view,_request,action){counts.adapters++;return{valid:true,output:action};}},
      event:{kind:'event',receive(event){counts.adapters++;return{events:[event],output:null};}}},
    inputs:{pick:{options:z.object({kind:z.literal('exact'),values:z.array(z.number())}),describe(){counts.adapters++;return{kind:'exact',values:[7]};}}},
    observe(view){counts.adapters++;return view;},projectEvent(event){counts.adapters++;return{event};},
    finish(result){counts.adapters++;return{view:result,result};}
  };
  const loaded=unwrap(await createCardLoader({snapshots:memorySnapshotStore(),recordCore:false,instructionsPerSlice:1}).load(definition));
  let instance=unwrap(await loaded.core.start(null)),game=unwrap(await createGameBinder().bind<G>({instance,contract,persistence:loaded.persistence!}));
  let control=gameExecutionControl(game)!,firstAccepted:unknown,actionStops=0,eventStops=0;
  const binding={player:'a',async onRequest(){counts.decisions++;return{kind:'reply',value:7};},async onEvent(){counts.events++;return{kind:'reply',value:null};}};
  try{
    unwrap(await game.bind({...binding,player:'a',onRequest:async()=>{counts.decisions++;return{kind:'reply',value:7};},onEvent:async()=>{counts.events++;return{kind:'reply',value:null};}}));
    control.schedule(()=> 'test-slice');await assert.rejects(()=>game.run(),ExecutionSuspended);
    for(;;){
      assert.equal(control.pending(),true);assert.equal((await game.inspect()).ok,false);assert.equal((await game.bind(null)).ok,false);
      const saved=deserialize(serialize(await control.save())),before={...counts};
      if(saved.game.run.pending.accepted){actionStops++;firstAccepted??=saved.game.run.pending.accepted;assert.deepEqual(saved.game.run.pending.accepted,firstAccepted);}
      else{eventStops++;assert.deepEqual(saved.game.run.accepted,firstAccepted);}
      await control.close();instance=await restoreContinuation(loaded,saved.snapshot);
      const malformed=deserialize(serialize(saved.game));malformed.run.pending.callId='different-call';
      assert.equal((await restoreGameContinuation({instance,contract,persistence:loaded.persistence},malformed)).ok,false);
      assert.equal(continuationControl(instance)!.pending(),true,'rejected host data cannot consume the restored owner');
      const restored=await restoreGameContinuation({instance,contract,persistence:loaded.persistence},saved.game);
      assert.equal(restored.ok,true);game=restored.value;
      control=gameExecutionControl(game)!;assert.deepEqual(counts,before,'restoring cannot re-run original operations, callbacks or adapters');
      unwrap(await control.bind(binding));control.schedule(()=> 'test-slice');
      try{
        const outcome=await control.resume();assert.equal(outcome.ok,true);const finished=outcome.value;
        assert.deepEqual(finished.state,{kind:'ended',result:7});assert.deepEqual(finished.accepted,firstAccepted);
        unwrap(await loaded.persistence!.release(saved.snapshot));break;
      }catch(error){if(!(error instanceof ExecutionSuspended))throw error;unwrap(await loaded.persistence!.release(saved.snapshot));}
    }
    assert.ok(actionStops>1);assert.ok(eventStops>0);assert.equal(counts.initial,1);assert.equal(counts.operations,2);
    assert.equal(counts.decisions,1);assert.equal(counts.events,1);
  }finally{if(control.pending())await control.close();else unwrap(await game.close());}
});
