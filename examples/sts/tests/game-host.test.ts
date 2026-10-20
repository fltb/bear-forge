import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCardLoader} from '@bear-forge/runtime-card';
import {createGameBinder} from '@bear-forge/game-host';
import type {Outcome} from '@bear-forge/contracts/instance';
import {cardDefinition} from '../src/card.ts';
import {contract,observe} from '../src/contract.ts';
import {type GameEvent} from '../src/game.schemas.ts';
import {publishReference} from './reference/publication.ts';
import {ReferenceClient} from './reference/client.ts';
import type {Trace} from './reference/play.ts';

const unwrap=<T,E>(r:Outcome<T,E>):T=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
for(const controlled of [false,true])test(`production BaseGame completes normal A20 Heart with every event and visible choice; controlled=${controlled}`,async()=>{
  const trace=JSON.parse(await readFile(new URL('./reference/fixtures/ironclad-a20-heart-130.json',import.meta.url),'utf8')) as Trace;
  const ref=await ReferenceClient.create(),loadAt=performance.now(),loaded=unwrap(await createCardLoader({controlled,stepBudget:100_000_000}).load(cardDefinition));
  const loadMs=performance.now()-loadAt,startAt=performance.now();
  const instance=unwrap(await loaded.core.start({seed:trace.seed}));
  const startMs=performance.now()-startAt,bindAt=performance.now();
  const game=unwrap(await createGameBinder().bind({instance,contract,...(loaded.persistence?{persistence:loaded.persistence}:{})}));
  const bindMs=performance.now()-bindAt;let runMs=0;
  const run=async()=>{const at=performance.now();try{return unwrap(await game.run());}finally{runMs+=performance.now()-at;}};
  try {
    let reference=await ref.call({op:'start',seed:trace.seed}),next=0;
    const events:GameEvent[]=[];await run();
    unwrap(await game.bind({player:'0',onRequest:async()=>({kind:'reply',value:{bits:next}}),onEvent:async e=>{events.push(e.event);return {kind:'reply',value:null};}}));
    for(let i=0;i<=trace.actions.length;i++) {
      const state=unwrap(await game.inspect());if(i===trace.actions.length){assert.equal(state.kind,'ended',JSON.stringify(state));if(state.kind!=='ended')throw Error('A20 Heart run did not end');assert.equal(state.result.outcome,'victory');assert.equal(state.result.heartDefeated,true);assert.equal(state.result.hp,reference.game.hp);assert.deepEqual(events,trace.actions);break;}assert.equal(state.kind,'request');if(state.kind!=='request')throw Error('Expected a request');
      const req=state.requests[0]!,options=unwrap(await game.describe({requestId:req.id,type:'action'}));
      assert.deepEqual(options,{kind:'exact',values:reference.actions.map(a=>({bits:a.bits}))});
      const expected=publishReference(reference,trace.actions.slice(0,i));
      assert.deepEqual(req.observation,observe(expected));assert.deepEqual(unwrap(await game.observe({player:'0'})),req.observation);
      const publicGame=req.observation.game as Record<string,unknown>;
      for(const field of ['rng','seed','monsterList','eliteList','eventList','relicPools','colorlessPool'])assert.equal(Object.hasOwn(publicGame,field),false,field+' must stay private');
      if(req.observation.battle){const b=req.observation.battle as Record<string,unknown>;assert.equal(Object.hasOwn(b,'rng'),false);assert.equal(Object.hasOwn(b,'draw'),false);}
      assert.deepEqual(events,trace.actions.slice(0,i));
      const invalid={requestId:req.id,type:'action' as const,action:{bits:0xffffffff}};
      assert.equal(unwrap(await game.validate({player:'0',reply:invalid})).valid,false);assert.deepEqual(unwrap(await game.inspect()),state);
      if(i===21)assert.equal(publicGame.screen,'MAP_SCREEN');
      next=trace.actions[i]!.bits;
      assert.equal(unwrap(await game.validate({player:'0',reply:{...invalid,action:{bits:next}}})).valid,true);
      const result=await run();assert.equal(result.accepted?.kind,'action');
      reference=await ref.call({op:'advance',bits:next});
      const stale=await game.validate({player:'0',reply:{...invalid,action:{bits:next}}});assert.ok(!stale.ok||!stale.value.valid,'stale credentials must fail');
    }
    console.log('STS GameHost cost '+JSON.stringify({controlled,decisions:trace.actions.length,loadMs,startMs,bindMs,runMs,runMsPerDecision:runMs/trace.actions.length,rssBytes:process.memoryUsage().rss}));
  }finally{await game.close();await loaded.capture?.release(instance.id);await ref.close();}
});
