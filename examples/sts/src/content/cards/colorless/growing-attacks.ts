import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {zones} from "../../../rules/zones.ts";
import {resources} from "../../../rules/resources.ts";
import {attributes} from "../../../rules/attributes.ts";
import {damage} from "../../../rules/damage.ts";
import {adventures} from "../../../rules/adventures.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {concreteCard,cardAmount,type CardAmount} from "../shared/programs.ts";
import type {CardUse,CardState} from "../../../rules/card-instances.types.ts";

const {defineRules,defineEffect,sequence,when,forEach,call,query,enqueue}=rules;
export const colorlessAdvancedAttacks=defineRules({requires:[battles,basicPowers,adventures],build(){
  const queue=(effect:rules.Effect<CardUse,void>)=>defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));
  const addSpecial=defineEffect<{use:CardUse;amount:number;permanent:boolean},void>(b=>{const next=b.local<CardState>();return sequence(
    b.assign(next,b.read(v=>{const c=v.get(query(battles.exports.context,{battle:v.input.use.battle,play:v.input.use.play})).state;return{...c,specialData:((c.specialData+v.input.amount)<<16)>>16};})),
    call(battles.exports.setPlayState,{battle:b.read(v=>v.input.use.battle),play:b.read(v=>v.input.use.play),state:next}),
    when(b.read(v=>v.input.use.purgeOnUse),when(b.read(v=>v.get(query(zones.exports.location,v.input.use.card))!==null),call(cardInstances.exports.setSpecialData,{entity:b.read(v=>v.input.use.card),value:b.read(v=>{const c=v.get(query(cardInstances.exports.current,v.input.use.card));return((c.specialData+v.input.amount)<<16)>>16;})}))),

  );});
  function lethal(amount:CardAmount,reward:rules.Effect<CardUse,void>,attack=true){const act=defineEffect<{use:CardUse;amount:number},void>(b=>sequence(
    when(b.read(v=>v.input.use.target===null||!v.get(query(battles.exports.targetable,v.input.use.target))),b.return(undefined)),
    call(damage.exports.hit,{battle:b.read(v=>v.input.use.battle),source:b.read(v=>v.input.use.owner),target:b.read(v=>v.input.use.target!),amount:b.read(v=>v.input.amount),attack,selfDamage:false}),
    when(b.read(v=>v.get(query(resources.exports.current,v.input.use.target!)).hp===0&&v.get(query(battles.exports.rewardEligible,{battle:v.input.use.battle,target:v.input.use.target!}))),call(reward,b.read(v=>v.input.use))),call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle)),
  ));return defineEffect<CardUse,void>(b=>enqueue(act,{use:b.input,amount:query(attributes.exports.attackAmount,{source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),card:b.read(v=>v.input.card),base:b.read(v=>cardAmount(amount,v))})},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  const greed=lethal([20,25],defineEffect<CardUse,void>(b=>call(resources.exports.gainGold,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.input.state.upgraded?25:20)})),false);
  const dagger=lethal(v=>v.input.state.specialData,defineEffect<CardUse,void>(b=>call(addSpecial,{use:b.input,amount:b.read(v=>v.input.state.upgraded?5:3),permanent:true})));
  return{exports:{HandOfGreed:concreteCard('HAND_OF_GREED',greed),
    RitualDagger:concreteCard('RITUAL_DAGGER',dagger,{returned:defineEffect<import('../../../rules/card-instances.types.ts').CardReturn,void>(b=>call(cardInstances.exports.setSpecialData,{entity:b.read(v=>v.input.master),value:b.read(v=>v.get(query(cardInstances.exports.current,v.input.card)).specialData)}))})}};
}});
