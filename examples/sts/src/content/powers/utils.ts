import { typedValue } from '../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {resources} from "../../rules/resources.ts";
import {powers} from "../../rules/powers.ts";
import {EffectKind} from '../../rules/effect-policy.ts';
import {powerChangeSchema,powerMutableSchema,powerMergeSchema,powerReductionSchema,powerStateSchema,polaritySchema} from "../../rules/powers.schemas.ts";
import type {PowerConfig,PowerLifecycle} from "../../rules/powers.types.ts";
const {defineQuery,defineEffect,install}=rules;
export type CounterOptions={bits:8|16|32;scalar?:boolean;flag?:boolean;resetWhenInactive?:boolean;reactivateOnReduction?:boolean;harmful?:boolean;markOnBuff?:boolean;markOnEnemyDebuff?:boolean;enemyDebuffOnlyWhenNew?:boolean;zeroIsNoop?:boolean;clearOnRemove?:boolean};

/** Static utility for ordinary numeric counters; custom powers may supply their own typed queries. */
export function counterPolicies(options:CounterOptions):Pick<PowerConfig,'admit'|'initial'|'merge'|'reduce'|'remove'|'polarity'>{
  options=Object.freeze({...options});
  const narrow=(n:number)=>options.bits===8?(n<<24)>>24:options.bits===16?(n<<16)>>16:n|0;
  const marked=(r:rules.QueryRead,change:z.infer<typeof powerChangeSchema>,already:boolean)=>
    change.skipFirstDecay??(!change.debuff&&options.markOnBuff||change.debuff&&options.markOnEnemyDebuff&&(!options.enemyDebuffOnlyWhenNew||!already)&&change.source!==null&&r.query(resources.exports.side,change.source)===1);
  return{
    admit:defineQuery({input:z.object({actor:z.number(),change:powerChangeSchema}),output:z.boolean(),dependencies:[resources.exports.side],base:(r,input)=>!options.zeroIsNoop||input.change.amount!==0||input.change.debuff&&r.query(resources.exports.side,input.actor)===1}),
    initial:defineQuery({input:powerChangeSchema,output:powerMutableSchema,dependencies:[resources.exports.side],base:(r,change)=>{
      const level=options.flag?1:narrow(change.amount);return{level,active:options.scalar?level!==0:true,justApplied:!!marked(r,change,false)};
    }}),
    merge:defineQuery({input:powerMergeSchema,output:powerMutableSchema,dependencies:[resources.exports.side],base:(r,{state,change})=>{
      const level=options.flag?1:narrow((options.resetWhenInactive&&!state.active?0:state.level)+change.amount);
      return{level,active:options.scalar?level!==0:true,justApplied:state.justApplied||!!marked(r,change,state.active)};
    }}),
    reduce:defineQuery({input:powerReductionSchema,output:powerMutableSchema,base:(_r,{state,amount})=>{
      if(options.flag)return{level:state.level,active:false,justApplied:state.justApplied};
      const level=narrow(state.level-amount);return{level,active:options.scalar||options.reactivateOnReduction?level!==0:state.active&&level!==0,justApplied:state.justApplied};
    }}),
    remove:defineQuery({input:powerStateSchema,output:powerMutableSchema,base:(_r,state)=>({level:options.clearOnRemove&&state.active?0:state.level,active:options.scalar?state.active:false,justApplied:state.justApplied})}),
    polarity:defineQuery({input:powerStateSchema,output:polaritySchema,base:(_r,state)=>options.harmful?-1:options.scalar&&state.level<0?-1:1}),
  };
}
export type PowerAbility={ability:rules.Ability;effect:EffectKind|null};
/** null marks lifecycle bookkeeping which continues while contributions pause. */
export function effectAbility(ability:rules.Ability,effect:EffectKind|null):PowerAbility{return{ability,effect};}
export function attachAbilities(...abilities:(rules.Ability|PowerAbility)[]):rules.Effect<PowerLifecycle,void>{
  const guarded=abilities.map(item=>{
    const spec='ability' in item?item:{ability:item,effect:EffectKind.Special};
    if(spec.effect===null)return spec.ability;
    const effect=spec.effect;
    const enabled=defineQuery({input:typedValue<{source:number;owner:number;environment:{}}>(),output:z.boolean(),dependencies:[powers.exports.contributes],base:(r,c)=>r.query(powers.exports.contributes,{entity:c.source,effect})});
    return rules.guardAbility(spec.ability,enabled);
  });
  return defineEffect(b=>rules.sequence(...guarded.map(ability=>install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)}))));
}
export function scalarBonus(target:rules.Query<number,number>):rules.Ability{
  const condition=defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.owner});
  return rules.modify(target,{condition,dependencies:[powers.exports.level],transform:(r,c)=>(c.value+r.query(powers.exports.level,c.source))|0});
}
