import {describeProgram} from '../../rules/program-descriptions.ts';
import {modifyProgram,replaceProgram} from './reaction-programs.ts';
import {EffectKind} from '../../rules/effect-policy.ts';
import { typedValue } from '../../rules/value.schemas.ts';
import {PS,MS} from "../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {powers} from "../../rules/powers.ts";
import {attributes,weakScaleText,vulnerableScaleText} from "../../rules/attributes.ts";
import {resources} from "../../rules/resources.ts";
import {turns} from "../../rules/turns.ts";
import {playerRoundExpiry,enemyRoundExpiry} from "./turn-hooks.ts";
import {attackValueSchema,blockValueSchema} from "../../rules/attributes.schemas.ts";
import type {PowerApplication} from "../../rules/powers.types.ts";
import {counterPolicies,defineDescribedPower,powerAbilities,scalarBonus,effectAbility} from "./utils.ts";
const {defineRules,defineQuery,defineEffect,sequence,call}=rules;
type Attack=z.infer<typeof attackValueSchema>;
type Block=z.infer<typeof blockValueSchema>;
export const basicPowers=defineRules({requires:[powers,attributes,resources,turns],build(){
  const sourceOwns=describeProgram(defineQuery({input:typedValue<rules.ModifierContext<Attack,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.source===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且持有者为攻击来源');
  const targetOwns=describeProgram(defineQuery({input:typedValue<rules.ModifierContext<Attack,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.target===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且持有者为攻击目标');
  const blockOwns=describeProgram(defineQuery({input:typedValue<rules.ModifierContext<Block,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.actor===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且持有者为卡牌格挡获得者');
  const strengthBonus=modifyProgram(attributes.exports.playerAttack,{condition:sourceOwns,order:{phase:attributes.exports.stages.addition,priority:100},dependencies:[powers.exports.level],transform:describeProgram((r:rules.QueryRead,c:rules.ModifierContext<Attack,number>)=>Math.fround(c.value+Math.fround(r.query(powers.exports.level,c.source))),'加上当前层数，以单精度浮点数结算。')});
  const dexterityBonus=modifyProgram(attributes.exports.block,{condition:blockOwns,order:attributes.exports.stages.addition,dependencies:[powers.exports.level],transform:describeProgram((r:rules.QueryRead,c:rules.ModifierContext<Block,number>)=>{const amount=r.query(powers.exports.level,c.source);return amount===0?c.value:Math.max(0,(c.value+amount)|0);},'层数为0则保持原值，否则加上当前层数，转32位整数且不低于0。')});
  const Strength=defineDescribedPower('力量',{...counterPolicies({bits:32,scalar:true,zeroIsNoop:true}),grantEffect:EffectKind.Strength},powerAbilities(effectAbility(scalarBonus(attributes.exports.strength),EffectKind.Strength),effectAbility(strengthBonus,EffectKind.Strength)));
  const Dexterity=defineDescribedPower('敏捷',counterPolicies({bits:32,scalar:true,zeroIsNoop:true}),powerAbilities(scalarBonus(attributes.exports.dexterity),dexterityBonus));
  const Focus=defineDescribedPower('集中',counterPolicies({bits:32,scalar:true,zeroIsNoop:true}),powerAbilities(scalarBonus(attributes.exports.focus)));
  function weak(target:rules.Query<Attack,number>,player:boolean){
    const ability=modifyProgram(target,{condition:sourceOwns,order:{phase:attributes.exports.stages.sourceScale,priority:20},dependencies:[attributes.exports.weakFactor],transform:describeProgram((r:rules.QueryRead,c:rules.ModifierContext<Attack,number>)=>Math.fround(c.value*r.query(attributes.exports.weakFactor,c.input)),weakScaleText)});
    return defineDescribedPower('虚弱',{presentation:{key:player?PS.WEAK:MS.WEAK,flag:false},...counterPolicies({bits:player?16:32,resetWhenInactive:player,reactivateOnReduction:!player,harmful:true,markOnEnemyDebuff:true,enemyDebuffOnlyWhenNew:player,zeroIsNoop:player,clearOnRemove:!player})},powerAbilities(ability),(player?playerRoundExpiry:enemyRoundExpiry)(player?30:20,true));
  }
  function vulnerable(target:rules.Query<Attack,number>,player:boolean){
    const ability=modifyProgram(target,{condition:targetOwns,order:{phase:attributes.exports.stages.targetScale,priority:10},dependencies:[attributes.exports.vulnerableFactor],transform:describeProgram((r:rules.QueryRead,c:rules.ModifierContext<Attack,number>)=>Math.fround(c.value*r.query(attributes.exports.vulnerableFactor,c.input)),vulnerableScaleText)});
    return defineDescribedPower('易伤',{presentation:{key:player?PS.VULNERABLE:MS.VULNERABLE,flag:false},...counterPolicies({bits:player?16:32,resetWhenInactive:player,reactivateOnReduction:!player,harmful:true,markOnEnemyDebuff:true,enemyDebuffOnlyWhenNew:player,zeroIsNoop:player,clearOnRemove:!player})},powerAbilities(ability),(player?playerRoundExpiry:enemyRoundExpiry)(player?20:30,true));
  }
  const PlayerWeak=weak(attributes.exports.playerAttack,true),EnemyWeak=weak(attributes.exports.enemyAttack,false);
  const PlayerVulnerable=vulnerable(attributes.exports.enemyAttack,true),EnemyVulnerable=vulnerable(attributes.exports.playerAttack,false);
  const frailNumerator=3,frailDenominator=4,blockedCardAmount=0;
  const Frail=defineDescribedPower('脆弱',{presentation:{key:PS.FRAIL,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,harmful:true,markOnEnemyDebuff:true,enemyDebuffOnlyWhenNew:true,zeroIsNoop:true})},powerAbilities(modifyProgram(attributes.exports.block,{condition:blockOwns,order:attributes.exports.stages.sourceScale,transform:describeProgram((_r:rules.QueryRead,c:rules.ModifierContext<Block,number>)=>Math.trunc(((c.value*frailNumerator)|0)/frailDenominator),`乘以${frailNumerator}转32位整数，再除以${frailDenominator}向零取整（减少${(1-frailNumerator/frailDenominator)*100}%）。`)})),playerRoundExpiry(10,true));
  const NoBlock=defineDescribedPower('无法格挡',{presentation:{key:PS.NO_BLOCK,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,harmful:true,zeroIsNoop:true})},powerAbilities(modifyProgram(attributes.exports.block,{condition:blockOwns,order:attributes.exports.stages.limit,transform:describeProgram(()=>blockedCardAmount,`设为${blockedCardAmount}。`)})),playerRoundExpiry(70,false));
  function artifact(player:boolean){
    const consumedLayers=1;
    const condition=describeProgram(defineQuery({input:typedValue<rules.ReplacementContext<PowerApplication>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.level],base:(r,c)=>c.value.actor===c.owner&&c.value.debuff&&r.query(powers.exports.enabled,c.source)&&(!player||r.query(powers.exports.level,c.source)!==0)}),`状态生效且持有者即将被施加负面状态${player?'，并且层数非0':''}`);
    const consume=replaceProgram(powers.exports.beforeApply,{condition,order:powers.exports.stages.consumption,effect:describeProgram(defineEffect<rules.ReplacementContext<PowerApplication>,rules.ReplacementResult<PowerApplication>>(b=>sequence(
      call(powers.exports.decrement,{entity:b.read(v=>v.input.source),amount:consumedLayers}),b.return({kind:'cancel',reason:{artifact:b.read(v=>v.input.source)}}),
    )),`消耗${consumedLayers}层并取消本次状态施加，原因记为人工制品。`)});
    return defineDescribedPower('人工制品',{...(player?{}:{presentation:{key:MS.ARTIFACT,flag:false}}),...counterPolicies({bits:player?32:8,scalar:player,reactivateOnReduction:!player,zeroIsNoop:player,clearOnRemove:!player})},powerAbilities(scalarBonus(attributes.exports.artifact),consume));
  }
  const PlayerArtifact=artifact(true),EnemyArtifact=artifact(false);
  return{exports:{Strength:Strength.definition,Dexterity:Dexterity.definition,Focus:Focus.definition,PlayerWeak:PlayerWeak.definition,EnemyWeak:EnemyWeak.definition,PlayerVulnerable:PlayerVulnerable.definition,EnemyVulnerable:EnemyVulnerable.definition,Frail:Frail.definition,NoBlock:NoBlock.definition,PlayerArtifact:PlayerArtifact.definition,EnemyArtifact:EnemyArtifact.definition,programs:{Strength,Dexterity,Focus,PlayerWeak,EnemyWeak,PlayerVulnerable,EnemyVulnerable,Frail,NoBlock,PlayerArtifact,EnemyArtifact},statusTexts:{STRENGTH:Strength.text,DEXTERITY:Dexterity.text,FOCUS:Focus.text,WEAK:`玩家：${PlayerWeak.text}敌人：${EnemyWeak.text}`,VULNERABLE:`玩家：${PlayerVulnerable.text}敌人：${EnemyVulnerable.text}`,FRAIL:Frail.text,NO_BLOCK:NoBlock.text,ARTIFACT:PlayerArtifact.text}}};
}});
