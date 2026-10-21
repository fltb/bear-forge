import { typedValue } from '../../rules/value.schemas.ts';
import {PS,MS} from "../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {powers} from "../../rules/powers.ts";
import {attributes} from "../../rules/attributes.ts";
import {resources,HpLossOrigin} from "../../rules/resources.ts";
import {turns} from "../../rules/turns.ts";
import {expireCounter} from "./turn-hooks.ts";
import {damage} from "../../rules/damage.ts";
import type {HitRequest,HpDamageRequest} from "../../rules/damage.types.ts";
import type {HpLoss} from "../../rules/resources.types.ts";
import type {attackValueSchema} from "../../rules/attributes.schemas.ts";
import {attachAbilities,counterPolicies} from "./utils.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,replace,modify,sequence,call}=rules;
type Attack=z.infer<typeof attackValueSchema>;
export const defensePowers=defineRules({requires:[powers,attributes,resources,damage,turns],build(){
  const beforeBlock=defineQuery({input:typedValue<rules.ReplacementContext<HitRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.target===c.owner&&c.value.amount>0&&r.query(powers.exports.enabled,c.source)});
  const cap=replace(damage.exports.beforeDamage,{condition:beforeBlock,effect:defineEffect<rules.ReplacementContext<HitRequest>,rules.ReplacementResult<HitRequest>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:1}))}))});
  const beforePlayerBlock=defineQuery({input:typedValue<rules.ReplacementContext<HitRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>!c.value.attack&&c.value.target===c.owner&&c.value.amount>0&&r.query(powers.exports.enabled,c.source)});
  const capPlayerDamage=replace(damage.exports.beforeDamage,{condition:beforePlayerBlock,effect:defineEffect<rules.ReplacementContext<HitRequest>,rules.ReplacementResult<HitRequest>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:1}))}))});
  const direct=defineQuery({input:typedValue<rules.ReplacementContext<HpLoss>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.entity===c.owner&&(c.value.origin??HpLossOrigin.Direct)===HpLossOrigin.Direct&&r.query(powers.exports.enabled,c.source)});
  const capDirect=replace(resources.exports.beforeHpLoss,{condition:direct,order:{phase:resources.exports.stages.transform,priority:-100},effect:defineEffect<rules.ReplacementContext<HpLoss>,rules.ReplacementResult<HpLoss>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:1}))}))});
  const target=defineQuery({input:typedValue<rules.ModifierContext<Attack,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.target===c.owner&&r.query(powers.exports.enabled,c.source)});
  const limitIncoming=modify(attributes.exports.enemyAttack,{condition:target,order:attributes.exports.stages.limit,transform:(_r,c)=>Math.min(c.value,1)});
  // This max is the pinned source behavior; it is not silently corrected to min.
  const limitEnemy=modify(attributes.exports.playerAttack,{condition:target,order:attributes.exports.stages.limit,transform:(_r,c)=>Math.max(c.value,1)});
  const PlayerIntangible=defineEntity(powers.exports.kind,{presentation:{key:PS.INTANGIBLE,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,markOnBuff:true,zeroIsNoop:true}),attach:attachAbilities(capPlayerDamage,capDirect,limitIncoming,expireCounter(turns.exports.playerRoundEnd,60,false))});
  const EnemyIntangible=defineEntity(powers.exports.kind,{presentation:{key:MS.INTANGIBLE,flag:false,slot:0},...counterPolicies({bits:32,clearOnRemove:true}),attach:attachAbilities(cap,limitEnemy,expireCounter(turns.exports.enemyEnd,30,false))});
  const bufferOwns=defineQuery({input:typedValue<rules.ReplacementContext<HpDamageRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.request.target===c.owner&&c.value.request.amount>0&&r.query(powers.exports.enabled,c.source)});
  const prevent=replace(damage.exports.beforeHpDamage,{condition:bufferOwns,order:damage.exports.stages.prevention,effect:defineEffect<rules.ReplacementContext<HpDamageRequest>,rules.ReplacementResult<HpDamageRequest>>(b=>sequence(
    call(powers.exports.decrement,{entity:b.read(v=>v.input.source),amount:1}),b.return({kind:'change',value:b.read(v=>({...v.input.value,request:{...v.input.value.request,amount:0}}))}),
  ))});
  const Buffer=defineEntity(powers.exports.kind,{presentation:{key:PS.BUFFER,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:attachAbilities(prevent)});
  return{exports:{PlayerIntangible,EnemyIntangible,Buffer}};
}});
