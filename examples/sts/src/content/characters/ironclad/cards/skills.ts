import {pileCards} from "../../../cards/statuses/definitions.ts";
import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../../rules/battles.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {resources} from "../../../../rules/resources.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {powers} from "../../../../rules/powers.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {defensePowers} from "../../../powers/defense.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {concreteCard,composePrograms,cardBlock,cardDraw,cardPower,cardAmount,type CardAmount} from "../../../cards/shared/programs.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {PowerDefinition} from "../../../../rules/powers.types.ts";
const {defineRules,defineEffect,sequence,forEach,when,whileDo,call,query,enqueue}=rules;
export const skillCards=defineRules({requires:[battles,basicPowers,defensePowers,pileCards],build(){
  const queue=(effect:rules.Effect<CardUse,void>,retained=false)=>defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>{const s=v.get(query(battles.exports.current,v.input.battle));return retained?s.scope:s.actionScope;}),eligible:'captured'}));
  const energy=(amount:CardAmount)=>defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));
  const hpLoss=(amount:number)=>queue(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount,selfDamage:true}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),true);
  const wounds=defineEffect<CardUse,void>(b=>forEach([0,1],()=>enqueue(cardPiles.exports.create,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),definition:pileCards.exports.Wound,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'})));
  function allPower(definition:PowerDefinition,amount:CardAmount){return defineEffect<CardUse,void>(b=>forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>enqueue(powers.exports.apply,{registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:target,definition,amount:b.read(v=>cardAmount(amount,v)),source:b.read(v=>v.input.owner),debuff:true,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'})));}
  const entrench=queue(defineEffect<CardUse,void>(b=>call(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.get(query(resources.exports.current,v.input.owner)).block)})));
  const limitBreak=queue(defineEffect<CardUse,void>(b=>call(powers.exports.apply,{registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:query(attributes.exports.strength,b.read(v=>v.input.owner)),source:b.read(v=>v.input.owner),debuff:false,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)})));
  return{exports:{Bloodletting:concreteCard('BLOODLETTING',composePrograms(hpLoss(3),energy([2,3]))),
    Disarm:concreteCard('DISARM',cardPower(basicPowers.exports.Strength,-2,true,true)),
    Entrench:concreteCard('ENTRENCH',entrench),
    GhostlyArmor:concreteCard('GHOSTLY_ARMOR',cardBlock([10,13])),
    Impervious:concreteCard('IMPERVIOUS',cardBlock([30,40])),
    Intimidate:concreteCard('INTIMIDATE',allPower(basicPowers.exports.EnemyWeak,[1,2])),
    LimitBreak:concreteCard('LIMIT_BREAK',limitBreak),
    Offering:concreteCard('OFFERING',composePrograms(hpLoss(6),energy(2),cardDraw([3,5]))),
    PowerThrough:concreteCard('POWER_THROUGH',composePrograms(wounds,cardBlock([15,20]))),
    Shockwave:concreteCard('SHOCKWAVE',composePrograms(allPower(basicPowers.exports.EnemyWeak,[3,5]),allPower(basicPowers.exports.EnemyVulnerable,[3,5])))}};
}});
