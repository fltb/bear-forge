import {curseBasicCards} from "../cards/curses/ascenders-bane.ts";
import {rules} from '../../rules/execution.ts';
import {resources} from "../../rules/resources.ts";
import {random} from "../../rules/random.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {relics} from "../../rules/relics.ts";
import {encounterPlans} from "../enemies/plans.ts";
import {neowOffers} from "../events/neow/offers.ts";
import {SetupSchema,type Setup} from "../../game.schemas.ts";
import {generateMap} from "../../map.ts";
import * as pools from "../../pools.ts";
import type {MonsterPlan} from "../../encounters.types.ts";
import type {NeowOption} from "../../neow.types.ts";
import type {AdventureSeed,StartStream,RelicTier} from '../../rules/adventures.types.ts';
import type {PermanentCardDefinition} from '../../rules/permanent-decks.types.ts';
import type {RelicDefinition} from '../../rules/relics.ts';
type RelicId=string;
const {defineRules,defineEffect,defineEntity,sequence,call,spawnEntity,forEach}=rules;
const streamNames:readonly StartStream[]=['ai','cardRandom','card','event','mathUtil','merchant','misc','monsterHp','monster','neow','potion','relic','shuffle','treasure'];
const tiers:readonly RelicTier[]=['common','uncommon','rare','shop','boss'];
export const standardRelicPools={common:pools.commonRelicPool,uncommon:pools.uncommonRelicPool,rare:pools.rareRelicPool,shop:pools.shopRelicPool,boss:pools.bossRelicPool};
/** Normal start composes persistent owners; this program never constructs the old Adventure/World. */
export type CharacterStartSpec={
  maxHp:number;ascensionMaxHpLoss:number;relic:RelicDefinition;
  deck:readonly {definition:PermanentCardDefinition;count:number}[];
  relicPools:Readonly<Record<RelicTier,readonly string[]>>;
  initializeActor:(builder:rules.Builder<number,void>)=>ReturnType<typeof rules.sequence>;
};
export function createCharacterStart(spec:CharacterStartSpec,requires:readonly rules.RuleModule<unknown>[]){return defineRules({requires:[resources,random,permanentDecks,relics,curseBasicCards,encounterPlans,neowOffers,...requires],build(){
  const initializeActor=defineEffect(spec.initializeActor);
  const actorDefinition=defineEntity(resources.exports.actor,{side:0}),deckDefinition=defineEntity(permanentDecks.exports.kind,undefined),streamDefinition=defineEntity(random.exports.stream,undefined);
  const initialize=defineEffect<Setup,AdventureSeed>(b=>{const seed=b.local<bigint>(),actor=b.local<number>(),deck=b.local<number>(),stream=b.local<number>(),streams=b.local<Record<StartStream,number>>(),plan=b.local<MonsterPlan>(),neow=b.local<NeowOption[]>(),relicPools=b.local<Record<RelicTier,RelicId[]>>(),shuffled=b.local<readonly RelicId[]>();return sequence(
    b.assign(seed,b.read(v=>BigInt(SetupSchema.parse(v.input).seed))),b.assign(streams,{} as Record<StartStream,number>),
    forEach(streamNames,name=>sequence(b.assign(stream,spawnEntity({definition:streamDefinition,owner:null,scope:0,setup:b.read(v=>{const key=v.get(name);return BigInt.asUintN(64,key==='ai'||key==='monsterHp'?0n:key==='mathUtil'?v.get(seed)-897897n:v.get(seed));})})),b.assign(streams,b.read(v=>({...v.get(streams),[v.get(name)]:v.get(stream)}))))),
    b.assign(plan,call(encounterPlans.exports.generate,{stream:b.read(v=>v.get(streams).monster),act:1,ascension:20})),b.assign(relicPools,{common:[],uncommon:[],rare:[],shop:[],boss:[]}),
    forEach(tiers,tier=>sequence(b.assign(shuffled,random.exports.shuffle({stream:b.read(v=>v.get(streams).relic),items:b.read(v=>spec.relicPools[v.get(tier)]),counted:false})),b.assign(relicPools,b.read(v=>({...v.get(relicPools),[v.get(tier)]:[...v.get(shuffled)]}))))),
    b.assign(actor,spawnEntity({definition:actorDefinition,owner:null,scope:0,setup:{hp:Math.ceil((spec.maxHp-spec.ascensionMaxHpLoss)*.9),maxHp:spec.maxHp-spec.ascensionMaxHpLoss,gold:99,block:0,energy:0}})),b.assign(deck,spawnEntity({definition:deckDefinition,owner:actor,scope:0,setup:{actor}})),
    call(permanentDecks.exports.obtain,{deck,definition:curseBasicCards.exports.AscendersBane,upgraded:false,specialData:0,count:1,upgrade:false}),call(relics.exports.obtain,{actor,definition:spec.relic,scope:0}),
    forEach(spec.deck,entry=>call(permanentDecks.exports.obtain,{deck,definition:b.read(v=>v.get(entry).definition),upgraded:false,specialData:0,count:b.read(v=>v.get(entry).count),upgrade:false})),
    call(initializeActor,actor),
    b.assign(neow,call(neowOffers.exports.generate,b.read(v=>v.get(streams).neow))),b.return({seed,actor,deck,streams,monsterList:b.read(v=>v.get(plan).monsterList),eliteList:b.read(v=>v.get(plan).eliteList),boss:b.read(v=>v.get(plan).boss),secondBoss:b.read(v=>v.get(plan).secondBoss),map:b.read(v=>generateMap(v.get(seed),20,1,true)),neow,relicPools}),
  );});
  return{exports:{initialize}};
}});}
