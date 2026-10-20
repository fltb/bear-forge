import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';

/** Read-only observations of content-owned continuation data; never used to execute rules. */
export const CombatPrivateSchema=z.strictObject({
  happyFlowerCounter:z.int32(),incenseBurnerCounter:z.int32(),inkBottleCounter:z.int32(),
  inserterCounter:z.int32(),nunchakuCounter:z.int32(),penNibCounter:z.int32(),sundialCounter:z.int32(),
  haveUsedNecronomiconThisTurn:z.boolean(),orangePelletsCardTypesPlayed:z.int32(),
  combustHpLoss:z.int32(),devaFormEnergyPerTurn:z.int32(),echoFormCardsDoubled:z.int32(),panacheCounter:z.int32(),
  bombs:z.tuple([z.int32(),z.int32(),z.int32()]),
});
export type CombatPrivate=z.infer<typeof CombatPrivateSchema>;
export const combatPrivate=rules.defineRules({requires:[],build(){
  return{exports:{player:rules.defineQuery({input:z.number(),output:CombatPrivateSchema,base:()=>({
    happyFlowerCounter:0,incenseBurnerCounter:0,inkBottleCounter:0,inserterCounter:0,nunchakuCounter:0,penNibCounter:0,sundialCounter:0,
    haveUsedNecronomiconThisTurn:false,orangePelletsCardTypesPlayed:0,combustHpLoss:0,devaFormEnergyPerTurn:0,echoFormCardsDoubled:0,panacheCounter:0,bombs:[0,0,0] as [number,number,number],
  })})}};
}});
export function observeCounter<K extends keyof CombatPrivate>(key:K,component:rules.Component<CombatPrivate[K]>){
  return rules.modify(combatPrivate.exports.player,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,CombatPrivate>>(),output:z.boolean(),base:(_r,c)=>c.input===c.owner}),
    reads:[component],transform:(r,c)=>({...c.value,[key]:r.component(c.source,component)}),
  });
}
