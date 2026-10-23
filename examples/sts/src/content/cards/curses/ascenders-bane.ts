import {concreteCard} from '../shared/programs.ts';
import {programMetadata,describeProgram} from '../shared/program-facts.ts';
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
  const fixed=describeProgram(rules.defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>false}),'不可变形。');
  const noop=describeProgram(defineEffect<CardUse,void>(b=>b.return(undefined)),'');
  return{exports:{AscendersBane:concreteCard('ASCENDERS_BANE',noop,{canTransform:fixed})}};
}});
