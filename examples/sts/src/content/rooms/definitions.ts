import { typedValue } from '../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {rooms} from "../../rules/rooms.ts";
import {adventures,emptyAdventureRewards} from "../../rules/adventures.ts";
import {nextEncounterChoices,secondBossChoices} from '../enemies/plans.ts';
import {ordering,uniformMappedChoices} from '../../rules/ordering.ts';
import {unitMass} from '@bear-forge/card-engine/probability-mass';
import {random,float24Image} from "../../rules/random.ts";
import {resources} from "../../rules/resources.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {relics,type RelicDefinition} from "../../rules/relics.ts";
import {adventureDraws} from "../rewards/draws.ts";
import {adventureProgression} from "../../program/progression.ts";
import {combatProgram} from "../../program/combat.ts";
import {createAdventureLoot} from "../rewards/loot.ts";
import type {createAdventureAcquisition} from "../relics/acquisition.ts";
import type {createMerchant} from "./shop.ts";
import type {AdventureChoiceExports} from "../../rules/adventure-choices.ts";
import type {AdventureRewards,CardPreview,RelicTier} from "../../rules/adventures.types.ts";
import type {Room} from "../../map.types.ts";
import type {RelicId} from "../../identifiers.ts";
import {eventId} from "../../identifiers.ts";
import {describeProgram,programText} from '../cards/shared/program-facts.ts';

/** These combinators execute their children; an opaque child stays executable but
 * prevents claiming a complete description of the parent. */
export function roomSequence(...children:rules.Effect<number,void>[]){
  const effect=rules.defineEffect<number,void>(b=>rules.sequence(...children.map(child=>rules.call(child,b.input))));
  const texts=children.map(programText);
  return texts.every(text=>text!==undefined)?describeProgram(effect,texts.join('，')):effect;
}
function roomText(effect:rules.Effect<number,void>,prefix:string){
  const text=programText(effect);
  return text===undefined?{}:{text:prefix+text+'。'};
}

