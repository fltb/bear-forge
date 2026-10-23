import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {CardProgram,CardMachine,linkRules} from '@bear-forge/card-engine';
import {privateCardGraph} from '../../../packages/runtime-card/src/graph.ts';
import {rules} from '../src/rules/execution.ts';
import {adventures,emptyAdventureRewards} from '../src/rules/adventures.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {adventureStart} from '../src/program/start.ts';
import {adventureContent} from '../src/program/adventure.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {adventureDraws} from '../src/content/rewards/draws.ts';
import {rewardInRoom} from '../src/content/rewards/loot.ts';
import {roomSequence} from '../src/content/rooms/definitions.ts';
import {describeProgram,programText} from '../src/content/cards/shared/program-facts.ts';
import {programSchemas,type Setup,type Ports} from '../src/game.schemas.ts';
import type {AdventureRewards,CardPreview} from '../src/rules/adventures.types.ts';
import type {RelicId} from '../src/identifiers.ts';
import type {Room} from '../src/map.types.ts';

const {defineEffect,sequence,call,query,forEach}=rules;
const result=z.object({gold:z.array(z.number()),cardCounts:z.array(z.number()),potionCount:z.number(),chance:z.number(),ranks:z.array(z.number()),names:z.array(z.string())});
type Scenario={kind:'potion';entries:number}|{kind:'battle';room:Room}|{kind:'neow';rare:boolean;colorless:boolean}|{kind:'wrapped';room:Room};
function fixture(owned:RelicId[],scenario:Scenario){
  const module=rules.defineRules({requires:[adventureContent.cards,adventureContent.acquisition,adventureContent.rooms,adventureStart,adventureDraws],build(){
    const cardName=rules.defineQuery({input:z.custom<CardPreview['definition']>(),output:z.string(),kinds:[cardInstances.exports.kind],base:(r,definition)=>r.definitionConfiguration(definition,cardInstances.exports.kind).id});
    const child=defineEffect<{run:number;room:Room;rewards:AdventureRewards},AdventureRewards>(b=>b.return(b.read(v=>({...v.input.rewards,gold:[...v.input.rewards.gold,7]}))));
    const wrapped=rewardInRoom('PRAYER_WHEEL','MONSTER',child);
    const entry=defineEffect<Setup,z.infer<typeof result>>(b=>{
      const run=b.local<number>(),rewards=b.local<AdventureRewards>(),cards=b.local<CardPreview[]>();
      return sequence(
        b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
        forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
        b.assign(rewards,emptyAdventureRewards()),b.assign(cards,[]),
        ...(scenario.kind==='potion'?[
          b.assign(rewards,call(adventureContent.rooms.exports.loot.exports.potion,{run,rewards:{...emptyAdventureRewards(),gold:Array.from({length:scenario.entries},()=>1)}})),
        ]:scenario.kind==='battle'?[
          b.assign(rewards,call(adventureContent.rooms.exports.loot.exports.battle,{run,room:scenario.room})),
        ]:scenario.kind==='neow'?[
          b.assign(cards,call(adventureDraws.exports.neowProgram.effect,{run,rare:scenario.rare,colorless:scenario.colorless})),
        ]:[b.assign(rewards,call(wrapped,{run,room:scenario.room,rewards}))]),
        b.return({
          gold:b.read(v=>v.get(rewards).gold),cardCounts:b.read(v=>v.get(rewards).cards.map(group=>group.length)),potionCount:b.read(v=>v.get(rewards).potions.length),
          chance:b.read(v=>v.query(adventures.exports.economy,v.get(run)).potionChance),
          ranks:b.read(v=>v.get(cards).map(card=>v.query(cardInstances.exports.definitionMetadata,card.definition).rarity)),
          names:b.read(v=>v.get(cards).map(card=>v.query(cardName,card.definition))),
        }),
      );
    });
    return {exports:{entry}};
  }});
  return linkRules<{},Setup,Ports,z.infer<typeof result>>({id:'sts/room-reward-source',schemas:{...programSchemas,result},initialize:()=>({}),entry:module.exports.entry,definitions:[module.exports.entry],modules:[module]});
}
function run(owned:RelicId[],scenario:Scenario){
  const program=new CardProgram(fixture(owned,scenario));
  const storage=privateCardGraph(program.initial({seed:'130'},100_000_000));
  try{
    const stop=new CardMachine(program,storage).advance();
    assert.equal(stop.kind,'done');
    if(stop.kind!=='done')throw Error('Reward fixture unexpectedly paused');
    return stop.result;
  }finally{storage.close();}
}

