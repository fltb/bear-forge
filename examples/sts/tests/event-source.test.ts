import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {rules} from '../src/rules/execution.ts';
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {potions} from '../src/rules/potions.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {adventureProgram,adventureContent} from '../src/program/adventure.ts';
import {adventureStart} from '../src/program/start.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {stsPorts} from '../src/adapters/ports.ts';
import {adventurePotions} from '../src/content/potions/adventure.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import {eventId,potionId,type RelicId,type CardId} from '../src/identifiers.ts';
import {volibearAdventureProgram} from '../src/program/volibear.ts';
import {volibearContent} from '../src/program/volibear-content.ts';
import {volibearCardDescriptions} from '../src/content/characters/volibear/cards/metadata.ts';
import {observe} from '../src/contract.ts';
import {presentDecision} from '../src/presentation.ts';

const setup=programSchemas.setup.extend({juice:z.boolean().default(false),character:z.enum(['ironclad','volibear']).default('ironclad'),deck:z.array(z.object({id:z.custom<CardId>(),upgraded:z.boolean()})).nullable().default(null),event:z.number(),owned:z.array(z.custom<RelicId>()).default([]),gold:z.number().default(1000),hp:z.number().default(490),maxHp:z.number().default(500)});
type Case=z.infer<typeof setup>;
const {defineEffect,sequence,call,query,forEach,when}=rules;
const fixture=rules.defineRules({requires:[adventureProgram,volibearAdventureProgram],build(){
  const entry=defineEffect<Case,Frame>(b=>{
    const run=b.local<number>();
    const state=(v:rules.ReadView<Case>)=>v.query(adventures.exports.bindings,v.get(run));
    return sequence(
      when(b.read(v=>v.input.character==='volibear'),sequence(
        b.assign(run,call(volibearContent.start.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:rules.defineEntity(adventures.exports.kind,{starterRelic:volibearContent.hearts.exports.HuntersHeart,cardPools:volibearContent.cards.exports.cardPools,cards:[...adventureContent.cards.exports.definitions,...volibearContent.cards.exports.definitions],relics:[...adventureContent.acquisition.exports.definitions,{id:'VOLIBEAR_HUNTERS_HEART',definition:volibearContent.hearts.exports.HuntersHeart},{id:'VOLIBEAR_IMMORTAL_HEART',definition:volibearContent.hearts.exports.ImmortalHeart}]})})),
        call(volibearContent.history.exports.initialize,run),
      ),b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})}))),
      call(adventures.exports.enableDetails,run),
      call(resources.exports.setHealth,{entity:b.read(v=>state(v).actor),hp:b.read(v=>v.input.hp),maxHp:b.read(v=>v.input.maxHp)}),
      when(b.read(v=>v.input.gold>=v.query(resources.exports.wealth,state(v).actor).gold),
        call(resources.exports.gainGold,{entity:b.read(v=>state(v).actor),amount:b.read(v=>v.input.gold-v.query(resources.exports.wealth,state(v).actor).gold)}),
        call(resources.exports.spendGold,{entity:b.read(v=>state(v).actor),amount:b.read(v=>v.query(resources.exports.wealth,state(v).actor).gold-v.input.gold)})),
      when(b.read(v=>v.input.deck!==null),sequence(
        forEach(b.read(v=>v.query(permanentDecks.exports.current,state(v).deck).cards),card=>call(permanentDecks.exports.remove,{deck:b.read(v=>state(v).deck),card})),
        forEach(b.read(v=>v.input.deck!),card=>call(permanentDecks.exports.obtain,{deck:b.read(v=>state(v).deck),definition:query(adventures.exports.card,{run,id:b.read(v=>v.get(card).id)}),count:1,upgraded:b.read(v=>v.get(card).upgraded),specialData:0,upgrade:false})),
      ),forEach(['BARRICADE','REGRET'] as const,id=>call(permanentDecks.exports.obtain,{deck:b.read(v=>state(v).deck),definition:query(adventures.exports.card,{run,id}),count:1,upgraded:false,specialData:0,upgrade:false}))),
      call(stsPorts.exports.initialize,run),call(adventurePotions.exports.initialize,run),
      when(b.read(v=>v.input.juice),call(potions.exports.obtain,{inventory:b.read(v=>state(v).potions),potion:potionId.FRUIT_JUICE})),
      forEach(b.read(v=>['CIRCLET',...v.input.owned] as RelicId[]),id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
      call(adventures.exports.setRoom,{run,room:'EVENT',event:b.read(v=>v.input.event)}),
      call(adventureContent.events.exports.open,run),
      b.return(query(stsPorts.exports.frame,{run,actions:[],selection:null})),
    );
  });
  return{exports:{entry}};
}});
const definition=linkRules<{},Case,Ports,Frame>({id:'sts/event-source-regression',schemas:{...programSchemas,setup},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
const program=new CardProgram(definition);
function driver(event:number,patch:Partial<Case>={}){
  const storage=privateCardGraph(program.initial({seed:'130',juice:false,character:'ironclad',deck:null,event,owned:[],gold:1000,hp:490,maxHp:500,...patch},100_000_000));
  const machine=new CardMachine(program,storage);let stop=machine.advance();
  const frame=():Frame=>{while(stop.kind==='call'&&stop.call.port==='event')stop=machine.advance(null);if(stop.kind==='done')return stop.result;if(stop.kind!=='call'||stop.call.port!=='decision')throw Error('Expected event decision: '+JSON.stringify(stop));return stop.call.input;};
  const advanceBits=(bits:number)=>{const selected=frame().actions.find(action=>action.bits===bits);assert.ok(selected,`legal action bits ${bits}`);stop=machine.advance(selected);return frame();};
  return{frame,advanceBits,advance(id:number){const selected=frame().actions.find(action=>!(action.bits&0x80000000)&&(action.bits&255)===id);assert.ok(selected,`legal option ${id}`);return advanceBits(selected.bits);},close(){storage.close();}};
}
function assertMenu(frame:Frame){
  const observation=observe(frame);
  assert.equal(observation.game.screen,'EVENT_SCREEN');
  const details=observation.game.optionDetails;assert.ok(details);
  const eventActions=frame.actions.filter(action=>!(action.bits&0x80000000));
  const ids=eventActions.map(action=>String(action.bits&255));
  assert.deepEqual(Object.keys(details).sort(),ids.toSorted());
  for(const label of Object.values(details))assert.ok(label.trim());
  assert.deepEqual(presentDecision(observation,eventActions).actions.map(action=>action.label),ids.map(id=>details[id]));
  return details;
}

test('event potion continuation preserves sampled Cleric and Shining Light amounts',()=>{
  for(const [event,amount,pattern] of [[eventId.THE_CLERIC,18,/回复18生命/],[eventId.SHINING_LIGHT,23,/受到23伤害/]] as const){
    const d=driver(event,{juice:true,hp:40,maxHp:75,gold:147});
    try{
      const before=d.frame(),details=assertMenu(before);
      assert.match(details['0']!,pattern);
      const actions=before.actions.filter(action=>!(action.bits&0x80000000)).map(action=>action.bits);
      const afterJuice=d.advanceBits(0x80000000);
      assert.equal(afterJuice.game.maxHp,80);assert.equal(afterJuice.game.hp,45);
      assert.equal(afterJuice.game.screen,'EVENT_SCREEN');
      assert.deepEqual(afterJuice.actions.map(action=>action.bits),actions);
      assert.deepEqual(assertMenu(afterJuice),details);
      const after=d.advance(0);
      assert.equal(after.game.screen,'MAP_SCREEN');
      assert.equal(after.game.hp,event===eventId.THE_CLERIC?45+amount:45-amount);
      assert.equal(after.game.gold,event===eventId.THE_CLERIC?147-35:147);
    }finally{d.close();}
  }
});

test('event potion continuation refreshes live Ghosts max-HP cost without consuming event choice',()=>{
  const d=driver(eventId.GHOSTS,{juice:true,hp:40,maxHp:75});
  try{
    const before=d.frame();assert.match(assertMenu(before)['0']!,/失去38最大生命/);
    const ids=before.actions.filter(action=>!(action.bits&0x80000000)).map(action=>action.bits);
    const afterJuice=d.advanceBits(0x80000000);
    assert.deepEqual(afterJuice.actions.map(action=>action.bits),ids);
    assert.match(assertMenu(afterJuice)['0']!,/失去40最大生命/);
    assert.equal(afterJuice.game.maxHp,80);
    const after=d.advance(0);assert.equal(after.game.screen,'MAP_SCREEN');assert.equal(after.game.maxHp,40);
  }finally{d.close();}
});

test('Designer fallthrough spending clamps each deduction to the remaining gold',()=>{
  let exercised=false;
  for(let seed=0;seed<32&&!exercised;seed++){
    const d=driver(eventId.DESIGNER_IN_SPIRE,{seed:String(seed),gold:75,hp:40,maxHp:75});
    try{
      const frame=d.frame(),details=assertMenu(frame);
      if(!Object.hasOwn(details,'3'))continue;
      assert.match(details['3']!,/75和110金币.*每次至多扣除当前余额/);
      const after=d.advance(3);
      assert.equal(after.game.gold,0);assert.equal(after.game.hp,35);assert.equal(after.game.screen,'MAP_SCREEN');
      exercised=true;
    }finally{d.close();}
  }
  assert.ok(exercised,'deterministic fixtures must exercise the transform fallthrough');
});

test('Golden Idol discloses compulsory costs before acquisition and keeps their sampled amounts after juice',()=>{
  const d=driver(eventId.GOLDEN_IDOL,{juice:true,hp:40,maxHp:75});
  try{
    const details=assertMenu(d.frame());
    assert.match(details['0']!,/必须选择.*INJURY.*受到26伤害.*失去7最大生命/);
    assert.deepEqual(assertMenu(d.advanceBits(0x80000000)),details);
    const costs=assertMenu(d.advance(0));
    assert.match(costs['2']!,/INJURY/);assert.match(costs['3']!,/26伤害/);assert.match(costs['4']!,/7最大生命/);
    const after=d.advance(4);assert.equal(after.game.maxHp,73);assert.equal(after.game.screen,'MAP_SCREEN');
  }finally{d.close();}
});

test('Wing Statue gates actual Volibear production decks using composed damage and upgrade state',()=>{
  const cases=[
    {key:'U05',upgraded:false,eligible:false}, // Dynamic enemy-count attack: metadata sentinel 0.
    {key:'U05',upgraded:true,eligible:false},
    {key:'U07',upgraded:false,eligible:true}, // Fixed 28 damage.
    {key:'U08',upgraded:false,eligible:true}, // S2 fixed base 10 before the bite-mark bonus.
    {key:'U08',upgraded:true,eligible:true}, // Upgraded fixed base 14.
    {key:'B02',upgraded:true,eligible:false}, // Non-attack: metadata sentinel -1.
  ] as const;
  for(const {key,upgraded,eligible} of cases){
    const d=driver(eventId.WING_STATUE,{character:'volibear',deck:[{id:volibearCardDescriptions[key].id as CardId,upgraded}],gold:147});
    try{
      const frame=d.frame(),details=assertMenu(frame);
      assert.deepEqual(frame.actions.map(action=>action.bits&255),eligible?[0,1,2]:[0,2],`${key} upgraded=${upgraded}`);
      assert.equal(Object.hasOwn(details,'1'),eligible);
      if(eligible){
        assert.match(details['1']!,/50–80金币/);
        const after=d.advance(1);
        assert.equal(after.game.screen,'MAP_SCREEN');
        assert.ok(after.game.gold-frame.game.gold>=50&&after.game.gold-frame.game.gold<=80);
        assert.equal(after.game.hp,frame.game.hp);
      }else{
        const after=d.advance(2);
        assert.equal(after.game.screen,'MAP_SCREEN');
        assert.equal(after.game.gold,frame.game.gold);
      }
    }finally{d.close();}
  }
  const empty=driver(eventId.WING_STATUE,{character:'volibear',deck:[]});
  try{assert.deepEqual(Object.keys(assertMenu(empty.frame())),['0','2']);}finally{empty.close();}
});

test('every implemented event publishes every legal initial option from its executable menu',()=>{
  const directScreens=new Map<number,string>([[eventId.BONFIRE_SPIRITS,'CARD_SELECT'],[eventId.LAB,'REWARDS']]);
  for(const [name,event] of Object.entries(eventId)){
    if(event<=eventId.NEOW||event===eventId.MATCH_AND_KEEP)continue;
    const d=driver(event);
    try{
      const frame=d.frame();
      if(directScreens.has(event))assert.equal(frame.game.screen,directScreens.get(event),name);
      else assertMenu(frame);
    }finally{d.close();}
  }
});

test('tome continuation costs and legal phase domains match their actual HP deltas',()=>{
  const d=driver(eventId.CURSED_TOME);
  try{
    assertMenu(d.frame());let frame=d.advance(0);assert.deepEqual(frame.actions.map(a=>a.bits&255),[2]);
    for(const [id,cost] of [[2,1],[3,2],[4,3]] as const){const before=frame.game.hp;assert.match(assertMenu(frame)[String(id)]!,new RegExp(`失去${cost}生命`));frame=d.advance(id);assert.equal(frame.game.hp,before-cost);}
    const details=assertMenu(frame);assert.match(details['5']!,/失去15生命/);assert.match(details['6']!,/失去3生命/);
    const before=frame.game.hp;assert.equal(d.advance(6).game.hp,before-3);
  }finally{d.close();}
});

test('skull option escalation, repeated rewards and leaving share executable costs',()=>{
  const d=driver(eventId.KNOWING_SKULL);
  try{
    let frame=d.frame();assert.match(assertMenu(frame)['0']!,/失去6生命.*90金币/);
    const before={hp:frame.game.hp,gold:frame.game.gold};frame=d.advance(0);
    assert.equal(frame.game.hp,before.hp-6);assert.equal(frame.game.gold,before.gold+90);
    assert.match(assertMenu(frame)['0']!,/失去7生命/);assert.match(assertMenu(frame)['1']!,/失去6生命/);
    frame=d.advance(0);assert.equal(frame.game.hp,before.hp-13);assert.equal(frame.game.gold,before.gold+180);
    assert.match(assertMenu(frame)['0']!,/失去8生命/);assert.equal(d.advance(3).game.hp,before.hp-19);
  }finally{d.close();}
});

test('idol publishes the second-stage costs before their actual execution',()=>{
  const d=driver(eventId.GOLDEN_IDOL);
  try{
    assert.deepEqual(d.frame().actions.map(a=>a.bits&255),[0,1]);
    const frame=d.advance(0);assert.deepEqual(frame.actions.map(a=>a.bits&255),[2,3,4]);
    assert.match(assertMenu(frame)['3']!,/受到175伤害/);assert.match(assertMenu(frame)['4']!,/失去50最大生命/);
    const after=d.advance(4);assert.equal(after.game.maxHp,450);
  }finally{d.close();}
});

test('bandit indexes, library candidate count and ooze probability describe actual implementation',()=>{
  for(const [event,id,pattern] of [[eventId.MASKED_BANDITS,0,/交出全部金币/],[eventId.MASKED_BANDITS,1,/战斗.*25–35金币.*RED_MASK/],[eventId.THE_LIBRARY,0,/20张.*1张/],[eventId.SCRAP_OOZE,0,/受到5伤害；26%.*10个百分点/]] as const){
    const d=driver(event);try{assert.match(assertMenu(d.frame())[String(id)]!,pattern);}finally{d.close();}
  }
  const paying=driver(eventId.MASKED_BANDITS,{gold:147});
  try{assert.match(assertMenu(paying.frame())['0']!,/交出全部金币离开/);const after=paying.advance(0);assert.equal(after.game.gold,0);assert.equal(after.game.screen,'MAP_SCREEN');assert.equal(after.battle,null);}finally{paying.close();}
  const fighting=driver(eventId.MASKED_BANDITS,{gold:147});
  try{assert.match(assertMenu(fighting.frame())['1']!,/战斗/);const after=fighting.advance(1);assert.equal(after.game.gold,147);assert.ok(after.battle);assert.equal(after.battle.monsters.length,3);}finally{fighting.close();}
});

test('sampled goop costs and priest healing match execution rather than static descriptions',()=>{
  const goop=driver(eventId.WORLD_OF_GOOP);
  try{const frame=goop.frame(),text=assertMenu(frame)['1']!,amount=Number(/失去(\d+)金币/.exec(text)![1]);assert.equal(goop.advance(1).game.gold,frame.game.gold-amount);}finally{goop.close();}
  const cleric=driver(eventId.THE_CLERIC,{hp:100});
  try{const frame=cleric.frame();assert.match(assertMenu(frame)['0']!,/支付35金币.*回复125生命/);const after=cleric.advance(0);assert.equal(after.game.hp,225);assert.equal(after.game.gold,965);}finally{cleric.close();}
});
