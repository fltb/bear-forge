import {PS,MS} from '../combat-identifiers.ts';
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {powers} from '../rules/powers.ts';
import {attributes} from '../rules/attributes.ts';
import {resources} from '../rules/resources.ts';
import {turns} from '../rules/turns.ts';
import {expireCounter} from './turn-power-utils.ts';
import {attackValueSchema,blockValueSchema} from '../rules/attributes.schemas.ts';
import type {PowerApplication} from '../rules/powers.types.ts';
import {counterPolicies,attachAbilities,scalarBonus} from './power-utils.ts';
const {defineRules,defineQuery,defineEffect,defineEntity,modify,replace,sequence,call}=rules;
type Attack=z.infer<typeof attackValueSchema>;
type Block=z.infer<typeof blockValueSchema>;
export const basicPowers=defineRules({requires:[powers,attributes,resources,turns],build(){
  const sourceOwns=defineQuery({input:z.custom<rules.ModifierContext<Attack,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.source===c.owner&&r.query(powers.exports.enabled,c.source)});
  const targetOwns=defineQuery({input:z.custom<rules.ModifierContext<Attack,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.target===c.owner&&r.query(powers.exports.enabled,c.source)});
  const blockOwns=defineQuery({input:z.custom<rules.ModifierContext<Block,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.input.actor===c.owner&&r.query(powers.exports.enabled,c.source)});
  const strengthBonus=modify(attributes.exports.playerAttack,{condition:sourceOwns,order:{phase:attributes.exports.stages.addition,priority:100},dependencies:[powers.exports.level],transform:(r,c)=>Math.fround(c.value+Math.fround(r.query(powers.exports.level,c.source)))});
  const dexterityBonus=modify(attributes.exports.block,{condition:blockOwns,order:attributes.exports.stages.addition,dependencies:[powers.exports.level],transform:(r,c)=>{const amount=r.query(powers.exports.level,c.source);return amount===0?c.value:Math.max(0,(c.value+amount)|0);}});
  const Strength=defineEntity(powers.exports.kind,{...counterPolicies({bits:32,scalar:true,zeroIsNoop:true}),attach:attachAbilities(scalarBonus(attributes.exports.strength),strengthBonus)});
  const Dexterity=defineEntity(powers.exports.kind,{...counterPolicies({bits:32,scalar:true,zeroIsNoop:true}),attach:attachAbilities(scalarBonus(attributes.exports.dexterity),dexterityBonus)});
  const Focus=defineEntity(powers.exports.kind,{...counterPolicies({bits:32,scalar:true,zeroIsNoop:true}),attach:attachAbilities(scalarBonus(attributes.exports.focus))});
  function weak(target:rules.Query<Attack,number>,player:boolean){
    const ability=modify(target,{condition:sourceOwns,order:{phase:attributes.exports.stages.sourceScale,priority:20},dependencies:[attributes.exports.weakFactor],transform:(r,c)=>Math.fround(c.value*r.query(attributes.exports.weakFactor,c.input))});
    return defineEntity(powers.exports.kind,{presentation:{key:player?PS.WEAK:MS.WEAK,flag:false},...counterPolicies({bits:player?16:32,resetWhenInactive:player,reactivateOnReduction:!player,harmful:true,markOnEnemyDebuff:true,enemyDebuffOnlyWhenNew:player,zeroIsNoop:player,clearOnRemove:!player}),attach:attachAbilities(ability,expireCounter(player?turns.exports.playerRoundEnd:turns.exports.enemyRoundEnd,player?30:20,true))});
  }
  function vulnerable(target:rules.Query<Attack,number>,player:boolean){
    const ability=modify(target,{condition:targetOwns,order:{phase:attributes.exports.stages.targetScale,priority:10},dependencies:[attributes.exports.vulnerableFactor],transform:(r,c)=>Math.fround(c.value*r.query(attributes.exports.vulnerableFactor,c.input))});
    return defineEntity(powers.exports.kind,{presentation:{key:player?PS.VULNERABLE:MS.VULNERABLE,flag:false},...counterPolicies({bits:player?16:32,resetWhenInactive:player,reactivateOnReduction:!player,harmful:true,markOnEnemyDebuff:true,enemyDebuffOnlyWhenNew:player,zeroIsNoop:player,clearOnRemove:!player}),attach:attachAbilities(ability,expireCounter(player?turns.exports.playerRoundEnd:turns.exports.enemyRoundEnd,player?20:30,true))});
  }
  const PlayerWeak=weak(attributes.exports.playerAttack,true),EnemyWeak=weak(attributes.exports.enemyAttack,false);
  const PlayerVulnerable=vulnerable(attributes.exports.enemyAttack,true),EnemyVulnerable=vulnerable(attributes.exports.playerAttack,false);
  const Frail=defineEntity(powers.exports.kind,{presentation:{key:PS.FRAIL,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,harmful:true,markOnEnemyDebuff:true,enemyDebuffOnlyWhenNew:true,zeroIsNoop:true}),attach:attachAbilities(modify(attributes.exports.block,{condition:blockOwns,order:attributes.exports.stages.sourceScale,transform:(_r,c)=>Math.trunc(((c.value*3)|0)/4)}),expireCounter(turns.exports.playerRoundEnd,10,true))});
  const NoBlock=defineEntity(powers.exports.kind,{presentation:{key:PS.NO_BLOCK,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,harmful:true,zeroIsNoop:true}),attach:attachAbilities(modify(attributes.exports.block,{condition:blockOwns,order:attributes.exports.stages.limit,transform:()=>0}),expireCounter(turns.exports.playerRoundEnd,70,false))});
  function artifact(player:boolean){
    const condition=defineQuery({input:z.custom<rules.ReplacementContext<PowerApplication>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.level],base:(r,c)=>c.value.actor===c.owner&&c.value.debuff&&r.query(powers.exports.enabled,c.source)&&(!player||r.query(powers.exports.level,c.source)!==0)});
    const consume=replace(powers.exports.beforeApply,{condition,order:powers.exports.stages.consumption,effect:defineEffect<rules.ReplacementContext<PowerApplication>,rules.ReplacementResult<PowerApplication>>(b=>sequence(
      call(powers.exports.decrement,{entity:b.read(v=>v.input.source),amount:1}),b.return({kind:'cancel',reason:{artifact:b.read(v=>v.input.source)}}),
    ))});
    return defineEntity(powers.exports.kind,{...(player?{}:{presentation:{key:MS.ARTIFACT,flag:false}}),...counterPolicies({bits:player?32:8,scalar:player,reactivateOnReduction:!player,zeroIsNoop:player,clearOnRemove:!player}),attach:attachAbilities(scalarBonus(attributes.exports.artifact),consume)});
  }
  const PlayerArtifact=artifact(true),EnemyArtifact=artifact(false);
  return{exports:{Strength,Dexterity,Focus,PlayerWeak,EnemyWeak,PlayerVulnerable,EnemyVulnerable,Frail,NoBlock,PlayerArtifact,EnemyArtifact}};
}});
