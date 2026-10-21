import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {attributes} from "../../../rules/attributes.ts";
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {cards} from "../../../cards.ts";
import type {CardUse,CardConfig} from "../../../rules/card-instances.types.ts";
import type {PowerDefinition} from "../../../rules/powers.types.ts";
import {standardUpgrade,upgradeOnce} from "./lifecycle.ts";

const {defineEffect,sequence,call,enqueue,query,forEach}=rules;
export type CardAmount=number|readonly[number,number]|((v:rules.ReadView<CardUse>)=>number);
export const cardAmount=(amount:CardAmount,v:rules.ReadView<CardUse>)=>typeof amount==='number'?amount:typeof amount==='function'?amount(v):amount[v.input.state.upgraded?1:0];
export function composePrograms(...effects:rules.Effect<CardUse,void>[]){return defineEffect<CardUse,void>(b=>sequence(...effects.map(effect=>call(effect,b.input))));}
export function concreteCard(id:keyof typeof cards,use:rules.Effect<CardUse,void>,policies:Partial<Pick<CardConfig,'canUse'|'canTransform'|'endTurn'|'created'|'removed'|'returned'>>={}){
  return rules.defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use,canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id]),...policies});
}
export function targetAttack(amount:CardAmount,count:CardAmount=1){return defineEffect<CardUse,void>(b=>{
  const hit=b.local<{battle:number;source:number;target:number;amount:number;attack:boolean;selfDamage:boolean}>();
  return sequence(b.assign(hit,b.read(v=>{if(v.input.target===null)throw Error('Attack needs a target');return{battle:v.input.battle,source:v.input.owner,target:v.input.target,amount:v.get(query(attributes.exports.attackAmount,{source:v.input.owner,target:v.input.target,base:cardAmount(amount,v),card:v.input.card})),attack:true,selfDamage:false};})),
    forEach(b.read(v=>Array.from({length:cardAmount(count,v)},(_,i)=>i)),()=>enqueue(battles.exports.hit,hit,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'})));
});}
export function cardBlock(amount:CardAmount,twice=false){return defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>{
  const first=v.get(query(attributes.exports.blockAmount,{actor:v.input.owner,base:cardAmount(amount,v)}));return twice?v.get(query(attributes.exports.blockAmount,{actor:v.input.owner,base:first})):first;
})},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
export function cardDraw(amount:CardAmount){return defineEffect<CardUse,void>(b=>enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),count:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
export function cardPower(definition:PowerDefinition,amount:CardAmount,targeted=false,debuff=false){return defineEffect<CardUse,void>(b=>enqueue(powers.exports.apply,{definition,registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:b.read(v=>{if(targeted&&v.input.target===null)throw Error('Power needs a target');return targeted?v.input.target!:v.input.owner;}),amount:b.read(v=>cardAmount(amount,v)),source:b.read(v=>v.input.owner),debuff,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)},
  {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
