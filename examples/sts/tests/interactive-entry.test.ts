import {privateCardGraph} from '@bear-forge/runtime-card/graph';
import {observe} from '../src/contract.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInteractiveSession} from '../src/interactive-session.ts';
import {presentDecision,describeCard,formatDecision,enemyIntentLabel} from '../src/presentation.ts';
import {MS,moveId} from '../src/combat-identifiers.ts';
import {actRecovery} from '../src/program/progression.ts';
import type {RelicId} from '../src/identifiers.ts';
import {cards} from '../src/cards.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';
import {relicId,potionId} from '../src/identifiers.ts';
import {relicTexts} from '../src/content/relics/descriptions.ts';
import {potionTexts} from '../src/content/potions/descriptions.ts';
import {CardProgram,CardMachine} from '@bear-forge/card-engine';
import {combatContentDefinition} from './combat-content-fixture.ts';
import {encounterId} from '../src/identifiers.ts';
import {ironcladPotions} from '../src/pools.ts';
import type {InteractiveRecord} from '../src/interactive-session.types.ts';

function presentationFixture(encounter:number=encounterId.CULTIST,relics:RelicId[]=[],potion:number|null=null){
  const program=new CardProgram(combatContentDefinition),storage=privateCardGraph(program.initial({seed:'130',encounter,relics,potion,durable:true,elite:false},100_000_000)),machine=new CardMachine(program,storage);
  try{
    let stop=machine.advance();while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);
    if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected production combat decision');
    const frame=machine.storage.export(stop.call.input);
    return{observation:structuredClone(observe(frame)),actions:structuredClone(frame.actions)};
  }finally{storage.close();}
}

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

test('public enemy intent explains non-attacks and uses original damage without revealing hidden intent',()=>{
  const {observation}=presentationFixture();
  const battle=observation.battle!;
  // This fixture publishes detail views only when enabled; a detached public
  // presentation example supplies the same already-resolved intent fields.
  battle.intents=[{index:0,name:'CULTIST_INCANTATION',attack:false,baseDamage:0,attackDamage:0,hits:0}];
  assert.match(enemyIntentLabel(battle,0),/获得仪式/);
  battle.intents=[{index:0,name:'CULTIST_DARK_STRIKE',attack:true,baseDamage:6,attackDamage:17,hits:3}];
  assert.match(enemyIntentLabel(battle,0),/17×3/);
  battle.intentHidden=true;assert.equal(enemyIntentLabel(battle,0),'隐藏');
});

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

test('map EVENT nodes are unknown rooms rather than guaranteed events, in actions and map text',()=>{
  const {observation:o}=presentationFixture();o.battle=null;o.game.screen='MAP_SCREEN';
  const node=o.game.map.nodes.find(node=>node.room==='EVENT');assert.ok(node,'fixture must contain an unknown room');
  o.game.y=node.y-1;
  const p=presentDecision(o,[{bits:node.x}]),text=formatDecision(o,p);
  assert.equal(p.actions[0]!.kind,'travel');assert.match(p.actions[0]!.label,/\? 未知房间（进入后确定类型）/);
  assert.ok(text.includes(`x${node.x} ? 未知房间（进入后确定类型）`));
  assert.doesNotMatch(p.actions[0]!.label,/保证.*事件|必定.*事件/);
});

for(const asleep of [false,true])test(`Lagavulin SLEEP intent explains ${asleep?'sleep':'wake transition'} from the ASLEEP bit`,()=>{
  const {observation:o,actions}=presentationFixture(encounterId.LAGAVULIN),b=o.battle!,monster=b.monsters[0]!;
  assert.equal(monster.moves[0],moveId.LAGAVULIN_SLEEP);
  b.intents=[{index:monster.index,name:'LAGAVULIN_SLEEP',attack:false,baseDamage:0,attackDamage:0,hits:0}];
  const mask=1n<<BigInt(MS.ASLEEP),bits=BigInt(monster.statusBits);
  monster.statusBits=String(asleep?bits|mask:bits&~mask);
  const p=presentDecision(o,actions),text=formatDecision(o,p),explanation=p.rules.mechanics[`敌人[${monster.index}]行动`];
  assert.match(explanation!,asleep?/^睡眠/:/^已唤醒，当前仍为过渡行动/);
  assert.match(explanation!,/本次不攻击/);assert.ok(text.includes(explanation!));
  assert.equal(b.intents![0]!.name,'LAGAVULIN_SLEEP','formatting must not rewrite the queued action');
});

