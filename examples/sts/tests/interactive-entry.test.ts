import {productionDriver} from './production-driver.ts';
import {observe} from '../src/contract.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createInteractiveSession} from '../src/interactive-session.ts';
import {presentDecision,describeCard} from '../src/presentation.ts';
import {cards} from '../src/cards.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';
import {relicId,potionId,eventId} from '../src/identifiers.ts';
import {relicTexts} from '../src/content/relics/descriptions.ts';
import {potionTexts} from '../src/content/potions/descriptions.ts';
import {eventMenus} from '../src/content/events/descriptions.ts';
import {eventNames} from '../src/pools.ts';
import type {StsEvent} from '../src/game.schemas.ts';
import {CardProgram,CardMachine,plainCardStorage} from '@bear-forge/card-engine';
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

test('chest sapphire key and its linked relic are mutually exclusive in either claim order',async()=>{
  // Fixed B09 normal-start diagnostic prefix, not a player policy.
  const prefix=[1,0,1,1,0,2147483648,3,2,2147483648,1,2,2,256,134217728,805306368,0,2,0,2,2147483648,65537,2,2147483648,65536,512,402653184,134217728,805306368,0,0,0,2147483648,4,3,2,2147483648,3,512,134217728,805306368,1,1,2,402653185,805306368,1,536870913,536870912,4,2147483648,0,0,0,2147483648,1,2,0,2147483648,3,0,2,2147483648,1,1,0,2147483648,2,0,2147483648,1,2,2147483648,2,536870912,268435456,512,134217728,805306368,0,65537,0,0,2147483648,0,65536,65536,0,2147483648,0,0,0,402653184,134217728,805306368,0,0,1,0];
  for(const takeKey of [false,true]){
    const session=await createInteractiveSession({character:'ironclad',seed:'8210101',sessionId:'chest-key-'+takeKey,review:false,onEvent:()=>{}});
    try{
      let state=await session.observe();
      for(const bits of prefix){
        if(state.kind!=='decision')throw Error('Diagnostic prefix ended early');const r=state.record;
        const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===bits),reason:''});
        assert.equal(result.accepted,true);if(!result.accepted)throw Error('Diagnostic action rejected');state=result.status;
      }
      if(state.kind!=='decision')throw Error('Expected chest reward');const r=state.record;
      assert.equal(r.observation.game.rewards!.sapphireKey,true);
      assert.equal(r.observation.game.rewards!.relics.length,1);
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===(takeKey?2<<27:4<<27)),reason:''});
      assert.equal(result.accepted,true);if(!result.accepted||result.status.kind!=='decision')throw Error('Expected remaining rewards');
      const after=result.status.record,g=after.observation.game;
      assert.equal(g.rewards!.sapphireKey,false);assert.deepEqual(g.rewards!.relics,[]);
      assert.equal(g.keys.blue,takeKey);assert.equal(g.relics.some(x=>x.id==='DEAD_BRANCH'),!takeKey);
      assert.ok(!after.actions.some(a=>a.bits===(2<<27)||a.bits===(4<<27)));
    }finally{await session.close();}
  }
});

test('Lagavulin wakes and loses sleep armor after HP damage inside a permanent domain',async()=>{
  // Fixed B08 diagnostic prefix, not a player policy.
  const prefix=[0,3,1,2,2,2147483648,2,0,65537,2147483648,65538,65536,65538,2147483648,65536,65536,0,134217728,805306368,3,1,1,2,2147483648,1,1,2147483648,4,2,0,134217728,805306368,4,1,1,2147483648,0,0,512,402653184,134217728,805306368,3,0,4,1,2,402653184,0,805306368,3,0,2147483648,2,2147483648,536870912,4];
  const session=await createInteractiveSession({character:'volibear',seed:'7210101',sessionId:'domain-wake-regression',review:false,onEvent:()=>{}});
  try{
    let state=await session.observe();
    for(const [index,bits]of prefix.entries()){
      if(state.kind!=='decision')throw Error('Diagnostic prefix ended early');const r=state.record;
      if(index===prefix.length-1){const b=r.observation.battle!;assert.equal(b.monsters[0]!.hp,112);assert.ok(b.domain!.active);assert.equal(b.domain!.untilTurn,null);assert.ok(b.effects!.some(e=>e.name==='ASLEEP'&&e.active));}
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===bits),reason:''});
      assert.equal(result.accepted,true);if(!result.accepted)throw Error('Diagnostic action rejected');state=result.status;
    }
    if(state.kind!=='decision')throw Error('Expected woken combat');const r=state.record,b=r.observation.battle!;
    assert.equal(b.monsters[0]!.hp,93);assert.ok(b.domain!.active);
    assert.ok(!b.effects!.some(e=>e.name==='ASLEEP'&&e.active));
    assert.ok(!b.effects!.some(e=>e.name==='METALLICIZE'&&e.active));
    const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===0x80000000),reason:''});
    assert.equal(result.accepted,true);if(!result.accepted||result.status.kind!=='decision')throw Error('Expected next player turn');
    assert.ok(result.status.record.observation.battle!.intents!.some(i=>i.name==='LAGAVULIN_ATTACK'));
  }finally{await session.close();}
});

