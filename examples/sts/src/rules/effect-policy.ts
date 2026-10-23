import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {effectTrace} from './effect-trace.ts';
import {entityId} from './resources.schemas.ts';

/** Semantic capabilities, declared by effect authors rather than entity names. */
export const EffectKind={Attack:0,Block:1,Strength:2,Special:3,BattleFact:4} as const;
export type EffectKind=typeof EffectKind[keyof typeof EffectKind];
export type EffectQualification={actor:number;effect:EffectKind;polarity:-1|0|1};
export const effectKindSchema=z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3),z.literal(4)]);
export const effectPolicy=rules.defineRules({requires:[effectTrace],build(){
  const allowed=rules.defineQuery({input:z.object({actor:entityId,effect:effectKindSchema,polarity:z.union([z.literal(-1),z.literal(0),z.literal(1)])}),output:z.boolean(),base:()=>true});
  const permitted=rules.defineQuery({input:z.object({effect:effectKindSchema,polarity:z.union([z.literal(-1),z.literal(0),z.literal(1)])}),output:z.boolean(),dependencies:[allowed,effectTrace.exports.current],base:(r,i)=>{
    const origin=r.query(effectTrace.exports.current,undefined).at(-1);
    return origin?.owner==null||r.query(allowed,{actor:origin.owner,...i});
  }});
  return {exports:{allowed,permitted}};
}});
