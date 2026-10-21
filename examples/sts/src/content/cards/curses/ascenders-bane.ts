import {rules} from '../../../rules/execution.ts';
import {z} from 'zod';
import {cardEvaluationSchema} from "../../../rules/card-instances.schemas.ts";
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {cards} from "../../../cards.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import {standardUpgrade,upgradeOnce} from "../shared/lifecycle.ts";
const {defineRules,defineEffect,defineEntity,sequence,query,enqueue}=rules;

/** Concrete programs share typed authoring utilities, never a name-based action dispatcher. */
export const curseBasicCards=defineRules({requires:[battles,basicPowers],build(){
  const card=(id:keyof typeof cards,use:rules.Effect<CardUse,void>)=>defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use,...(id==='ASCENDERS_BANE'?{canTransform:rules.defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>false})}:{}),canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id])});
  return{exports:{AscendersBane:card('ASCENDERS_BANE',defineEffect<CardUse,void>(b=>b.return(undefined)))}};
}});
