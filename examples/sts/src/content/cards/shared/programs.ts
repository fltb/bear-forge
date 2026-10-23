import {attackProgram,inheritPrograms,programMetadata,registerAmountBase,describeProgram,programText,amountText,describeAmount} from './program-facts.ts';
import {cardTargets} from '../../../rules/card-targets.ts';
import {cardEffects} from '../../../rules/card-effects.ts';
import {rules} from '../../../rules/execution.ts';
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {attributes} from "../../../rules/attributes.ts";
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {cards} from "../../../cards.ts";
import type {CardUse,CardConfig,CardIdentity} from "../../../rules/card-instances.types.ts";
import type {PowerDefinition} from "../../../rules/powers.types.ts";
import {standardUpgrade,upgradeOnce} from "./lifecycle.ts";

const {defineEffect,sequence,call,enqueue,query,forEach}=rules;
export type CardAmount=number|readonly[number,number]|((v:rules.ReadView<CardUse>)=>number);
export const cardAmount=(amount:CardAmount,v:rules.ReadView<CardUse>)=>typeof amount==='number'?amount:typeof amount==='function'?amount(v):amount[v.input.state.upgraded?1:0];
/** Preserve arbitrary callbacks while deriving the preview base from the same operand. */
export function additiveAmount(base:CardAmount,extra:(v:rules.ReadView<CardUse>)=>number):CardAmount{const amount=registerAmountBase((v:rules.ReadView<CardUse>)=>cardAmount(base,v)+extra(v),base),baseText=amountText(base),extraText=amountText(extra);return baseText!==undefined&&extraText!==undefined?describeAmount(amount,`${baseText}+${extraText}`):amount;}
export function composePrograms(...effects:rules.Effect<CardUse,void>[]){return inheritPrograms(defineEffect<CardUse,void>(b=>sequence(...effects.map(effect=>call(effect,b.input)))),...effects);}
export function describeAmounts<T extends object>(effect:T,amounts:readonly CardAmount[],render:(...amounts:string[])=>string):T{
  const text=amounts.map(amountText);return text.every((value):value is string=>value!==undefined)?describeProgram(effect,render(...text)):effect;
}
export function cardRuleText(identity:CardIdentity,...effects:object[]):string|undefined{
  const texts=effects.map(programText);if(texts.some(text=>text===undefined))return undefined;
  const flags=([['ethereal','虚无'],['exhaust','消耗'],['innate','固有'],['retain','保留']] as const).flatMap(([key,label])=>{
    const a=identity.variants[0][key],b=identity.variants[1][key];return a===b?a?[`${label}。`]:[]:[`${a?'未升级':'升级后'}${label}。`];
  });
  const unplayable=identity.variants.map(variant=>variant.cost< -1);
  const playText=unplayable[0]&&unplayable[1]?'不可打出。':unplayable[0]?'未升级时不可打出。':unplayable[1]?'升级后不可打出。':'';
  return [playText,...texts,...flags].join('');
}
export type DescribedPower=Readonly<{definition:PowerDefinition;name:string;text:string;complete?:boolean}>;
export function concreteCard(id:keyof typeof cards,use:rules.Effect<CardUse,void>,policies:Partial<Pick<CardConfig,'canUse'|'canTransform'|'endTurn'|'created'|'removed'|'returned'>>={}){
  return rules.defineEntity(cardInstances.exports.kind,{id,metadata:programMetadata(cards[id],use),text:cardRuleText(cards[id],use,...Object.values(policies).filter((effect):effect is NonNullable<typeof effect>=>effect!==undefined)),use,canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id]),...policies});
}
export function targetAttack(amount:CardAmount,count:CardAmount=1){return describeAmounts(attackProgram(defineEffect<CardUse,void>(b=>{
  const hits=b.local<import('../../../rules/damage.types.ts').HitRequest[]>();
  return sequence(b.assign(hits,b.read(v=>v.query(cardTargets.exports.enemies,v.input).map(target=>({battle:v.input.battle,source:v.input.owner,target,amount:v.query(attributes.exports.attackAmount,{source:v.input.owner,target,base:cardAmount(amount,v),card:v.input.card}),attack:true,selfDamage:false})))),
    forEach(b.read(v=>Array.from({length:cardAmount(count,v)},(_,i)=>i)),()=>forEach(hits,request=>enqueue(cardEffects.exports.hit,{use:b.input,request,targeted:true},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))));
}),amount),[amount,count],(damage,hits)=>`对目标造成${damage}伤害${hits==='1'?'':`，重复${hits}次`}。`);}
export function cardBlock(amount:CardAmount,twice=false){return describeAmounts(defineEffect<CardUse,void>(b=>enqueue(cardEffects.exports.gainBlock,{use:b.input,amount:b.read(v=>{
  const first=v.query(attributes.exports.blockAmount,{actor:v.input.owner,base:cardAmount(amount,v)});return twice?v.query(attributes.exports.blockAmount,{actor:v.input.owner,base:first}):first;
})},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),[amount],value=>`获得${value}格挡${twice?'（格挡修正计算两次）':''}。`);}
export function cardDraw(amount:CardAmount){return describeAmounts(defineEffect<CardUse,void>(b=>enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),[amount],value=>`抽${value}张牌。`);}
export function cardEnergy(amount:CardAmount){return describeAmounts(defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),[amount],value=>`获得${value}能量。`);}
export function cardPower(power:PowerDefinition|DescribedPower,amount:CardAmount,targeted=false,debuff=false){const described='definition' in power?power:undefined,definition=described?.definition??power as PowerDefinition;const effect=defineEffect<CardUse,void>(b=>forEach(targeted?query(cardTargets.exports.enemies,b.input):b.read(v=>[v.input.owner]),actor=>enqueue(powers.exports.apply,{definition,registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,amount:b.read(v=>cardAmount(amount,v)),source:b.read(v=>v.input.owner),debuff,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)},
  {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})));return described&&described.complete!==false?describeAmounts(effect,[amount],value=>`${targeted?'对目标施加':'自身获得'}${value}层${described.name}${debuff?'（可被人工制品抵消）':''}。${described.text}`):effect;}
