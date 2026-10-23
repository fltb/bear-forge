import {describeProgram,inheritPrograms} from '../../../cards/shared/program-facts.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {pileCards} from "../../../cards/statuses/definitions.ts";
import {rules} from '../../../../rules/execution.ts';
import {battles} from "../../../../rules/battles.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {resources} from "../../../../rules/resources.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {powers} from "../../../../rules/powers.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {defensePowers} from "../../../powers/defense.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {concreteCard,composePrograms,cardBlock,cardDraw,cardPower,cardAmount,cardEnergy,describeAmounts,type DescribedPower,type CardAmount} from "../../../cards/shared/programs.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {PowerDefinition} from "../../../../rules/powers.types.ts";
const {defineRules,defineEffect,sequence,forEach,when,whileDo,call,query,enqueue}=rules;
export const skillCards=defineRules({requires:[cardTargets,cardEffects,battles,basicPowers,defensePowers,pileCards],build(){
  const queue=(effect:rules.Effect<CardUse,void>,retained=false)=>inheritPrograms(defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>{const s=v.query(battles.exports.status,v.input.battle);return retained?s.scope:s.actionScope;}),eligible:'captured'})),effect);
  const energy=cardEnergy;
  const hpLoss=(amount:number)=>describeProgram(queue(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount,selfDamage:true}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),true),`失去${amount}生命。`);
  const woundCopies=2;
  const wounds=describeProgram(defineEffect<CardUse,void>(b=>forEach(Array.from({length:woundCopies},(_,i)=>i),()=>enqueue(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),definition:pileCards.exports.Wound,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))),`将${woundCopies}张伤口加入手牌。`);
  function allPower(power:DescribedPower,amount:CardAmount){const definition=power.definition;return describeAmounts(defineEffect<CardUse,void>(b=>forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>enqueue(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:target,definition,amount:b.read(v=>cardAmount(amount,v)),source:b.read(v=>v.input.owner),debuff:true,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))),[amount],value=>`对全体敌人施加${value}层${power.name}（可被人工制品抵消）。${power.text}`);}
  const entrench=describeProgram(queue(defineEffect<CardUse,void>(b=>call(cardEffects.exports.gainBlock,{use:b.input,amount:b.read(v=>v.query(resources.exports.defense,v.input.owner).block)}))),`获得等同当前格挡的格挡。`);
  const limitBreak=describeProgram(queue(defineEffect<CardUse,void>(b=>call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:query(attributes.exports.strength,b.read(v=>v.input.owner)),source:b.read(v=>v.input.owner),debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)}))),`获得等同当前力量的力量。`);
  return{exports:{Bloodletting:concreteCard('BLOODLETTING',composePrograms(hpLoss(3),energy([2,3]))),
    Disarm:concreteCard('DISARM',cardPower(basicPowers.exports.programs.Strength,[-2,-3],true,true)),
    Entrench:concreteCard('ENTRENCH',entrench),
    GhostlyArmor:concreteCard('GHOSTLY_ARMOR',cardBlock([10,13])),
    Impervious:concreteCard('IMPERVIOUS',cardBlock([30,40])),
    Intimidate:concreteCard('INTIMIDATE',allPower(basicPowers.exports.programs.EnemyWeak,[1,2])),
    LimitBreak:concreteCard('LIMIT_BREAK',limitBreak),
    Offering:concreteCard('OFFERING',composePrograms(hpLoss(6),energy(2),cardDraw([3,5]))),
    PowerThrough:concreteCard('POWER_THROUGH',composePrograms(wounds,cardBlock([15,20]))),
    Shockwave:concreteCard('SHOCKWAVE',composePrograms(allPower(basicPowers.exports.programs.EnemyWeak,[3,5]),allPower(basicPowers.exports.programs.EnemyVulnerable,[3,5])))}};
}});