export type AdventureEventExports={open:rules.Effect<number,void>;resolve:rules.Effect<number,Room>};
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,forEach,call,query}=rules;
export function createAdventureRooms(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>,merchant:ReturnType<typeof createMerchant>,events:rules.RuleModule<AdventureEventExports>){
  const loot=createAdventureLoot(acquisition);
  return defineRules({requires:[rooms,ui,acquisition,merchant,events,loot,adventureProgression,combatProgram,ordering],build(){
    const relicEntity=defineQuery({input:z.object({run:z.number(),id:typedValue<RelicId>()}),output:z.number().nullable(),dependencies:[adventures.exports.current,adventures.exports.relic,relics.exports.find,adventures.exports.bindings],base:(r,i)=>r.query(relics.exports.find,{actor:r.query(adventures.exports.bindings,i.run).actor,definition:r.query(adventures.exports.relic,i)})});
    const relicData=defineQuery({input:z.object({run:z.number(),id:typedValue<RelicId>()}),output:z.number(),dependencies:[relicEntity,relics.exports.data],base:(r,i)=>{const e=r.query(relicEntity,i);return e===null?0:r.query(relics.exports.data,e);}});
    const interact=defineEffect<{run:number;id:RelicId},void>(b=>call(relics.exports.interact,b.read(v=>{const id=v.query(relicEntity,v.input);if(id===null)throw Error('Required relic is absent');return id;})));
    const map=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:false}));
    const mapKeep=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:true}));
    const reward=defineEffect<{run:number;reward:AdventureRewards},void>(b=>sequence(call(adventures.exports.setRewards,{run:b.read(v=>v.input.run),rewards:b.read(v=>v.input.reward)}),call(acquisition.exports.rewards,b.read(v=>v.input.run))));
    const battleReward=defineEffect<number,void>(b=>{const rewards=b.local<AdventureRewards>();return sequence(b.assign(rewards,call(loot.exports.battle,{run:b.input,room:b.read(v=>v.query(adventures.exports.position,v.input).room)})),call(reward,{run:b.input,reward:rewards}));});
    const fight=defineEffect<{run:number;encounter:number},boolean>(b=>{const result=b.local<0|1|2>();return sequence(b.assign(result,call(combatProgram.exports.run,b.input)),when(b.read(v=>v.get(result)===2),sequence(call(adventures.exports.setOutcome,{run:b.read(v=>v.input.run),outcome:0}),b.return(false))),b.return(true));});
    const ordinaryFight=defineEffect<number,void>(b=>{const encounter=b.local<number>(),won=b.local<boolean>();return sequence(b.assign(encounter,call(adventures.exports.takeEncounter,{run:b.input,elite:b.read(v=>v.query(adventures.exports.position,v.input).room==='ELITE'),choices:b.read(v=>{const p=v.query(adventures.exports.position,v.input),s=v.query(adventures.exports.plan,v.input),elite=p.room==='ELITE',list=elite?s.eliteList:s.monsterList,offset=elite?s.eliteOffset:s.monsterOffset;return p.act===4?[{key:String(list[offset]),value:list[offset]!,weight:unitMass()}]:nextEncounterChoices(p.act,elite,list.slice(0,offset));})})),b.assign(won,call(fight,{run:b.input,encounter})),when(won,sequence(call(battleReward,b.input),call(map,b.input))));});
    const boss=defineEffect<number,void>(b=>{const won=b.local<boolean>(),relic=b.local<RelicDefinition>(),offered=b.local<RelicDefinition[]>(),chosen=b.local<number>(),secondBoss=b.local<number>();return sequence(
      b.assign(won,call(fight,{run:b.input,encounter:b.read(v=>v.query(adventures.exports.plan,v.input).boss)})),when(b.read(v=>!v.get(won)),b.return(undefined)),
      when(b.read(v=>v.query(adventures.exports.position,v.input).act===4),sequence(call(adventures.exports.setOutcome,{run:b.input,outcome:2}),b.return(undefined))),
      when(b.read(v=>v.query(adventures.exports.position,v.input).act===3),sequence(
        call(adventures.exports.incrementFloor,{run:b.input}),call(adventureProgression.exports.reseedFloor,b.input),call(adventures.exports.notifyEntered,{run:b.input,room:'BOSS'}),b.assign(secondBoss,call(ordering.exports.select,{actual:b.read(v=>v.query(adventures.exports.plan,v.input).secondBoss),choices:b.read(v=>secondBossChoices(v.query(adventures.exports.plan,v.input).boss))})),b.assign(won,call(fight,{run:b.input,encounter:secondBoss})),when(b.read(v=>!v.get(won)),b.return(undefined)),call(adventures.exports.incrementFloor,{run:b.input}),call(adventures.exports.notifyEntered,{run:b.input,room:'BOSS_TREASURE'}),when(b.read(v=>{const k=v.query(adventures.exports.position,v.input).keys;return k.red&&k.green&&k.blue;}),call(adventureProgression.exports.nextAct,b.input),call(adventures.exports.setOutcome,{run:b.input,outcome:2})),b.return(undefined),
      )),
      call(battleReward,b.input),call(adventures.exports.incrementFloor,{run:b.input}),call(adventureProgression.exports.reseedFloor,b.input),call(adventures.exports.notifyEntered,{run:b.input,room:'BOSS_TREASURE'}),call(adventures.exports.setRoom,{run:b.input,room:'BOSS_TREASURE',event:eventId.INVALID}),b.assign(offered,[]),
      forEach([0,1,2],()=>sequence(b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:'boss',shop:false,front:true,screenless:false})),b.assign(offered,b.read(v=>[...v.get(offered),v.get(relic)])))),call(adventures.exports.setBossRelics,{run:b.input,relics:offered}),b.assign(chosen,call(ui.exports.choose,{run:b.input,actions:[0,1,2,3]})),when(b.read(v=>(v.get(chosen)&255)<3),call(acquisition.exports.give,{run:b.input,definition:b.read(v=>v.get(offered)[v.get(chosen)&255]!)})),call(adventureProgression.exports.nextAct,b.input),
    );});
    function disallowRest(id:'COFFEE_DRIPPER'|'FUSION_HAMMER',action:string){return{
      allowed:defineQuery({input:z.number(),output:z.boolean(),dependencies:[adventures.exports.hasRelic],base:(r,run)=>!r.query(adventures.exports.hasRelic,{run,id})}),text:`篝火不能${action}。`,
    };}
    const coffeeDripper=disallowRest('COFFEE_DRIPPER','休息'),fusionHammer=disallowRest('FUSION_HAMMER','升级牌');
    function owned(id:RelicId,child:rules.Effect<number,void>){
      const effect=defineEffect<number,void>(b=>when(query(adventures.exports.hasRelic,{run:b.input,id}),call(child,b.input)));
      const text=programText(child);return text===undefined?effect:describeProgram(effect,text);
    }
    function heal(amount:number){return describeProgram(defineEffect<number,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount})),`自身回复${amount}生命`);}
    // The bonus is part of the same heal call, not a second heal/event.
    function restHealing(bonus:number){
      const bonusAmount=defineQuery({input:z.number(),output:z.number(),dependencies:[adventures.exports.hasRelic],base:(r,run)=>r.query(adventures.exports.hasRelic,{run,id:'REGAL_PILLOW'})?bonus:0});
      return {effect:defineEffect<number,void>(b=>call(resources.exports.heal,b.read(v=>{const entity=v.query(adventures.exports.bindings,v.input).actor;return{entity,amount:Math.trunc(Math.fround(Math.fround(v.query(resources.exports.vitality,entity).maxHp)*Math.fround(.3)))+v.query(bonusAmount,v.input)};}))),text:`篝火休息时额外回复${bonus}生命。`};
    }
    const regalPillow=restHealing(15);
    function cardReward(room:Room){return describeProgram(defineEffect<number,void>(b=>{const cards=b.local<CardPreview[]>();return sequence(b.assign(cards,call(adventureDraws.exports.reward,{publish:true,run:b.input,room})),call(reward,{run:b.input,reward:{...emptyAdventureRewards(),cards:[cards]}}));}),'获得1组卡牌奖励');}
    function afterRestHealing(healing:rules.Effect<number,void>,child:rules.Effect<number,void>){return {effect:roomSequence(healing,child),...roomText(child,'篝火休息后，')};}
    const dreamCatcher=afterRestHealing(regalPillow.effect,owned('DREAM_CATCHER',cardReward('REST')));
    function campfireOption(id:'GIRYA'|'PEACE_PIPE'|'SHOVEL',action:string,child:rules.Effect<number,void>,maximum?:number){return{
      available:defineQuery({input:z.number(),output:z.boolean(),dependencies:[adventures.exports.hasRelic,relicData],base:(r,run)=>r.query(adventures.exports.hasRelic,{run,id})&&(maximum===undefined||r.query(relicData,{run,id})!==maximum)}),
      effect:child,...roomText(child,`篝火可选择${action}，`),
    };}
    const girya=campfireOption('GIRYA','举重',describeProgram(defineEffect<number,void>(b=>call(interact,{run:b.input,id:'GIRYA'})),acquisition.exports.counterPrograms.GIRYA.text),acquisition.exports.counterPrograms.GIRYA.maximum);
    function pipePreparation(count:number){return describeProgram(defineEffect<number,void>(b=>call(acquisition.exports.selections.exports.prepare,{run:b.input,type:4,count,provided:null,stream:b.read(v=>v.query(adventures.exports.selection,v.input).selection.transformStream)})),`准备移除${count}张牌；当前流程仅准备选牌，不执行删除`);}
    const peacePipe=campfireOption('PEACE_PIPE','准备移除牌',pipePreparation(1));
    const digRelic=describeProgram(defineEffect<number,void>(b=>{const rank=b.local<RelicTier>(),relic=b.local<RelicDefinition>();return sequence(b.assign(rank,call(loot.exports.tier,{run:b.input,elite:false})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:rank,shop:false,front:true,screenless:false})),call(reward,{run:b.input,reward:{...emptyAdventureRewards(),relics:[relic]}}));}),'获得1件随机遗物');
    const shovel=campfireOption('SHOVEL','挖掘',digRelic);
    const rest=defineEffect<number,void>(b=>{const choice=b.local<number>();return sequence(
      call(adventures.exports.setScene,{run:b.input,screen:'REST_ROOM',continuation:true}),b.assign(choice,call(ui.exports.choose,{run:b.input,actions:b.read(v=>{const s=v.query(adventures.exports.status,v.input),out:number[]=[];if(v.query(coffeeDripper.allowed,v.input))out.push(0);if(v.query(fusionHammer.allowed,v.input)&&v.query(permanentDecks.exports.current,s.deck).upgradeable>0)out.push(1);if(!s.keys.red)out.push(2);if(v.query(girya.available,v.input))out.push(3);if(v.query(peacePipe.available,v.input))out.push(4);if(v.query(shovel.available,v.input))out.push(5);return out.length?out:[6];})})),b.assign(choice,b.read(v=>v.get(choice)&255)),
      when(b.read(v=>v.get(choice)===0),call(dreamCatcher.effect,b.input)),
      when(b.read(v=>v.get(choice)===1),call(acquisition.exports.selections.exports.select,{run:b.input,type:3,count:1,provided:null,stream:b.read(v=>v.query(adventures.exports.selection,v.input).selection.transformStream)})),
      when(b.read(v=>v.get(choice)===2),call(adventures.exports.setKeys,{run:b.input,keys:b.read(v=>({...v.query(adventures.exports.position,v.input).keys,red:true}))})),
      when(b.read(v=>v.get(choice)===3),call(girya.effect,b.input)),
      when(b.read(v=>v.get(choice)===4),call(peacePipe.effect,b.input)),
      when(b.read(v=>v.get(choice)===5),call(shovel.effect,b.input)),
      call(mapKeep,b.input),
    );});
    type ChestInput={run:number;rewards:AdventureRewards};
    function chestRelicDraw(commonChance:number){return describeProgram(defineEffect<number,RelicDefinition>(b=>{const coin=b.local<boolean>(),rank=b.local<RelicTier>(),relic=b.local<RelicDefinition>();return sequence(
      b.assign(coin,call(random.exports.chance,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.relic),chance:commonChance})),b.assign(rank,b.read(v=>v.get(coin)?'common':'uncommon')),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:rank,shop:false,front:true,screenless:false})),b.return(relic),
    );}),`遗物（普通概率${commonChance*100}%，否则罕见）`);}
    function extraChestRelic(draw:rules.Effect<number,RelicDefinition>){
      const effect=defineEffect<ChestInput,AdventureRewards>(b=>{const relic=b.local<RelicDefinition>();return sequence(
        when(b.read(v=>v.query(relicData,{run:v.input.run,id:'MATRYOSHKA'})<=0),b.return(b.read(v=>v.input.rewards))),
        b.assign(relic,call(draw,b.read(v=>v.input.run))),call(interact,{run:b.read(v=>v.input.run),id:'MATRYOSHKA'}),b.return(b.read(v=>({...v.input.rewards,relics:[v.get(relic)]}))),
      );});
      const text=programText(draw),initial=acquisition.exports.counterPrograms.MATRYOSHKA.initial;
      return {effect,text:text===undefined?undefined:initial===0?'当前实现初始可用次数为0，不提供额外宝箱遗物。':`接下来${initial}个打开的非Boss宝箱额外获得1件${text}。`};
    }
    const matryoshka=extraChestRelic(chestRelicDraw(.75));
    function obtainCurse(count:number){return describeProgram(defineEffect<number,void>(b=>{const card=b.local<CardPreview>();return sequence(b.assign(card,call(adventureDraws.exports.curse,b.input)),call(permanentDecks.exports.obtain,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input).deck),definition:b.read(v=>v.get(card).definition),upgraded:false,specialData:0,count,upgrade:false}));}),`获得${count}张随机诅咒`);}
    const curseEffect=owned('CURSED_KEY',obtainCurse(1));
    const cursedKey={effect:curseEffect,...roomText(curseEffect,'打开非Boss宝箱时，')};
    function baseChestRelic(id:'NLOTHS_HUNGRY_FACE'){const keeps=defineQuery({input:z.number(),output:z.boolean(),dependencies:[relicData],base:(r,run)=>r.query(relicData,{run,id})<=0});return {keeps,effect:defineEffect<ChestInput&{relic:RelicDefinition},AdventureRewards>(b=>sequence(
      when(b.read(v=>!v.query(keeps,v.input.run)),sequence(call(interact,{run:b.read(v=>v.input.run),id}),b.return(b.read(v=>v.input.rewards)))),
      b.return(b.read(v=>({...v.input.rewards,relics:[...v.input.rewards.relics,v.input.relic]}))),
    )),text:`接下来${acquisition.exports.counterPrograms[id].initial}个打开的非Boss宝箱不给基础遗物（不影响额外遗物）。`};}
    const hungryFace=baseChestRelic('NLOTHS_HUNGRY_FACE');
    const chestOutcome=(size:number,roll:number)=>{const common=[75,35,0][size]!,uncommon=[25,50,75][size]!;return{size,haveGold:roll<[50,35,50][size]!,tier:roll<common?'common' as const:roll<common+uncommon?'uncommon' as const:'rare' as const};};
    // Both the original cached roll and its later hidden-value consumption
    // use this one mapping. The probability kernel only counts its preimages.
    const chestValues=(outcomes:readonly ReturnType<typeof chestOutcome>[])=>outcomes.map(value=>outcomes.findIndex(other=>other.haveGold===value.haveGold&&other.tier===value.tier));
    const treasure=defineEffect<number,void>(b=>{const size=b.local<number>(),roll=b.local<number>(),choice=b.local<number>(),relic=b.local<RelicDefinition>(),rewardValue=b.local<AdventureRewards>(),contents=b.local<ReturnType<typeof chestOutcome>[]>();return sequence(
      b.assign(size,call(random.exports.mappedInt,b.read(v=>{const values=Array.from({length:100},(_,roll)=>roll<50?0:roll<83?1:2);return{stream:v.query(adventures.exports.bindings,v.input).streams.treasure,values,declarations:values.map(value=>({name:'chest-size',value}))};}))),
      b.assign(contents,b.read(v=>Array.from({length:100},(_,roll)=>chestOutcome(v.get(size),roll)))),
      b.assign(roll,call(random.exports.mappedInt,b.read(v=>{const outcomes=v.get(contents);return{stream:v.query(adventures.exports.bindings,v.input).streams.treasure,values:chestValues(outcomes)};}))),call(adventures.exports.setChest,{run:b.input,chest:b.read(v=>v.get(contents)[v.get(roll)]!)}),
      b.assign(choice,call(ui.exports.choose,{run:b.input,actions:[0,1]})),when(b.read(v=>(v.get(choice)&255)!==0),sequence(call(mapKeep,b.input),b.return(undefined))),b.assign(roll,call(ordering.exports.select,b.read(v=>{
        const actual=v.query(adventures.exports.rewards,v.input).chest!,outcomes=v.get(contents);
        return{actual:outcomes.findIndex(row=>row.haveGold===actual.haveGold&&row.tier===actual.tier),choices:uniformMappedChoices(chestValues(outcomes))};
      }))),call(adventures.exports.setChest,{run:b.input,chest:b.read(v=>v.get(contents)[v.get(roll)]!)}),b.assign(rewardValue,emptyAdventureRewards()),
      b.assign(rewardValue,call(matryoshka.effect,{run:b.input,rewards:rewardValue})),
      call(cursedKey.effect,b.input),
      when(b.read(v=>v.query(adventures.exports.rewards,v.input).chest!.haveGold),sequence(b.assign(roll,call(random.exports.mappedFloat,b.read(v=>{const base=[25,50,75][v.get(size)]!;return{stream:v.query(adventures.exports.bindings,v.input).streams.treasure,image:float24Image(Math.fround(base*Math.fround(.9)),Math.fround(base*Math.fround(1.1)),Math.round).map(row=>({...row,publication:{name:'chest-gold',value:row.value}}))};}))),b.assign(rewardValue,b.read(v=>({...v.get(rewardValue),gold:[v.get(roll)]}))))),
      b.assign(relic,call(acquisition.exports.draw,b.read(v=>({run:v.input,tier:v.query(adventures.exports.rewards,v.input).chest!.tier,shop:false,front:true,screenless:false,...(v.query(hungryFace.keeps,v.input)?{publication:'chest-relic'}:{})})))),b.assign(rewardValue,call(hungryFace.effect,{run:b.input,rewards:rewardValue,relic})),b.assign(rewardValue,b.read(v=>({...v.get(rewardValue),sapphireKey:!v.query(adventures.exports.position,v.input).keys.blue}))),call(reward,{run:b.input,reward:rewardValue}),call(mapKeep,b.input),
    );});
    function onShopEntry(child:rules.Effect<number,void>){return {
      effect:defineEffect<number,void>(b=>sequence(call(child,b.input),call(merchant.exports.open,b.input),call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:true}))),
      ...roomText(child,'进入商店时，'),
    };}
    const mealTicket=onShopEntry(owned('MEAL_TICKET',heal(15))),shop=mealTicket.effect;
    const room=(key:Room,enter:rules.Effect<number,void>)=>({key,definition:defineEntity(rooms.exports.kind,{enter:defineEffect<{run:number;room:number},void>(b=>call(enter,b.read(v=>v.input.run)))})});
    return{exports:{definitions:[room('MONSTER',ordinaryFight),room('ELITE',ordinaryFight),room('BOSS',boss),room('REST',rest),room('TREASURE',treasure),room('SHOP',shop),room('EVENT',events.exports.open)],resolveEvent:events.exports.resolve,loot,relicTexts:Object.freeze(Object.fromEntries(Object.entries({COFFEE_DRIPPER:coffeeDripper.text,FUSION_HAMMER:fusionHammer.text,REGAL_PILLOW:regalPillow.text,DREAM_CATCHER:dreamCatcher.text,GIRYA:girya.text,PEACE_PIPE:peacePipe.text,SHOVEL:shovel.text,MATRYOSHKA:matryoshka.text,CURSED_KEY:cursedKey.text,NLOTHS_HUNGRY_FACE:hungryFace.text,MEAL_TICKET:mealTicket.text}).filter((entry):entry is [string,string]=>entry[1]!==undefined)))}};
  }});
}
