import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {damage} from "../../../rules/damage.ts";
import {relics} from "../../../rules/relics.ts";
import type {HpDamageRequest} from "../../../rules/damage.types.ts";
import {registerRelicAbilities} from "../hooks.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,replace}=rules;
export const damageRelics=defineRules({requires:[damage,relics],build(){
  const toriiCondition=defineQuery({input:z.custom<rules.ReplacementContext<HpDamageRequest>>(),output:z.boolean(),base:(_r,c)=>c.value.request.attack&&c.value.request.target===c.owner&&c.value.request.amount>0&&c.value.request.amount<=5});
  const bootCondition=defineQuery({input:z.custom<rules.ReplacementContext<HpDamageRequest>>(),output:z.boolean(),base:(_r,c)=>c.value.request.attack&&c.value.request.source===c.owner&&c.value.request.amount>0&&c.value.request.amount<5});
  function replaceAmount(condition:rules.Query<rules.ReplacementContext<HpDamageRequest>,boolean>,amount:number,phase:rules.RulePhase){return replace(damage.exports.beforeHpDamage,{condition,order:phase,
    effect:defineEffect<rules.ReplacementContext<HpDamageRequest>,rules.ReplacementResult<HpDamageRequest>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,request:{...v.input.value.request,amount}}))})),
  });}
  const Torii=defineEntity(relics.exports.kind,{id:'TORII' as const,install:registerRelicAbilities(replaceAmount(toriiCondition,1,damage.exports.stages.reduction))});
  const TheBoot=defineEntity(relics.exports.kind,{id:'THE_BOOT' as const,install:registerRelicAbilities(replaceAmount(bootCondition,5,damage.exports.stages.minimum))});
  return{exports:{Torii,TheBoot}};
}});