test('Runic Dome hides both formatted intents and JSON intent mechanics',()=>{
  const {observation:o,actions}=presentationFixture(encounterId.LAGAVULIN,['RUNIC_DOME']);
  assert.equal(o.battle!.intentHidden,true);
  // Even if a caller retains an intent snapshot, the hidden flag wins.
  o.battle!.intents=[{index:0,name:'LAGAVULIN_SLEEP',attack:false,baseDamage:0,attackDamage:0,hits:0}];
  const p=presentDecision(o,actions),text=formatDecision(o,p);
  assert.match(text,/意图 隐藏/);assert.doesNotMatch(text,/过渡行动|意图 睡眠|本次不攻击/);
  assert.equal(Object.keys(p.rules.mechanics).some(key=>key.includes('行动')),false);
  assert.doesNotMatch(JSON.stringify(p.rules.mechanics),/LAGAVULIN_SLEEP|过渡行动|本次不攻击/);
});

test('action labels distinguish potion, end turn, targeted and untargeted cards and effective costs',()=>{
  const {observation:o,actions}=presentationFixture(encounterId.CULTIST,[],potionId.FIRE_POTION),b=o.battle!;
  const p=presentDecision(o,actions);
  const drink=p.actions.find(a=>a.kind==='drink-potion')!,end=p.actions.find(a=>a.kind==='end-turn')!;
  assert.ok(drink);assert.ok(end);assert.notEqual(drink.bits,end.bits);
  assert.match(drink.label,/喝下药水.*FIRE_POTION.*敌人\[0\]/);assert.equal(drink.details.target,0);
  assert.equal(end.label,'结束回合');assert.deepEqual(end.details,{});
  const template=b.hand[0]!;
  b.hand=[{...template,id:'STRIKE_RED',cost:1,costForTurn:1},{...template,id:'DEFEND_RED',cost:1,costForTurn:1},{...template,id:'WHIRLWIND',cost:-1,costForTurn:-1}];
  b.costs={'0':0,'1':1};b.player.energy=3;
  const cards=presentDecision(o,[{bits:0},{bits:1},{bits:2}]).actions;
  assert.ok(cards.every(a=>a.kind==='play-card'));
  assert.match(cards[0]!.label,/支付0能量.*敌人\[0\]/);assert.equal(cards[0]!.details.target,0);
  assert.match(cards[1]!.label,/支付1能量/);assert.doesNotMatch(cards[1]!.label,/敌人/);assert.equal(cards[1]!.details.target,null);
  assert.match(cards[2]!.label,/X费，当前3能量/);assert.equal(cards[2]!.details.target,null);
});

test('JSON rules.mechanics exposes the actual missing-health act recovery explanation',()=>{
  const {observation:o}=presentationFixture();o.battle=null;o.game.screen='MAP_SCREEN';
  const p=presentDecision(o,[]),json=JSON.parse(JSON.stringify(p));
  assert.equal(json.rules.mechanics['幕间恢复'],actRecovery.text);
  assert.match(json.rules.mechanics['幕间恢复'],/缺失生命的75%/);
  assert.match(json.rules.mechanics['幕间恢复'],/四舍五入/);
  assert.ok(formatDecision(o,p).includes(actRecovery.text));
});

test('every static card, relic and potion has presentation data',()=>{
  for(const id of [...Object.keys(cards),...Object.values(volibearCardDescriptions).map(c=>c.id)])for(const upgraded of [false,true])assert.ok(describeCard(id,upgraded).text,id);
  for(const id of Object.keys(relicId))assert.ok(relicTexts[id],id);
  for(const id of Object.keys(potionId))assert.ok(potionTexts[id],id);
  // Dynamic event option coverage lives in event-source.test.ts and executes the real menus.
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

test('presentation uses published event options and actual selection candidate indices',()=>{
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
    observation.game.eventName='MASKED_BANDITS';
    observation.game.optionDetails={};
    assert.throws(()=>presentDecision(observation,[{bits:1}]),/Missing executable event option description/);
    observation.game.optionDetails={'0':'献出已公开的指定遗物'};
    assert.equal(presentDecision(observation,[{bits:0}]).actions[0]!.label,'献出已公开的指定遗物');
  }finally{storage.close();}
});
