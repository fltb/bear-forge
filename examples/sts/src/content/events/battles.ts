import {rules} from '../../rules/execution.ts';
import {adventures,emptyAdventureRewards} from "../../rules/adventures.ts";
import {resources} from "../../rules/resources.ts";
import {random} from "../../rules/random.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {cardInstances} from "../../rules/card-instances.ts";
import {relics,type RelicDefinition} from "../../rules/relics.ts";
import {adventureDraws} from "../rewards/draws.ts";
import {combatProgram} from "../../program/combat.ts";
import {eventId as e,encounterId as encounters,type RelicId} from "../../identifiers.ts";
import {eventStep as step,eventOption as option,eventMenu,eventBranches} from './options.ts';
import type {AdventureRewards,CardPreview,RelicTier} from "../../rules/adventures.types.ts";
import type {AdventureChoiceExports} from "../../rules/adventure-choices.ts";
import type {createAdventureAcquisition} from "../relics/acquisition.ts";
import type {createAdventureLoot} from "../rewards/loot.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query}=rules;
export function createBattleAdventureEvents(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>,loot:ReturnType<typeof createAdventureLoot>){return defineRules({requires:[ui,acquisition,loot,adventureDraws,combatProgram],build(){
  const programs:Partial<Record<number,rules.Effect<number,void>>>={};
  const run=(v:rules.ReadView<number>)=>v.query(adventures.exports.bindings,v.input);
  const leave=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:b.read(v=>v.query(adventures.exports.position,v.input).hasContinuation)}));
  const fight=defineEffect<{run:number;encounter:number},boolean>(b=>{const result=b.local<0|1|2>();return sequence(b.assign(result,call(combatProgram.exports.run,b.input)),when(b.read(v=>v.get(result)===2),sequence(call(adventures.exports.setOutcome,{run:b.read(v=>v.input.run),outcome:0}),b.return(false))),b.return(true));});
  const rewards=defineEffect<{run:number;gold:number;relics:RelicDefinition[];potion:boolean;cardsFirst:boolean},void>(b=>{const reward=b.local<AdventureRewards>(),cards=b.local<CardPreview[]>();return sequence(b.assign(reward,{...emptyAdventureRewards(),gold:b.read(v=>[v.input.gold]),relics:b.read(v=>v.input.relics)}),when(b.read(v=>v.input.cardsFirst),sequence(b.assign(cards,call(adventureDraws.exports.reward,{run:b.read(v=>v.input.run),room:'EVENT'})),b.assign(reward,b.read(v=>({...v.get(reward),cards:[v.get(cards)]}))))),when(b.read(v=>v.input.potion),b.assign(reward,call(loot.exports.potion,{run:b.read(v=>v.input.run),rewards:reward}))),when(b.read(v=>!v.input.cardsFirst),sequence(b.assign(cards,call(adventureDraws.exports.reward,{run:b.read(v=>v.input.run),room:'EVENT'})),b.assign(reward,b.read(v=>({...v.get(reward),cards:[v.get(cards)]}))))),call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:reward}),call(acquisition.exports.rewards,b.read(v=>v.input.run)),call(adventures.exports.setScene,{run:b.read(v=>v.input.run),screen:'MAP_SCREEN',continuation:false}));});
  const offerFight=(spec:{encounter:number;gold:[number,number];relic:RelicId|null;potion:boolean;randomRare?:boolean;leaveGold?:boolean;payAllGold?:boolean})=>{
    const combat=step(defineEffect<number,void>(b=>{const gold=b.local<number>(),relic=b.local<RelicDefinition>(),won=b.local<boolean>();return sequence(b.assign(gold,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:spec.gold[0],end:spec.gold[1]})),spec.randomRare?b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:'rare',shop:false,front:true,screenless:true})):b.assign(relic,query(adventures.exports.relic,{run:b.input,id:spec.relic!})),b.assign(won,call(fight,{run:b.input,encounter:spec.encounter})),when(won,call(rewards,{run:b.input,gold,relics:b.read(v=>[v.get(relic)]),potion:spec.potion,cardsFirst:false})));}),`战斗；获胜获得${spec.gold[0]}–${spec.gold[1]}金币、${spec.randomRare?'随机稀有遗物':spec.relic}及卡牌奖励${spec.potion?'，可能获得药水':''}`);
    const leaveGold=(v:rules.ReadView<number>)=>run(v).ascension>=15?50:99;
    const exit=step(defineEffect<number,void>(b=>sequence(spec.payAllGold?call(resources.exports.spendGold,{entity:b.read(v=>run(v).actor),amount:b.read(v=>v.query(resources.exports.wealth,run(v).actor).gold)}):spec.leaveGold?call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:b.read(leaveGold)}):sequence(),call(leave,b.input))),v=>spec.payAllGold?'交出全部金币离开':spec.leaveGold?`获得${leaveGold(v)}金币离开`:'离开');
    return eventMenu(ui,[option(0,spec.payAllGold?exit:combat),option(1,spec.payAllGold?combat:exit)]);
  };
  programs[e.MASKED_BANDITS]=offerFight({encounter:encounters.MASKED_BANDITS_EVENT,gold:[25,35],relic:'RED_MASK',potion:false,payAllGold:true});
  programs[e.HYPNOTIZING_COLORED_MUSHROOMS]=offerFight({encounter:encounters.MUSHROOMS_EVENT,gold:[20,30],relic:'ODD_MUSHROOM',potion:true,leaveGold:true});
  programs[e.MYSTERIOUS_SPHERE]=offerFight({encounter:encounters.MYSTERIOUS_SPHERE_EVENT,gold:[45,55],relic:null,potion:true,randomRare:true,leaveGold:true});
  programs[e.MINDBLOOM]=defineEffect<number,void>(b=>{
    const richGold=999,curseCount=2,battleGold=(v:rules.ReadView<number>)=>run(v).ascension>=15?25:50;
    const mark='MARK_OF_THE_BLOOM' as const,richCurse='NORMALITY' as const,healCurse='DOUBT' as const;
    const bosses=b.local<readonly number[]>(),relic=b.local<RelicDefinition>(),won=b.local<boolean>();
    const healAndCurse=sequence(call(resources.exports.heal,{entity:b.read(v=>run(v).actor),amount:b.read(v=>v.query(resources.exports.vitality,run(v).actor).maxHp)}),call(permanentDecks.exports.obtain,{deck:b.read(v=>run(v).deck),definition:query(adventures.exports.card,{run:b.input,id:healCurse}),count:1,upgraded:false,specialData:0,upgrade:false}));
    return eventBranches(b,ui,[
      {id:0,text:v=>`挑战第一幕Boss，获胜获得${battleGold(v)}金币、随机稀有遗物、卡牌奖励及可能的药水`,execute:sequence(b.assign(bosses,random.exports.shuffle({stream:b.read(v=>run(v).streams.misc),items:[encounters.THE_GUARDIAN,encounters.HEXAGHOST,encounters.SLIME_BOSS]})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:'rare',shop:false,front:true,screenless:false})),b.assign(won,call(fight,{run:b.input,encounter:b.read(v=>v.get(bosses)[0]!)})),when(won,call(rewards,{run:b.input,gold:b.read(battleGold),relics:b.read(v=>[v.get(relic)]),potion:true,cardsFirst:false})))},
      {id:1,text:`升级全部可升级牌，获得${mark}（不能回复生命）；尝试回复全部生命并获得${healCurse}（当前执行）`,execute:sequence(forEach(b.read(v=>v.query(permanentDecks.exports.current,run(v).deck).cards.filter(card=>v.query(cardInstances.exports.canUpgrade,card))),card=>call(permanentDecks.exports.upgrade,{deck:b.read(v=>run(v).deck),card})),call(acquisition.exports.give,{run:b.input,definition:query(adventures.exports.relic,{run:b.input,id:mark})}),healAndCurse,call(leave,b.input))},
      {id:2,allowed:v=>v.query(adventures.exports.position,v.input).floor<=40,text:`获得${richGold}金币和${curseCount}张${richCurse}`,execute:sequence(call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:richGold}),call(permanentDecks.exports.obtain,{deck:b.read(v=>run(v).deck),definition:query(adventures.exports.card,{run:b.input,id:richCurse}),count:curseCount,upgraded:false,specialData:0,upgrade:false}),call(leave,b.input))},
      {id:3,allowed:v=>v.query(adventures.exports.position,v.input).floor>40,text:`回复全部生命并获得${healCurse}`,execute:sequence(healAndCurse,call(leave,b.input))},
    ]);
  });
  programs[e.DEAD_ADVENTURER]=defineEffect<number,void>(b=>{const chanceStep=25,findGold=30,battleGold=[25,35],risk=(v:rules.ReadView<number>)=>v.get(phase)*chanceStep+(run(v).ascension>=15?35:25);const order=b.local<readonly number[]>(),encounter=b.local<number>(),phase=b.local<number>(),roll=b.local<number>(),gold=b.local<number>(),rewardRelics=b.local<RelicDefinition[]>(),relic=b.local<RelicDefinition>(),tier=b.local<RelicTier>(),done=b.local<boolean>(),won=b.local<boolean>();return sequence(
    b.assign(order,random.exports.shuffle({stream:b.read(v=>run(v).streams.misc),items:[0,1,2]})),b.assign(roll,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:2})),b.assign(encounter,b.read(v=>[encounters.THREE_SENTRIES,encounters.GREMLIN_NOB,encounters.LAGAVULIN_EVENT][v.get(roll)]!)),b.assign(phase,0),b.assign(done,false),
    whileDo(b.read(v=>!v.get(done)&&v.query(resources.exports.vitality,run(v).actor).hp>0),eventBranches(b,ui,[{id:0,text:v=>`继续搜索：${Math.min(100,risk(v))}%概率进入精英战斗，每次增加${chanceStep}个百分点；可能发现${findGold}金币或遗物；战胜获得${battleGold[0]}–${battleGold[1]}金币、未搜索的奖励、卡牌及可能的药水`,execute:sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:99})),when(b.read(v=>v.get(roll)<risk(v)),sequence(
      b.assign(gold,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:battleGold[0]!,end:battleGold[1]!})),b.assign(rewardRelics,[]),forEach(b.read(v=>v.get(order).slice(v.get(phase))),kind=>when(b.read(v=>v.get(kind)===0),b.assign(gold,b.read(v=>v.get(gold)+findGold)),when(b.read(v=>v.get(kind)===2),sequence(b.assign(tier,call(loot.exports.tier,{run:b.input,elite:false})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier,shop:false,front:true,screenless:false})),b.assign(rewardRelics,b.read(v=>[...v.get(rewardRelics),v.get(relic)])))))),b.assign(won,call(fight,{run:b.input,encounter})),when(won,call(rewards,{run:b.input,gold,relics:rewardRelics,potion:true,cardsFirst:true})),b.assign(done,true),
    ),sequence(when(b.read(v=>v.get(order)[v.get(phase)]===0),call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:findGold}),when(b.read(v=>v.get(order)[v.get(phase)]===2),sequence(b.assign(tier,call(loot.exports.tier,{run:b.input,elite:false})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier,shop:false,front:true,screenless:true})),call(acquisition.exports.give,{run:b.input,definition:relic})))),b.assign(phase,b.read(v=>v.get(phase)+1)))))},{id:1,text:'离开',execute:sequence(call(leave,b.input),b.assign(done,true))}])),
  );});
  return{exports:{programs}};
}});}
