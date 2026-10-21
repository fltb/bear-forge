import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {resources} from './resources.ts';
import {entityId} from './resources.schemas.ts';
import {attackValueSchema,blockValueSchema} from './attributes.schemas.ts';
const {defineRules,defineQuery}=rules;
/** Source arithmetic stages, with all specific power/relic contributions installed by contents. */
export const attributes=defineRules({requires:[resources],build(){
  const addition={},sourceScale={},targetScale={},limit={},stages={addition,sourceScale,targetScale,limit};
  const order={phases:[{phase:addition,before:[sourceScale]},{phase:sourceScale,before:[targetScale]},{phase:targetScale,before:[limit]},{phase:limit}],default:addition};
  const strength=defineQuery({input:entityId,output:z.int32(),base:()=>0});
  const dexterity=defineQuery({input:entityId,output:z.int32(),base:()=>0});
  const focus=defineQuery({input:entityId,output:z.int32(),base:()=>0});
  const artifact=defineQuery({input:entityId,output:z.int32(),base:()=>0});
  const damageable=defineQuery({input:entityId,output:z.boolean(),dependencies:[resources.exports.current,resources.exports.vitality],base:(r,actor)=>r.query(resources.exports.vitality,actor).hp>0});
  const weakFactor=defineQuery({input:attackValueSchema,output:z.number(),base:()=>Math.fround(0.75)});
  const vulnerableFactor=defineQuery({input:attackValueSchema,output:z.number(),base:()=>Math.fround(1.5)});
  const playerAttack=defineQuery({input:attackValueSchema,output:z.number(),order,base:(_r,input)=>Math.fround(input.base)});
  const enemyAttack=defineQuery({input:attackValueSchema,output:z.number(),order,dependencies:[strength],base:(r,input)=>Math.fround((input.base+r.query(strength,input.source))|0)});
  const attackAmount=defineQuery({input:attackValueSchema,output:z.int32().nonnegative(),dependencies:[playerAttack,enemyAttack,resources.exports.side],base:(r,input)=>
    Math.max(0,Math.trunc(r.query(resources.exports.side,input.source)===0?r.query(playerAttack,input):r.query(enemyAttack,input)))});
  const block=defineQuery({input:blockValueSchema,output:z.number(),order,base:(_r,input)=>input.base});
  const blockAmount=defineQuery({input:blockValueSchema,output:z.int32(),dependencies:[block],base:(r,input)=>Math.trunc(r.query(block,input))});
  return{exports:{strength,dexterity,focus,artifact,damageable,weakFactor,vulnerableFactor,playerAttack,enemyAttack,attackAmount,block,blockAmount,stages}};
}});