test('ordinary room composition never invents complete text for an opaque callback',()=>{
  const known=describeProgram(defineEffect<number,void>(b=>b.return(undefined)),'已描述子效果');
  const opaque=defineEffect<number,void>(b=>b.return(undefined));
  assert.equal(programText(roomSequence(known,known)),'已描述子效果，已描述子效果');
  assert.equal(programText(roomSequence(known,opaque)),undefined);
  assert.equal(programText(roomSequence(opaque,known)),undefined);
  const child=defineEffect<{run:number;room:Room;rewards:AdventureRewards},AdventureRewards>(b=>b.return(b.read(v=>v.input.rewards)));
  assert.equal(programText(rewardInRoom('PRAYER_WHEEL','MONSTER',child)),undefined);
});

test('reward condition uses the actual owned relic and room while allowing an opaque child',()=>{
  assert.deepEqual(run([],{kind:'wrapped',room:'MONSTER'}).gold,[]);
  assert.deepEqual(run(['PRAYER_WHEEL'],{kind:'wrapped',room:'ELITE'}).gold,[]);
  assert.deepEqual(run(['PRAYER_WHEEL'],{kind:'wrapped',room:'MONSTER'}).gold,[7]);
});

test('White Beast Statue preserves the four-entry cap and both chance-counter branches',()=>{
  const under=run(['WHITE_BEAST_STATUE'],{kind:'potion',entries:3});
  const full=run(['WHITE_BEAST_STATUE'],{kind:'potion',entries:4});
  assert.equal(under.potionCount,1);
  assert.equal(full.potionCount,0);
  assert.equal(full.chance-under.chance,20);
  assert.deepEqual(under.gold,[1,1,1]);
  assert.deepEqual(full.gold,[1,1,1,1]);
});

test('Prayer Wheel adds one ordinary card group and Golden Idol changes only base gold',()=>{
  const ordinary=run([],{kind:'battle',room:'MONSTER'});
  const altered=run(['PRAYER_WHEEL','GOLDEN_IDOL'],{kind:'battle',room:'MONSTER'});
  assert.deepEqual(ordinary.cardCounts,[3]);
  assert.deepEqual(altered.cardCounts,[3,3]);
  assert.deepEqual(altered.gold,ordinary.gold.map(gold=>gold+Math.round(gold/4)));
  assert.deepEqual(run(['PRAYER_WHEEL'],{kind:'battle',room:'BOSS'}).cardCounts,[3]);
});

test('Neow draw constructor keeps distinct offers and fixed-rarity flag precedence',()=>{
  assert.equal(adventureDraws.exports.neowProgram.effect,adventureDraws.exports.neow);
  for(const [rare,colorless,rank] of [[true,false,2],[true,true,2],[false,true,1]] as const){
    const value=run([],{kind:'neow',rare,colorless});
    assert.equal(value.names.length,3);
    assert.equal(new Set(value.names).size,3);
    assert.deepEqual(value.ranks,[rank,rank,rank]);
  }
  const mixed=run([],{kind:'neow',rare:false,colorless:false});
  assert.equal(mixed.names.length,3);
  assert.equal(new Set(mixed.names).size,3);
  assert.ok(mixed.ranks.every(rank=>rank===0||rank===1));
  assert.match(adventureDraws.exports.neowProgram.text(false,false),/3张不重复.*33%.*角色牌/);
  assert.match(adventureDraws.exports.neowProgram.text(false,true),/3张不重复的罕见无色牌/);
  assert.match(adventureDraws.exports.neowProgram.text(true,true),/3张不重复的稀有无色牌/);
});
