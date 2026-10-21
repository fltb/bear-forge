import test from 'node:test';
import assert from 'node:assert/strict';
import {productionDriver} from './production-driver.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';
import {createInteractiveSession} from '../src/interactive-session.ts';
import {presentDecision} from '../src/presentation.ts';
import type {StsEvent} from '../src/game.schemas.ts';
import type {InteractiveRecord} from '../src/interactive-session.types.ts';

test('multiple gold rewards have unique indexed actions and can each be claimed only once',async()=>{
  // Fixed diagnostic prefix from discarded B05; no automatic player policy.
  const prefix=[0,0,805306368,1,1,1,65538,2147483648,1,65539,1,2147483648,4,512,402653184,134217728,805306368,2,0,0,0,2147483648,4,3,2147483648,2,512,134217728,805306368,2,2,0,0,1,2147483648,2147483648,1,0,0,134217728,805306368,3,536870912,1073741824,5,3,3,2147483648,0,2];
  const session=await createInteractiveSession({character:'volibear',seed:'4210101',sessionId:'gold-rewards-regression',review:false,onEvent:()=>{}});
  try{
    let state=await session.observe();
    for(const bits of prefix){
      if(state.kind!=='decision')throw Error('Diagnostic prefix ended early');const r=state.record;
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===bits),reason:''});
      assert.equal(result.accepted,true);if(!result.accepted)throw Error('Diagnostic action rejected');state=result.status;
    }
    if(state.kind!=='decision')throw Error('Expected gold rewards');const initialGold=state.record.observation.game.gold;
    assert.deepEqual(state.record.observation.game.rewards!.gold,[12,20]);
    for(const [index,amount]of [12,20].entries()){
      if(state.kind!=='decision')throw Error('Expected remaining rewards');const r:InteractiveRecord=state.record;
      assert.equal(new Set(r.actions.map(a=>a.bits)).size,r.actions.length);
      const gold=presentDecision(r.observation,r.actions).actions.filter(a=>a.kind==='take-gold');
      assert.equal(gold.length,2-index);assert.equal(gold[0]!.label,`领取${amount}金币`);
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:gold[0]!.id,reason:''});
      assert.equal(result.accepted,true);if(!result.accepted)throw Error('Gold claim rejected');state=result.status;
    }
    if(state.kind!=='decision')throw Error('Expected remaining card rewards');
    assert.equal(state.record.observation.game.gold,initialGold+32);
    assert.deepEqual(state.record.observation.game.rewards!.gold,[]);
    assert.ok(!presentDecision(state.record.observation,state.record.actions).actions.some(a=>a.kind==='take-gold'));
  }finally{await session.close();}
});

test('normal Volibear U15 continuation says exhaust and actually exhausts before drawing two',async()=>{
  // Fixed diagnostic prefix from the discarded B02 run; never used as a player policy.
  const prefix=[1,3,0,2147483648,1,0,1,2147483648,1,2,0,2147483648,1,1,256,134217728,805306368,3,2147483648,1,1,0,2147483648,65536,65538,65536,512,402653184,134217728,805306368,4,1,1,0,2147483648,3,3,2147483648,2,1,0,134217728,805306368,5,4];
  const events:StsEvent[]=[];
  const session=await createInteractiveSession({character:'volibear',seed:'1210101',sessionId:'u15-regression',review:false,onEvent:e=>{events.push(e);}});
  try{
    let state=await session.observe();
    for(const bits of prefix){
      if(state.kind!=='decision')throw Error('Diagnostic prefix ended early');const r=state.record;
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===bits),reason:''});
      assert.equal(result.accepted,true);if(!result.accepted)throw Error('Diagnostic action rejected');state=result.status;
    }
    if(state.kind!=='decision')throw Error('Expected U15 selection');const r=state.record,b=r.observation.battle!;
    assert.equal(b.select!.task,'消耗牌');
    const choices=presentDecision(r.observation,r.actions).actions;
    assert.ok(choices.every(a=>a.label.startsWith('消耗：')));
    const selected=b.select!.candidates!.find(c=>c.card.id==='ASCENDERS_BANE')!;
    const eventStart=events.length;
    const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===((2<<29)|selected.index)),reason:''});
    assert.equal(result.accepted,true);if(!result.accepted||result.status.kind!=='decision')throw Error('Expected post-U15 combat');
    const after=result.status.record.observation.battle!;
    assert.ok(after.exhaust.some(c=>c.uniqueId===selected.card.uniqueId));
    assert.ok(!after.discard.some(c=>c.uniqueId===selected.card.uniqueId));
    assert.equal(after.hand.length,b.hand.length-1+2);
    const delta=events.slice(eventStart).filter(e=>e.kind==='detail');
    assert.ok(delta.some(e=>e.type==='exhaust'&&e.data.id==='ASCENDERS_BANE'));
    assert.equal(delta.filter(e=>e.type==='draw').length,2);
  }finally{await session.close();}
});

test('Volibear normal A20 start, rewards and successive combats agree in both executors',()=>{
  const native=productionDriver('130',false,'volibear'),controlled=productionDriver('130',true,'volibear');
  const pool=new Set(Object.values(volibearCardDescriptions).map(c=>c.id));
  const combats=new Set<number>();let rewards=0;
  try{
    const initial=native.frame();
    assert.equal(initial.game.maxHp,75);assert.equal(initial.game.hp,68);
    assert.equal(initial.game.deck.length,11);
    assert.equal(initial.game.deck.filter(c=>c.id==='VOLIBEAR_B01').length,4);
    assert.equal(initial.game.deck.filter(c=>c.id==='VOLIBEAR_B02').length,4);
    assert.ok(initial.game.relics.some(r=>r.id==='VOLIBEAR_HUNTERS_HEART'));
    for(let decision=0;decision<120;decision++){
      const frame=native.frame();assert.deepEqual(controlled.frame(),frame,`decision ${decision}`);
      if(frame.battle){
        if(!combats.has(frame.game.floor)){
          assert.equal(frame.battle.turn,0);assert.equal(frame.battle.player.energy,3);
          assert.equal(frame.battle.hand.length,5);assert.equal(frame.battle.player.strength,0);
          combats.add(frame.game.floor);
        }
        if(combats.size===3){assert.ok(frame.game.deck.length>=13);break;}
      }
      for(const offer of frame.game.rewards?.cards??[]){
        rewards++;for(const card of offer)assert.ok(pool.has(card.id),card.id);
      }
      assert.ok(frame.actions.length>0);
      const bits=frame.actions[0]!.bits;native.advance(bits);controlled.advance(bits);
    }
    assert.equal(combats.size,3);assert.ok(rewards>0);
  }finally{native.close();controlled.close();}
});
