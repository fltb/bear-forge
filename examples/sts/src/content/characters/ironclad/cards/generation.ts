import {describeProgram,inheritPrograms} from '../../../cards/shared/program-facts.ts';
import {rules} from '../../../../rules/execution.ts';
import {battles} from "../../../../rules/battles.ts";
import {powers} from "../../../../rules/powers.ts";
import {enemies} from "../../../../rules/enemies.ts";
import {combatGeneration} from "../../../../program/card-generation.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import type {createCombatSelectionUtils} from "../../../cards/shared/selection-utils.ts";
import {concreteCard,cardAmount,describeAmounts,type CardAmount} from "../../../cards/shared/programs.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {CardChoiceExports} from "../../../../rules/card-choices.types.ts";
import type {PermanentCardDefinition} from "../../../../rules/permanent-decks.types.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query,enqueue}=rules;
export function createGeneratedSkills(choices:rules.RuleModule<CardChoiceExports>,selectionUtils:ReturnType<typeof createCombatSelectionUtils>){return defineRules({requires:[combatGeneration,basicPowers,choices,selectionUtils],build(){
  const queue=(effect:rules.Effect<CardUse,void>)=>inheritPrograms(defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),effect);
  const randomHand=(category:0|4)=>{const count:CardAmount=category===0?1:[1,2],zeroTurn=category===0;return describeAmounts(queue(defineEffect<CardUse,void>(b=>{const definition=b.local<PermanentCardDefinition>(),definitions=b.local<PermanentCardDefinition[]>();return sequence(b.assign(definitions,[]),forEach(b.read(v=>Array.from({length:cardAmount(count,v)},(_,index)=>index)),()=>sequence(b.assign(definition,call(combatGeneration.exports.randomCard,{battle:b.read(v=>v.input.battle),category})),b.assign(definitions,b.read(v=>[...v.get(definitions),v.get(definition)])))),forEach(definitions,definition=>enqueue(combatGeneration.exports.create,{battle:b.read(v=>v.input.battle),definition,upgraded:false,zeroCombat:false,zeroTurn,destination:1,shuffle:false},{queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})));})),[count],amount=>`将${amount}张随机${category===0?'攻击':'无色'}牌加入手牌${zeroTurn?'，本回合免费':''}。`);};
  const havoc=describeProgram(defineEffect<CardUse,void>(b=>{const target=b.local<number|null>();return sequence(b.assign(target,call(combatGeneration.exports.randomTarget,b.read(v=>v.input.battle))),enqueue(combatGeneration.exports.playTop,{battle:b.read(v=>v.input.battle),target,exhaust:true},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}),`随机选择目标，打出抽牌堆顶的牌并消耗。`);
  const spotAmount=[3,4] as const;
  const spotWeakness=describeAmounts(queue(defineEffect<CardUse,void>(b=>when(b.read(v=>{if(v.input.target===null)return false;const controller=v.query(enemies.exports.forActor,v.input.target);return controller!==null&&v.query(enemies.exports.intent,controller).attack;}),call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:b.read(v=>cardAmount(spotAmount,v)),source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})))),[spotAmount],amount=>`若目标意图为攻击，自身获得${amount}层${basicPowers.exports.programs.Strength.name}。${basicPowers.exports.programs.Strength.text}`);
  return{exports:{Havoc:concreteCard('HAVOC',havoc),
    InfernalBlade:concreteCard('INFERNAL_BLADE',randomHand(0)),
    SpotWeakness:concreteCard('SPOT_WEAKNESS',spotWeakness)}};
}});}
