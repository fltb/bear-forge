import {rules} from '../../../../rules/execution.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {random} from '../../../../rules/random.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {lightning} from '../mechanics/lightning.ts';
import {volibearDamageTraining} from '../mechanics/damage-training.ts';
import {cardAmount,describeAmounts,type CardAmount} from '../../../cards/shared/programs.ts';
import {describeProgram,inheritPrograms,inheritDamageTerms,damageTermsSchema,withDamageTerms,thunderProgram} from '../../../cards/shared/program-facts.ts';
import {attack,queued,compose} from './programs.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';

/** Native lightning belongs to the card, so training applies once per segment. */
export function nativeThunder(base:CardAmount,all=false,drain=false):rules.Effect<CardUse,void>{
  const effect=queued(rules.defineEffect<CardUse,void>(b=>{
    const before=b.local<number>(),target=b.local<number|null>();
    return rules.sequence(
      b.assign(target,b.read(v=>all?null:v.input.target)),
      b.assign(before,b.read(v=>v.get(target)===null?0:v.query(resources.exports.vitality,v.get(target)!).hp)),
      rules.call(lightning.exports.resolve,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),exclude:null,target:b.read(v=>v.get(target)??undefined),base:b.read(v=>Math.max(0,cardAmount(base,v)+v.query(volibearDamageTraining.exports.permanentBonus,v.input.card)))}),
      ...(drain?[rules.call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.get(target)===null?0:Math.max(0,v.get(before)-v.query(resources.exports.vitality,v.get(target)!).hp))})]:[]),
      rules.call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
    );
  }));
  if(typeof base!=='function')withDamageTerms(effect,rules.defineQuery({input:cardUseSchema,output:damageTermsSchema,dependencies:[lightning.exports.amount,volibearDamageTraining.exports.permanentBonus],base:(r,use)=>[{label:'原生雷伤',target:all?null:use.target,amount:r.query(lightning.exports.amount,{battle:use.battle,owner:use.owner,base:Math.max(0,(typeof base==='number'?base:base[use.state.upgraded?1:0])+r.query(volibearDamageTraining.exports.permanentBonus,use.card)),exclude:null}),hits:1}]}));
  return thunderProgram(describeAmounts(effect,[base],n=>`对${all?'全体敌人':'目标'}造成${n}雷伤。${drain?'按该段实际生命损失恢复生命。':''}`));
}
export function gainEnergy(amount:CardAmount){return describeAmounts(queued(rules.defineEffect<CardUse,void>(b=>rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.max(0,cardAmount(amount,v)))}))),[amount],n=>`获得${n}能量。`);}
export function randomStorm(physical:CardAmount,electric:CardAmount,times:number){
  const wave=compose(attack(physical),nativeThunder(electric));
  const effect=rules.defineEffect<CardUse,void>(b=>{const at=b.local<number>(),use=b.local<CardUse>();return rules.forEach(Array.from({length:times},(_,i)=>i),()=>rules.sequence(
    rules.when(b.read(v=>v.query(battles.exports.targets,v.input.battle).length===0||v.query(battles.exports.status,v.input.battle).outcome!==0),b.return(undefined)),
    b.assign(at,rules.call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.query(battles.exports.targets,v.input.battle).length-1)})),
    b.assign(use,b.read(v=>({...v.input,target:v.query(battles.exports.targets,v.input.battle)[v.get(at)]!}))),
    ruleModules.runTaskGroup(actionQueue,wave,use),
  ));});
  inheritPrograms(effect,wave);
  // Random destinations are unresolved. Do not present a single wave as this
  // card's total or assign its damage to the player's current target.
  inheritDamageTerms(effect);
  return queued(describeAmounts(effect,[physical,electric],(a,t)=>`随机选择存活敌人，重复${times}次：造成${a}攻击伤害和${t}雷伤。`));
}
