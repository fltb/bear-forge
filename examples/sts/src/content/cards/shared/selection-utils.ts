import {combatSessions} from "../../../rules/combat-sessions.ts";
import {rules} from '../../../rules/execution.ts';
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {zones} from "../../../rules/zones.ts";
import {combatGeneration} from "../../../program/card-generation.ts";
import {CardScreen} from "../../../adapters/selection-presentations.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import type {CardChoiceExports} from "../../../rules/card-choices.types.ts";
import type {PermanentCardDefinition} from "../../../rules/permanent-decks.types.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query,enqueue}=rules;
// Parameters and templates owned by these actual selection operations.
const discoveryChoices=3;
const discoveryZeroTurn=true;
const recalledTurnCost=0;
const handManyMinimum=0;
export function handManyDescription(discard:boolean,maximum:number|string):string {
  return `选择${handManyMinimum}至${maximum}张手牌${discard?'弃掉并抽等量牌':'消耗'}。`;
}
export function discoveryDescription(category:0|1|2|3|4,zeroTurn=discoveryZeroTurn):string {
  const label={0:'攻击',1:'技能',2:'能力',3:'牌',4:'无色牌'}[category];
  return `从${discoveryChoices}张${label}中选择1张${zeroTurn?'，本回合免费':''}。`;
}
export function discardToHandDescription(zeroTurn:boolean):string {
  return `回收1张弃牌${zeroTurn?`，本回合${recalledTurnCost}费`:''}。`;
}
export function createCombatSelectionUtils(choices:rules.RuleModule<CardChoiceExports>){return defineRules({requires:[combatGeneration,choices,combatSessions],build(){
  const discovery=defineEffect<{battle:number;actor:number;category:0|1|2|3|4;copies:number;markDiscovery?:boolean|undefined;screen?:number|undefined;skipIndex?:number|undefined;zeroTurn?:boolean|undefined;destination?:0|1|2|3|undefined;shuffle?:boolean|undefined;undefinedBehavior?:boolean|undefined},void>(b=>{const definitions=b.local<PermanentCardDefinition[]>(),definition=b.local<PermanentCardDefinition>(),previews=b.local<number[]>(),preview=b.local<number>(),selected=b.local<number|null>(),picked=b.local<PermanentCardDefinition>();return sequence(
    when(b.read(v=>v.input.markDiscovery!==false&&(v.input.screen===undefined||v.input.screen===CardScreen.Discovery)),call(combatSessions.exports.markDiscovery,{session:b.read(v=>{const session=v.query(combatSessions.exports.forBattle,v.input.battle);if(session===null)throw Error('Discovery needs a combat session');return session;}),undefinedBehavior:b.read(v=>v.input.undefinedBehavior??false)})),b.assign(definitions,[]),whileDo(b.read(v=>v.get(definitions).length<discoveryChoices),sequence(b.assign(definition,call(combatGeneration.exports.randomCard,{battle:b.read(v=>v.input.battle),category:b.read(v=>v.input.category)})),when(b.read(v=>!v.get(definitions).some(other=>v.query(cardInstances.exports.sameDefinition,[other,v.get(definition)]))),b.assign(definitions,b.read(v=>[...v.get(definitions),v.get(definition)]))))),
    b.assign(previews,[]),forEach(definitions,definition=>sequence(b.assign(preview,rules.spawnEntity({kind:cardInstances.exports.kind,definition,owner:b.read(v=>v.input.actor),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:{mode:1,master:null,uniqueId:-1,specialData:0,upgraded:false}})),b.assign(previews,b.read(v=>[...v.get(previews),v.get(preview)])))),
    b.assign(selected,call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:b.read(v=>v.input.screen??CardScreen.Discovery),skipIndex:b.read(v=>v.input.skipIndex),cards:previews})),when(b.read(v=>v.get(selected)!==null),b.assign(picked,b.read(v=>v.get(definitions)[v.get(previews).indexOf(v.get(selected)!)]!))),forEach(previews,entity=>rules.despawnEntity({entity,reason:{previewComplete:true}})),when(b.read(v=>v.get(selected)===null),b.return(undefined)),forEach(b.read(v=>Array.from({length:v.input.copies},(_,index)=>index)),()=>call(combatGeneration.exports.create,{battle:b.read(v=>v.input.battle),definition:picked,upgraded:false,zeroCombat:false,zeroTurn:b.read(v=>v.input.zeroTurn??discoveryZeroTurn),destination:b.read(v=>v.input.destination??1),shuffle:b.read(v=>v.input.shuffle??false)})),
  );});
  const discardToHand=defineEffect<{battle:number;zeroTurn:boolean;screen:number},void>(b=>{const picked=b.local<number|null>(),piles=b.local<number>();return sequence(b.assign(piles,b.read(v=>v.query(battles.exports.status,v.input.battle).piles)),b.assign(picked,call(choices.exports.one,{battle:b.read(v=>v.input.battle),screen:b.read(v=>v.input.screen),cards:b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.get(piles)).discard))})),when(b.read(v=>v.get(picked)===null),b.return(undefined)),when(b.read(v=>v.input.zeroTurn),call(cardInstances.exports.setCostForTurn,{entity:b.read(v=>v.get(picked)!),amount:recalledTurnCost})),call(cardPiles.exports.moveToHand,{piles,card:b.read(v=>v.get(picked)!)}));});
  const handMany=defineEffect<{battle:number;discard:boolean;maximum:number},void>(b=>{const piles=b.local<number>(),picked=b.local<readonly number[]>();return sequence(b.assign(piles,b.read(v=>v.query(battles.exports.status,v.input.battle).piles)),b.assign(picked,call(choices.exports.many,{battle:b.read(v=>v.input.battle),screen:b.read(v=>v.input.discard?CardScreen.Gamble:CardScreen.ExhaustMany),cards:b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.get(piles)).hand)),minimum:handManyMinimum,maximum:b.read(v=>v.input.maximum)})),when(b.read(v=>v.input.discard&&v.get(picked).length>0),enqueue(cardPiles.exports.draw,{piles,count:b.read(v=>v.get(picked).length)},{queue:actionQueue,position:'front',source:b.read(v=>v.input.battle),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),forEach(b.read(v=>[...v.get(picked)].reverse()),card=>when(b.read(v=>v.input.discard),call(cardPiles.exports.discard,{piles,card,endTurn:false}),call(cardPiles.exports.exhaust,{piles,card}))));});
  return{exports:{discovery,discardToHand,handMany}};
}});}
