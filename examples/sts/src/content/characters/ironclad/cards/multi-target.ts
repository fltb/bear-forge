import {attackProgram,inheritPrograms} from '../../../cards/shared/program-facts.ts';
import {cardAmount,describeAmounts} from '../../../cards/shared/programs.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {rules} from '../../../../rules/execution.ts';
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
export const groupCards=defineRules({requires:[cardTargets,cardEffects,battles,random,combatPowers],build(){
  const boomerangAmount=3,boomerangCount=[3,4] as const,reapAmount=[4,5] as const;
  const boomerangHit=defineEffect<CardUse,void>(b=>{const targets=b.local<readonly number[]>(),index=b.local<number>();return sequence(
    b.assign(targets,query(battles.exports.targets,b.read(v=>v.input.battle))),when(b.read(v=>v.get(targets).length===0),b.return(undefined)),
    b.assign(index,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.get(targets).length-1)})),
    enqueue(battles.exports.hit,b.read(v=>{const target=v.get(targets)[v.get(index)]!;return{battle:v.input.battle,source:v.input.owner,target,amount:v.query(attributes.exports.attackAmount,{source:v.input.owner,target,base:boomerangAmount,card:v.input.card}),attack:true,selfDamage:false};}),
      {queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),
  );});
  const boomerang=defineEffect<CardUse,void>(b=>forEach(b.read(v=>Array.from({length:cardAmount(boomerangCount,v)},(_,i)=>i)),()=>enqueue(boomerangHit,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})));
  const reap=defineEffect<CardUse,void>(b=>{const total=b.local<number>(),hit=b.local<HitResult>();return sequence(b.assign(total,0),
    forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>sequence(
      b.assign(hit,call(damage.exports.attack,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target,base:b.read(v=>cardAmount(reapAmount,v)),card:b.read(v=>v.input.card)})),b.assign(total,b.read(v=>v.get(total)+v.get(hit).lost)),
    )),when(b.read(v=>v.get(total)>0),enqueue(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:total},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'})),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
  );});
  const reaper=defineEffect<CardUse,void>(b=>enqueue(reap,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  return{exports:{
    SwordBoomerang:concreteCard('SWORD_BOOMERANG',describeAmounts(attackProgram(boomerang,boomerangAmount),[boomerangAmount,boomerangCount],(damage,hits)=>`每次随机选择敌人造成${damage}伤害，重复${hits}次。`)),Reaper:concreteCard('REAPER',describeAmounts(inheritPrograms(reaper,attackProgram(reap,reapAmount)),[reapAmount],damage=>`对全体敌人造成${damage}伤害，按实际造成的生命损失总和回复生命。`)),
    FlameBarrier:concreteCard('FLAME_BARRIER',composePrograms(cardBlock([12,16]),cardPower(combatPowers.exports.programs.FlameBarrier,[4,6]))),
    Metallicize:concreteCard('METALLICIZE',cardPower(combatPowers.exports.programs.Metallicize,[3,4])),
  }};
}});
