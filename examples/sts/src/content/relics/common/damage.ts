import { typedValue } from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {damage} from '../../../rules/damage.ts';
import {relics} from '../../../rules/relics.ts';
import type {HpDamageRequest} from '../../../rules/damage.types.ts';
import {registerRelicAbilities} from '../hooks.ts';
const {defineRules,defineQuery,defineEffect,defineEntity,replace}=rules;

// These constructors build the real checkpoint programs. Their text is a read-only
// projection of that composition, not an alternative evaluator of damage rules.
export const damageRelics=defineRules({requires:[damage,relics],build(){
  function incomingAttackAtMost(maximum:number){return{
    condition:defineQuery({input:typedValue<rules.ReplacementContext<HpDamageRequest>>(),output:z.boolean(),base:(_r,c)=>c.value.request.attack&&c.value.request.target===c.owner&&c.value.request.amount>0&&c.value.request.amount<=maximum}),
    text:`自身受到的未被格挡的攻击伤害大于0且不超过${maximum}时`,
  };}
  function outgoingAttackBelow(maximum:number){return{
    condition:defineQuery({input:typedValue<rules.ReplacementContext<HpDamageRequest>>(),output:z.boolean(),base:(_r,c)=>c.value.request.attack&&c.value.request.source===c.owner&&c.value.request.amount>0&&c.value.request.amount<maximum}),
    text:`自身造成的未被格挡的攻击伤害大于0且小于${maximum}时`,
  };}
  function replaceAmount(trigger:{condition:rules.Query<rules.ReplacementContext<HpDamageRequest>,boolean>;text:string},amount:number,phase:rules.RulePhase){return{
    ability:replace(damage.exports.beforeHpDamage,{condition:trigger.condition,order:phase,
      effect:defineEffect<rules.ReplacementContext<HpDamageRequest>,rules.ReplacementResult<HpDamageRequest>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,request:{...v.input.value.request,amount}}))})),
    }),
    text:`${trigger.text}，改为${amount}。`,
  };}
  const torii=replaceAmount(incomingAttackAtMost(5),1,damage.exports.stages.reduction);
  const boot=replaceAmount(outgoingAttackBelow(5),5,damage.exports.stages.minimum);
  const Torii=defineEntity(relics.exports.kind,{id:'TORII' as const,install:registerRelicAbilities(torii.ability)});
  const TheBoot=defineEntity(relics.exports.kind,{id:'THE_BOOT' as const,install:registerRelicAbilities(boot.ability)});
  return{exports:{Torii,TheBoot,texts:Object.freeze({TORII:torii.text,THE_BOOT:boot.text})}};
}});
