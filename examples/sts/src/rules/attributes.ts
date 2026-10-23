import {z} from 'zod';
import {rules} from './execution.ts';
import {describeProgram} from './program-descriptions.ts';
import {resources} from './resources.ts';
import {entityId} from './resources.schemas.ts';
import {attackValueSchema,blockValueSchema} from './attributes.schemas.ts';
const {defineRules,defineQuery}=rules;
const weakMultiplier=.75,vulnerableMultiplier=1.5;
export const weakScaleText=`攻击伤害基础减少${(1-weakMultiplier)*100}%（可受遗物修正）。`;
export const vulnerableScaleText=`受到攻击伤害基础增加${(vulnerableMultiplier-1)*100}%（可受遗物修正）。`;
/** Source arithmetic stages, with all specific power/relic contributions installed by contents. */
export const attributes=defineRules({requires:[resources],build(){
  const addition={},sourceScale={},targetScale={},limit={},stages={addition,sourceScale,targetScale,limit};
  describeProgram(addition,'数值加成阶段');describeProgram(sourceScale,'来源倍率阶段');
  describeProgram(targetScale,'目标倍率阶段');describeProgram(limit,'最终限制阶段');
  const order={phases:[{phase:addition,before:[sourceScale]},{phase:sourceScale,before:[targetScale]},{phase:targetScale,before:[limit]},{phase:limit}],default:addition};
  const strength=defineQuery({input:entityId,output:z.int32(),base:()=>0});
  const dexterity=defineQuery({input:entityId,output:z.int32(),base:()=>0});
  const focus=defineQuery({input:entityId,output:z.int32(),base:()=>0});
  const artifact=defineQuery({input:entityId,output:z.int32(),base:()=>0});
  const damageable=defineQuery({input:entityId,output:z.boolean(),dependencies:[resources.exports.current,resources.exports.vitality],base:(r,actor)=>r.query(resources.exports.vitality,actor).hp>0});
  const weakFactor=defineQuery({input:attackValueSchema,output:z.number(),base:()=>Math.fround(weakMultiplier)});
  const vulnerableFactor=defineQuery({input:attackValueSchema,output:z.number(),base:()=>Math.fround(vulnerableMultiplier)});
  const playerAttack=defineQuery({input:attackValueSchema,output:z.number(),order,base:(_r,input)=>Math.fround(input.base)});
  const enemyAttack=defineQuery({input:attackValueSchema,output:z.number(),order,dependencies:[strength],base:(r,input)=>Math.fround((input.base+r.query(strength,input.source))|0)});
  const attackAmount=defineQuery({input:attackValueSchema,output:z.int32().nonnegative(),dependencies:[playerAttack,enemyAttack,resources.exports.side],base:(r,input)=>
    Math.max(0,Math.trunc(r.query(resources.exports.side,input.source)===0?r.query(playerAttack,input):r.query(enemyAttack,input)))});
  const block=defineQuery({input:blockValueSchema,output:z.number(),order,base:(_r,input)=>input.base});
  const blockAmount=defineQuery({input:blockValueSchema,output:z.int32(),dependencies:[block],base:(r,input)=>Math.trunc(r.query(block,input))});
  describeProgram(strength,'力量');describeProgram(dexterity,'敏捷');describeProgram(focus,'集中');describeProgram(artifact,'人工制品层数');
  describeProgram(damageable,'是否可受到伤害');describeProgram(weakFactor,'虚弱伤害倍率');describeProgram(vulnerableFactor,'易伤伤害倍率');
  describeProgram(playerAttack,'玩家攻击伤害');describeProgram(enemyAttack,'敌人攻击伤害');describeProgram(attackAmount,'取整后的攻击伤害');
  describeProgram(block,'格挡获得量');describeProgram(blockAmount,'取整后的格挡获得量');
  return{exports:{strength,dexterity,focus,artifact,damageable,weakFactor,vulnerableFactor,playerAttack,enemyAttack,attackAmount,block,blockAmount,stages}};
}});
