import { typedValue } from '../../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {relics} from "../../../../rules/relics.ts";
import {adventures} from "../../../../rules/adventures.ts";
import {battles} from "../../../../rules/battles.ts";
import {resources} from "../../../../rules/resources.ts";
import {registerRelicAbilities} from "../../../relics/hooks.ts";
const {defineRules,defineEntity,defineQuery,defineEffect,on,call}=rules;
export const startingRelics=defineRules({requires:[relics,battles,adventures],build(){
  function victoryHeal(amount:number){return{
    ability:on(adventures.exports.combatFinished,{condition:defineQuery({input:typedValue<rules.ReactionContext<{battle:number;actor:number;outcome:1|2}>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner&&c.event.outcome===1}),order:adventures.exports.combatStages.settlement,effect:defineEffect<rules.ReactionContext<{battle:number;actor:number;outcome:1|2}>,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount}))}),
    text:`战斗胜利结算时，回复${amount}生命（受治疗修正影响）。`,
  };}
  const blood=victoryHeal(6);
  return{exports:{BurningBlood:defineEntity(relics.exports.kind,{id:'BURNING_BLOOD' as const,install:registerRelicAbilities(blood.ability)}),texts:Object.freeze({BURNING_BLOOD:blood.text})}};
}});
