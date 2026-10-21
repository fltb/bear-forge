import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../../rules/battles.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {damage} from "../../../../rules/damage.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {random} from "../../../../rules/random.ts";
import {resources} from "../../../../rules/resources.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {combatPowers} from "../powers/combat.ts";
import {concreteCard,composePrograms,cardBlock,cardPower} from "../../../cards/shared/programs.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {HitResult} from "../../../../rules/damage.types.ts";

const {defineRules,defineEffect,sequence,when,forEach,call,query,enqueue}=rules;
export const groupCards=defineRules({requires:[battles,random,combatPowers],build(){
  const boomerangHit=defineEffect<CardUse,void>(b=>{const targets=b.local<readonly number[]>(),index=b.local<number>();return sequence(
    b.assign(targets,query(battles.exports.targets,b.read(v=>v.input.battle))),when(b.read(v=>v.get(targets).length===0),b.return(undefined)),
    b.assign(index,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.get(targets).length-1)})),
    enqueue(battles.exports.hit,b.read(v=>{const target=v.get(targets)[v.get(index)]!;return{battle:v.input.battle,source:v.input.owner,target,amount:v.query(attributes.exports.attackAmount,{source:v.input.owner,target,base:3,card:v.input.card}),attack:true,selfDamage:false};}),
      {queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),
  );});
  const boomerang=defineEffect<CardUse,void>(b=>forEach(b.read(v=>Array.from({length:v.input.state.upgraded?4:3},(_,i)=>i)),()=>enqueue(boomerangHit,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})));
  const reap=defineEffect<CardUse,void>(b=>{const total=b.local<number>(),hit=b.local<HitResult>();return sequence(b.assign(total,0),
    forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>sequence(
      b.assign(hit,call(damage.exports.attack,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target,base:b.read(v=>v.input.state.upgraded?5:4),card:b.read(v=>v.input.card)})),b.assign(total,b.read(v=>v.get(total)+v.get(hit).lost)),
    )),when(b.read(v=>v.get(total)>0),enqueue(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:total},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'})),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
  );});
  const reaper=defineEffect<CardUse,void>(b=>enqueue(reap,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  return{exports:{
    SwordBoomerang:concreteCard('SWORD_BOOMERANG',boomerang),Reaper:concreteCard('REAPER',reaper),
    FlameBarrier:concreteCard('FLAME_BARRIER',composePrograms(cardBlock([12,16]),cardPower(combatPowers.exports.FlameBarrier,[4,6]))),
    Metallicize:concreteCard('METALLICIZE',cardPower(combatPowers.exports.Metallicize,[3,4])),
  }};
}});