test('shop Orrery presentation discloses its current inert acquisition before purchase',async()=>{
  // Fixed B07 diagnostic prefix; this records a source limitation, not original STS parity.
  const prefix=[1,2,1,65539,2,2147483648,65536,0,512,134217728,402653184,805306368,3,0,4,4,1,2];
  const session=await createInteractiveSession({character:'volibear',seed:'6210201',sessionId:'orrery-description-regression',review:false,onEvent:()=>{}});
  try{
    let state=await session.observe();
    for(const bits of prefix){
      if(state.kind!=='decision')throw Error('Diagnostic prefix ended early');const r=state.record;
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===bits),reason:''});
      assert.equal(result.accepted,true);if(!result.accepted)throw Error('Diagnostic action rejected');state=result.status;
    }
    if(state.kind!=='decision')throw Error('Expected shop');const r=state.record,g=r.observation.game;
    const shown=presentDecision(r.observation,r.actions).rules.relics.find(x=>x.id==='ORRERY')!;
    assert.equal(shown.text,'当前实现没有获得效果，不提供卡牌奖励。');
    const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===((4<<27)|2)),reason:''});
    assert.equal(result.accepted,true);if(!result.accepted||result.status.kind!=='decision')throw Error('Expected shop continuation');
    const after=result.status.record;
    assert.equal(after.observation.game.gold,g.gold-118);assert.equal(after.observation.game.deck.length,g.deck.length);
    assert.ok(after.observation.game.relics.some(x=>x.id==='ORRERY'));assert.equal(after.observation.game.screen,'SHOP_ROOM');
    const leave=await session.act({op:'act',sessionId:after.sessionId,decision:after.decision,action:after.actions.findIndex(a=>a.bits===(6<<27)),reason:''});
    assert.equal(leave.accepted,true);if(!leave.accepted||leave.status.kind!=='decision')throw Error('Expected map continuation');
    assert.equal(leave.status.record.observation.game.screen,'MAP_SCREEN');assert.equal(leave.status.record.observation.game.rewards,undefined);
    for(const id of ['ORRERY','DOLLYS_MIRROR','OLD_COIN','WING_BOOTS','TOY_ORNITHOPTER','PRISMATIC_SHARD','DARKSTONE_PERIAPT'])assert.ok(relicTexts[id]!.includes('当前'),id+' must disclose source limitations');
  }finally{await session.close();}
});

test('Gambler continuation publishes actual zero-to-all cardinality and accepts empty selection',async()=>{
  // Fixed B06 diagnosis from an invalidated player run, not a play policy.
  const prefix=[0,0,65538,1,0,2147483648,65536,65536,2147483648,65540,256,134217728,805306368,0,0,0,0,2147483648,1,3,2147483648,2,0,1,0,2147483648,0,256,402653184,134217728,805306368,0,3,65537,0,0,2147483648,65539,3,0,134217728,805306368,1,1,0,0,1,402653185,805306368,1,4,1,0,0,2147483648,3,1610612743,4,5,3,3,2147483648,1,536870912,256,134217728,805306368,1,1,14,1,536870912];
  const session=await createInteractiveSession({character:'volibear',seed:'5210101',sessionId:'gamble-regression',review:false,onEvent:()=>{}});
  try{
    let state=await session.observe();
    for(const bits of prefix){
      if(state.kind!=='decision')throw Error('Diagnostic prefix ended early');const r=state.record;assertSelectionMetadata(r);
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===bits),reason:''});
      assert.equal(result.accepted,true);if(!result.accepted)throw Error('Diagnostic action rejected');state=result.status;
    }
    if(state.kind!=='decision')throw Error('Expected Gambler selection');const r=state.record,b=r.observation.battle!;assertSelectionMetadata(r);
    assert.equal(b.select!.task,'GAMBLE');assert.equal(b.select!.pickCount,5);assert.equal(b.select!.canPickZero,true);assert.equal(b.select!.canPickAnyNumber,true);
    assert.equal(r.actions.length,32);
    const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===(3<<29)),reason:''});
    assert.equal(result.accepted,true);if(!result.accepted||result.status.kind!=='decision')throw Error('Expected combat continuation');
    assert.deepEqual(result.status.record.observation.battle!.hand,b.hand);
  }finally{await session.close();}
});

