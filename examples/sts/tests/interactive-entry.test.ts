import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {observe} from '../src/contract.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInteractiveSession} from '../src/interactive-session.ts';
import {presentDecision,describeCard} from '../src/presentation.ts';
import {cards} from '../src/cards.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';
import {relicId,potionId,eventId} from '../src/identifiers.ts';
import {relicTexts} from '../src/content/relics/descriptions.ts';
import {potionTexts} from '../src/content/potions/descriptions.ts';
import {eventMenus} from '../src/content/events/descriptions.ts';
import {eventNames} from '../src/pools.ts';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {encounterId} from '../src/identifiers.ts';
import {ironcladPotions} from '../src/pools.ts';
import type {InteractiveRecord} from '../src/interactive-session.types.ts';

function assertSelectionMetadata(r:InteractiveRecord){
  const s=r.observation.battle?.select;if(!s)return;
  const masks=r.actions.filter(a=>a.bits>>>29===3);
  if(masks.length){
    const counts=masks.map(a=>(a.bits&0x1fffffff).toString(2).replaceAll('0','').length),minimum=Math.min(...counts),maximum=Math.max(...counts);
    assert.equal(s.pickCount,maximum);assert.equal(s.canPickZero,minimum===0);
    assert.equal(s.canPickAnyNumber,minimum===0&&maximum===s.candidates!.length);
  }else{
    assert.equal(s.pickCount,1);assert.equal(s.canPickAnyNumber,false);
    assert.equal(s.canPickZero,s.skipIndex!==undefined&&r.actions.some(a=>(a.bits&0xffff)===s.skipIndex));
  }
}

test('combat potion presentation distinguishes discard, untargeted use and real enemy targets',()=>{
  const program=new CardProgram(combatContentDefinition);
  for(const name of ironcladPotions){
    const machine=new CardMachine(program,privateCardGraph(program.initial({seed:'130',encounter:encounterId.CULTIST,relics:[],potion:potionId[name],durable:true,elite:false},100_000_000)));
    let stop=machine.advance();
    const frame=()=>{
      while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
      if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected combat decision');return stop.call.input;
    };
    const f=frame(),o=observe(f),p=presentDecision(o,f.actions);
    const potionActions=p.actions.filter(a=>a.kind==='drink-potion'||a.kind==='discard-potion');
    const discard=potionActions.filter(a=>a.kind==='discard-potion');
    assert.equal(discard.length,1,name);assert.match(discard[0]!.label,/丢弃药水/);assert.ok(!discard[0]!.label.includes('敌人'));
    const drinks=potionActions.filter(a=>a.kind==='drink-potion');
    assert.equal(drinks.length,name==='FAIRY_POTION'?0:1,name);
    for(const a of drinks){
      const targeted=['FEAR_POTION','FIRE_POTION','WEAK_POTION'].includes(name);
      assert.equal(a.label.includes('敌人'),targeted,name);
      if(targeted)assert.ok(o.battle!.monsters.some(m=>m.index===a.details.target),name);
      else assert.equal(a.details.target,null,name);
    }
    if(name==='BLESSING_OF_THE_FORGE'){
      assert.ok(o.battle!.hand.some(c=>!c.upgraded));
      stop=machine.advance({bits:drinks[0]!.bits});
      assert.ok(observe(frame()).battle!.hand.every(c=>c.upgraded),'use upgrades actual hand');
    }else if(name==='FIRE_POTION'){
      stop=machine.advance({bits:discard[0]!.bits});
      const after=observe(frame());
      assert.equal(after.game.potions[0],potionId.EMPTY_POTION_SLOT);
      assert.deepEqual(after.battle!.monsters,o.battle!.monsters,'discard must not hit an enemy');
    }
  }
});

test('every static card, relic, potion and enabled event has presentation data',()=>{
  for(const id of [...Object.keys(cards),...Object.values(volibearCardDescriptions).map(c=>c.id)])for(const upgraded of [false,true])assert.ok(describeCard(id,upgraded).text,id);
  for(const id of Object.keys(relicId))assert.ok(relicTexts[id],id);
  for(const id of Object.keys(potionId))assert.ok(potionTexts[id],id);
  const nonEvents=new Set(['INVALID','MONSTER','REST','SHOP','TREASURE','NEOW','MATCH_AND_KEEP']);
  for(const [id,num]of Object.entries(eventId))if(!nonEvents.has(id))assert.ok(eventMenus[eventNames[num]],id);
});

test('Neow displays exact rounded HP and maximum HP costs matching both production characters',async()=>{
  for(const character of ['ironclad','volibear'] as const)for(const seed of ['3210101','210201']){
    const session=await createInteractiveSession({character,seed,sessionId:`neow-cost-${character}-${seed}`,review:false,onEvent:()=>{}});
    try{
      const state=await session.observe();if(state.kind!=='decision')throw Error('Expected Neow');const r=state.record;
      const p=presentDecision(r.observation,r.actions),healthCost=seed==='3210101';
      assert.equal(r.observation.game.hp,68);assert.equal(r.observation.game.maxHp,75);
      assert.equal(r.observation.game.neow![2]!.drawback,healthCost?5:2);
      assert.ok(p.actions[2]!.label.includes(healthCost?'失去26生命（68→42）':'失去8最大生命（75→67），当前生命68→67'));
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:2,reason:''});
      assert.equal(result.accepted,true);if(!result.accepted||result.status.kind!=='decision')throw Error('Expected post-Neow choice');
      const g=result.status.record.observation.game;
      assert.equal(g.hp,healthCost?42:67);assert.equal(g.maxHp,healthCost?75:67);
    }finally{await session.close();}
  }
});

test('presentation covers every event menu and actual selection candidate indices',()=>{
  const program=new CardProgram(combatContentDefinition);
  const storage=privateCardGraph(program.initial({seed:'130',encounter:encounterId.CULTIST,relics:[],potion:null,durable:true,elite:false},100_000_000));
  const machine=new CardMachine(program,storage);
  try{
    let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected fixture combat');
    const observation=structuredClone(observe(machine.storage.export(stop.call.input))),b=observation.battle!,card=b.hand[0]!;
    b.select={task:'EXHAUST_ONE',pickCount:1,canPickZero:true,canPickAnyNumber:false,candidates:[{index:7,card}],skipIndex:99};
    const actions=[{bits:(2<<29)|7},{bits:(2<<29)|99},{bits:(3<<29)|(1<<7)}];
    assertSelectionMetadata({sessionId:'presentation',decision:0,observation,actions:actions.slice(0,2)});
    const choices=presentDecision(observation,actions).actions;
    assert.match(choices[0]!.label,new RegExp(describeCard(card.id,card.upgraded).name));assert.equal(choices[1]!.kind,'skip-selection');assert.deepEqual(choices[2]!.details.indices,[7]);
    observation.battle=null;observation.game.screen='EVENT_SCREEN';delete observation.game.neow;
    for(const [name,menu] of Object.entries(eventMenus)){
      observation.game.eventName=name;
      const labels=presentDecision(observation,menu.map((_,bits)=>({bits}))).actions;
      assert.equal(labels.length,menu.length);assert.ok(labels.every(a=>a.label));
    }
    observation.game.optionDetails={'0':'献出已公开的指定遗物'};
    assert.equal(presentDecision(observation,[{bits:0}]).actions[0]!.label,'献出已公开的指定遗物');
  }finally{storage.close();}
});
