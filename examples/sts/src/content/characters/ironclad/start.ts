import {basicCards} from "./cards/basic.ts";
import {curseBasicCards} from "../../cards/curses/ascenders-bane.ts";
import {rules} from '@bear-forge/card-engine';
import {resources} from "../../../rules/resources.ts";
import {random} from "../../../rules/random.ts";
import {permanentDecks} from "../../../rules/permanent-decks.ts";
import {relics} from "../../../rules/relics.ts";
import {startingRelics} from "./relics/burning-blood.ts";
import {encounterPlans} from "../../enemies/plans.ts";
import {neowOffers} from "../../events/neow/offers.ts";
import {SetupSchema,type Setup} from "../../../game.schemas.ts";
import {generateMap} from "../../../map.ts";
import * as pools from "../../../pools.ts";
import type {MonsterPlan} from "../../../encounters.types.ts";
import type {NeowOption} from "../../../neow.types.ts";
import type {RelicId} from "../../../identifiers.ts";
import type {IroncladStart,StartStream,RelicTier} from "./start.types.ts";
const {defineRules,defineEffect,defineEntity,sequence,call,spawnEntity,forEach}=rules;
const streamNames:readonly StartStream[]=['ai','cardRandom','card','event','mathUtil','merchant','misc','monsterHp','monster','neow','potion','relic','shuffle','treasure'];
const tiers:readonly RelicTier[]=['common','uncommon','rare','shop','boss'];
const initialPools={common:pools.commonRelicPool,uncommon:pools.uncommonRelicPool,rare:pools.rareRelicPool,shop:pools.shopRelicPool,boss:pools.bossRelicPool};
/** Normal start composes persistent owners; this program never constructs the old Adventure/World. */
export const ironcladStart=defineRules({requires:[resources,random,permanentDecks,basicCards,curseBasicCards,startingRelics,encounterPlans,neowOffers],build(){
  const actorDefinition=defineEntity(resources.exports.actor,{side:0}),deckDefinition=defineEntity(permanentDecks.exports.kind,undefined),streamDefinition=defineEntity(random.exports.stream,undefined);
  const initialize=defineEffect<Setup,IroncladStart>(b=>{const seed=b.local<bigint>(),actor=b.local<number>(),deck=b.local<number>(),stream=b.local<number>(),streams=b.local<Record<StartStream,number>>(),plan=b.local<MonsterPlan>(),neow=b.local<NeowOption[]>(),relicPools=b.local<Record<RelicTier,RelicId[]>>(),shuffled=b.local<readonly RelicId[]>();return sequence(
    b.assign(seed,b.read(v=>BigInt(SetupSchema.parse(v.input).seed))),b.assign(streams,{} as Record<StartStream,number>),
    forEach(streamNames,name=>sequence(b.assign(stream,spawnEntity({definition:streamDefinition,owner:null,scope:0,setup:b.read(v=>{const key=v.get(name);return BigInt.asUintN(64,key==='ai'||key==='monsterHp'?0n:key==='mathUtil'?v.get(seed)-897897n:v.get(seed));})})),b.assign(streams,b.read(v=>({...v.get(streams),[v.get(name)]:v.get(stream)}))))),
    b.assign(plan,call(encounterPlans.exports.generate,{stream:b.read(v=>v.get(streams).monster),act:1,ascension:20})),b.assign(relicPools,{common:[],uncommon:[],rare:[],shop:[],boss:[]}),
    forEach(tiers,tier=>sequence(b.assign(shuffled,random.exports.shuffle({stream:b.read(v=>v.get(streams).relic),items:b.read(v=>initialPools[v.get(tier)]),counted:false})),b.assign(relicPools,b.read(v=>({...v.get(relicPools),[v.get(tier)]:[...v.get(shuffled)]}))))),
    b.assign(actor,spawnEntity({definition:actorDefinition,owner:null,scope:0,setup:{hp:68,maxHp:75,gold:99,block:0,energy:0}})),b.assign(deck,spawnEntity({definition:deckDefinition,owner:actor,scope:0,setup:{actor}})),
    call(permanentDecks.exports.obtain,{deck,definition:curseBasicCards.exports.AscendersBane,upgraded:false,specialData:0,count:1,upgrade:false}),call(relics.exports.obtain,{actor,definition:startingRelics.exports.BurningBlood,scope:0}),
    call(permanentDecks.exports.obtain,{deck,definition:basicCards.exports.StrikeRed,upgraded:false,specialData:0,count:5,upgrade:false}),call(permanentDecks.exports.obtain,{deck,definition:basicCards.exports.DefendRed,upgraded:false,specialData:0,count:4,upgrade:false}),call(permanentDecks.exports.obtain,{deck,definition:basicCards.exports.Bash,upgraded:false,specialData:0,count:1,upgrade:false}),
    b.assign(neow,call(neowOffers.exports.generate,b.read(v=>v.get(streams).neow))),b.return({seed,actor,deck,streams,monsterList:b.read(v=>v.get(plan).monsterList),eliteList:b.read(v=>v.get(plan).eliteList),boss:b.read(v=>v.get(plan).boss),secondBoss:b.read(v=>v.get(plan).secondBoss),map:b.read(v=>generateMap(v.get(seed),20,1,true)),neow,relicPools}),
  );});
  return{exports:{initialize}};
}});