test('combat potion presentation distinguishes discard, untargeted use and real enemy targets',()=>{
  const program=new CardProgram(combatContentDefinition);
  for(const name of ironcladPotions){
    const machine=new CardMachine(program,plainCardStorage(program.initial({seed:'130',encounter:encounterId.CULTIST,relics:[],potion:potionId[name],durable:true,elite:false},100_000_000)));
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

test('split enemy leaves no expired effects or invalid public effect targets',async()=>{
  // Fixed diagnostic prefix from the discarded B03 run, not an evaluation policy.
  const prefix=[2,1,4,0,0,2147483648,0,1,2147483648,3,3,0,134217728,805306368,1,0,4,0,1,1,0,2147483648,65536,65540,2147483648,65536,65537,512,134217728,805306368,0,1,2147483648,2,0,2147483648,2,0,256,402653184,134217728,805306368,1,1,0,2147483648,1,0,2147483648];
  const session=await createInteractiveSession({character:'ironclad',seed:'2210101',sessionId:'split-regression',review:false,onEvent:()=>{}});
  try{
    let state=await session.observe();
    for(const bits of prefix){
      if(state.kind!=='decision')throw Error('Diagnostic prefix ended early');const r=state.record;
      const result=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===bits),reason:''});
      assert.equal(result.accepted,true);if(!result.accepted)throw Error('Diagnostic action rejected');state=result.status;
    }
    if(state.kind!=='decision')throw Error('Expected split continuation');const b=state.record.observation.battle!;
    assert.deepEqual(b.monsters.map(m=>m.name),['SPIKE_SLIME_M','SPIKE_SLIME_M']);
    assert.ok(b.effects!.some(e=>e.target==='player'&&e.name==='FRAIL'&&e.level===2));
    assert.ok(!b.effects!.some(e=>e.name==='VULNERABLE'||e.name==='WEAK'),'removed parent effects must not be visible');
    for(const e of b.effects!)assert.ok(e.target==='player'||b.monsters.some(m=>m.index>=0&&e.target==='enemy:'+m.index));
  }finally{await session.close();}
});

// This is deterministic engineering replay, not a policy or one of the 104 review runs.
for(const seed of ['130','936','2410'])test(`formal BaseGame entrance, presentation and detail events complete fixed Heart fixture ${seed}`,async()=>{
  const fixture=JSON.parse(await readFile(new URL(`./reference/fixtures/ironclad-a20-heart-${seed}.json`,import.meta.url),'utf8')) as {actions:{bits:number}[]};
  const events:StsEvent[]=[];const baseline=productionDriver(seed);
  const session=await createInteractiveSession({character:'ironclad',seed,sessionId:'acceptance-'+seed,review:true,onEvent:e=>{events.push(e);}});
  try{
    let state=await session.observe();
    for(const [decision,input]of fixture.actions.entries()){
      assert.equal(state.kind,'decision',JSON.stringify({decision,result:state.kind==='ended'?state.result:null}));if(state.kind!=='decision')throw Error('Premature terminal');
      const r=state.record,p=presentDecision(r.observation,r.actions);assertSelectionMetadata(r);
      for(const e of r.observation.battle?.effects??[])assert.ok(e.target==='player'||r.observation.battle!.monsters.some(m=>m.index>=0&&e.target==='enemy:'+m.index),'effect target must use the public roster at decision '+decision);
      const normalized=JSON.parse(JSON.stringify(r.observation));delete normalized.game.optionDetails;for(const key of ['effects','domain','cardGrowth','costs','pendingRepeats','pendingEngageDiscounts','intents'])if(normalized.battle)delete normalized.battle[key];if(normalized.battle?.select){delete normalized.battle.select.candidates;delete normalized.battle.select.skipIndex;}
      const expected=structuredClone(observe(baseline.frame()));if(expected.battle)delete expected.battle.intents;
      // Detailed operator metadata is validated against the actual action domain above;
      // the historical reference-shaped view retains its source display counters.
      if(normalized.battle?.select&&expected.battle?.select)for(const key of ['pickCount','canPickZero','canPickAnyNumber'] as const)normalized.battle.select[key]=expected.battle.select[key];
      assert.deepEqual(normalized,expected,'recording must preserve all gameplay at decision '+decision);
      assert.equal(p.actions.length,r.actions.length);
      assert.ok(p.actions.every(a=>a.label&&!a.label.includes('undefined')));
      const action=r.actions.findIndex(a=>a.bits===input.bits);assert.ok(action>=0,`fixture action ${decision}`);
      const accepted=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action,reason:'Fixed input fixture; interface verification only'});
      baseline.advance(input.bits);assert.equal(accepted.accepted,true);if(!accepted.accepted)throw Error('Fixture refused');state=accepted.status;
    }
    assert.equal(state.kind,'ended');if(state.kind==='ended')assert.equal(state.result.heartDefeated,true);
    const detail=events.filter(e=>e.kind==='detail');
    for(const type of ['damage','draw','discard','card-play','battle-start','battle-end','enemy-action','enemy-action-complete','resource-change','status-attached'])assert.ok(detail.some(e=>e.type===type),type);
    assert.deepEqual(events.filter(e=>e.kind!=='detail'),fixture.actions);
  }finally{await session.close();baseline.close();}
});

