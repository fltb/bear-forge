import {typedValue} from '../../rules/value.schemas.ts';
import {describeProgram} from '../../rules/program-descriptions.ts';
import {replaceProgram,modifyProgram} from './reaction-programs.ts';
import {PS,MS} from '../../combat-identifiers.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {powers} from '../../rules/powers.ts';
import {attributes} from '../../rules/attributes.ts';
import {resources,HpLossOrigin} from '../../rules/resources.ts';
import {turns} from '../../rules/turns.ts';
import {playerRoundExpiry,enemyActionExpiry} from './turn-hooks.ts';
import {damage} from '../../rules/damage.ts';
import type {HitRequest,HpDamageRequest} from '../../rules/damage.types.ts';
import type {HpLoss} from '../../rules/resources.types.ts';
import type {attackValueSchema} from '../../rules/attributes.schemas.ts';
import {defineDescribedPower,powerAbilities,counterPolicies} from './utils.ts';
const {defineRules,defineQuery,defineEffect,sequence,call}=rules;
type Attack=z.infer<typeof attackValueSchema>;
export const defensePowers=defineRules({requires:[powers,attributes,resources,damage,turns],build(){
  const intangibleAmount=1,bufferConsumption=1,bufferDamage=0;
  function incomingHit(nonAttackOnly:boolean){
    return describeProgram(defineQuery({input:typedValue<rules.ReplacementContext<HitRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>(!nonAttackOnly||!c.value.attack)&&c.value.target===c.owner&&c.value.amount>0&&r.query(powers.exports.enabled,c.source)}),`状态生效且持有者受到正数${nonAttackOnly?'非攻击':''}伤害`);
  }
  function setHitAmount(amount:number){
    return describeProgram(defineEffect<rules.ReplacementContext<HitRequest>,rules.ReplacementResult<HitRequest>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount}))})),`将伤害量设为${amount}。`);
  }
  const cap=replaceProgram(damage.exports.beforeDamage,{condition:incomingHit(false),effect:setHitAmount(intangibleAmount)});
  const capPlayerDamage=replaceProgram(damage.exports.beforeDamage,{condition:incomingHit(true),effect:setHitAmount(intangibleAmount)});
  const direct=describeProgram(defineQuery({input:typedValue<rules.ReplacementContext<HpLoss>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.entity===c.owner&&(c.value.origin??HpLossOrigin.Direct)===HpLossOrigin.Direct&&r.query(powers.exports.enabled,c.source)}),'状态生效且持有者受到直接生命损失（来源未指定也按直接处理，包括原本为0的损失）');
  const directAmount=describeProgram(defineEffect<rules.ReplacementContext<HpLoss>,rules.ReplacementResult<HpLoss>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:intangibleAmount}))})),`将生命损失量设为${intangibleAmount}。`);
  const capDirect=replaceProgram(resources.exports.beforeHpLoss,{condition:direct,order:{phase:resources.exports.stages.transform,priority:-100},effect:directAmount});
  const target=describeProgram(defineQuery({input:typedValue<rules.ModifierContext<Attack,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.target===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且持有者为攻击目标');
  const limitIncoming=modifyProgram(attributes.exports.enemyAttack,{condition:target,order:attributes.exports.stages.limit,transform:describeProgram((_r:rules.QueryRead,c:rules.ModifierContext<Attack,number>)=>Math.min(c.value,intangibleAmount),`将攻击数值限制为最多${intangibleAmount}。`)});
  // This max is the pinned source behavior; it is not silently corrected to min.
  const limitEnemy=modifyProgram(attributes.exports.playerAttack,{condition:target,order:attributes.exports.stages.limit,transform:describeProgram((_r:rules.QueryRead,c:rules.ModifierContext<Attack,number>)=>Math.max(c.value,intangibleAmount),`将攻击数值限制为至少${intangibleAmount}而非上限。`)});
  const PlayerIntangible=defineDescribedPower('无实体',{presentation:{key:PS.INTANGIBLE,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,markOnBuff:true,zeroIsNoop:true})},powerAbilities(capPlayerDamage,capDirect,limitIncoming),playerRoundExpiry(60,false));
  const EnemyIntangible=defineDescribedPower('无实体',{presentation:{key:MS.INTANGIBLE,flag:false,slot:0},...counterPolicies({bits:32,clearOnRemove:true})},powerAbilities(cap,limitEnemy),enemyActionExpiry(30,false));
  const bufferOwns=describeProgram(defineQuery({input:typedValue<rules.ReplacementContext<HpDamageRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.value.request.target===c.owner&&c.value.request.amount>0&&r.query(powers.exports.enabled,c.source)}),'状态生效且持有者受到的伤害请求量为正');
  const consumeBuffer=describeProgram(defineEffect<rules.ReplacementContext<HpDamageRequest>,rules.ReplacementResult<HpDamageRequest>>(b=>sequence(
    call(powers.exports.decrement,{entity:b.read(v=>v.input.source),amount:bufferConsumption}),b.return({kind:'change',value:b.read(v=>({...v.input.value,request:{...v.input.value.request,amount:bufferDamage}}))}),
  )),`消耗${bufferConsumption}层，并将伤害请求量设为${bufferDamage}。`);
  const prevent=replaceProgram(damage.exports.beforeHpDamage,{condition:bufferOwns,order:damage.exports.stages.prevention,effect:consumeBuffer});
  const Buffer=defineDescribedPower('缓冲',{presentation:{key:PS.BUFFER,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true})},powerAbilities(prevent));
  return{exports:{PlayerIntangible:PlayerIntangible.definition,EnemyIntangible:EnemyIntangible.definition,Buffer:Buffer.definition,programs:{PlayerIntangible,EnemyIntangible,Buffer},statusTexts:{INTANGIBLE:PlayerIntangible.text+EnemyIntangible.text,BUFFER:Buffer.text}}};
}});