test('presentation covers every event menu and uses actual selection candidates, not hand indices',async()=>{
  const session=await createInteractiveSession({character:'ironclad',seed:'130',sessionId:'presentation',review:false,onEvent:()=>{}});
  try{
    let state=await session.observe();
    const fixture=JSON.parse(await readFile(new URL('./reference/fixtures/ironclad-a20-heart-130.json',import.meta.url),'utf8')) as {actions:{bits:number}[]};
    for(const a of fixture.actions.slice(0,2)){
      if(state.kind!=='decision')throw Error('Expected decision');const r=state.record;
      const response=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(x=>x.bits===a.bits),reason:''});
      if(!response.accepted)throw Error('Fixture rejected');state=response.status;
    }
    if(state.kind!=='decision'||!state.record.observation.battle)throw Error('Expected first battle');
    const observation=structuredClone(state.record.observation),b=observation.battle!;
    const card=b.hand[0]!;
    b.select={task:'EXHAUST_ONE',pickCount:1,canPickZero:true,canPickAnyNumber:false,candidates:[{index:7,card}],skipIndex:99};
    const choices=presentDecision(observation,[{bits:(2<<29)|7},{bits:(2<<29)|99},{bits:(3<<29)|(1<<7)}]).actions;
    assert.match(choices[0]!.label,new RegExp(describeCard(card.id,card.upgraded).name));assert.equal(choices[1]!.kind,'skip-selection');assert.deepEqual(choices[2]!.details.indices,[7]);
    observation.battle=null;observation.game.screen='EVENT_SCREEN';delete observation.game.neow;
    for(const [name,menu]of Object.entries(eventMenus)){
      observation.game.eventName=name;
      const labels=presentDecision(observation,menu.map((_,bits)=>({bits}))).actions;
      assert.equal(labels.length,menu.length);assert.ok(labels.every(a=>a.label));
    }
    observation.game.optionDetails={'0':'献出已公开的指定遗物'};
    assert.equal(presentDecision(observation,[{bits:0}]).actions[0]!.label,'献出已公开的指定遗物');
  }finally{await session.close();}
});

test('fixed no-card input tape reaches a real Volibear death through the formal session',async()=>{
  const session=await createInteractiveSession({character:'volibear',seed:'130',sessionId:'death-fixture',review:false,onEvent:()=>{}});
  try{
    let state=await session.observe();
    for(const action of [1,0]){
      if(state.kind!=='decision')throw Error('Expected starting choice');const r=state.record;
      const accepted=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action,reason:''});
      if(!accepted.accepted)throw Error('Starting fixture rejected');state=accepted.status;
    }
    for(const bits of Array<number>(40).fill(0x80000000)){
      if(state.kind==='ended')break;
      const r=state.record;presentDecision(r.observation,r.actions);
      const accepted=await session.act({op:'act',sessionId:r.sessionId,decision:r.decision,action:r.actions.findIndex(a=>a.bits===bits),reason:''});
      if(!accepted.accepted)throw Error('End-turn fixture rejected');state=accepted.status;
    }
    assert.equal(state.kind,'ended');if(state.kind==='ended'){assert.equal(state.result.outcome,'death');assert.equal(state.result.heartDefeated,false);assert.equal(state.result.hp,0);}
  }finally{await session.close();}
});
