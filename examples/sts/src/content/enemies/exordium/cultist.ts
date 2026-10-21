import {enemyTurnPowers} from "../shared/ritual.ts";
import {rules} from '@bear-forge/card-engine';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {attributes} from "../../../rules/attributes.ts";
import {moveId,monsterId} from "../../../combat-identifiers.ts";
import {enemyUtilities,enemyHealth} from "../shared/programs.ts";
import {enemyIntentSchema} from "../../../rules/enemies.schemas.ts";
import {entityId} from "../../../rules/resources.schemas.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import type {EnemySetup,EnemyAction} from "../../../rules/enemies.types.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,call,query,enqueue}=rules;
export const cultist=defineRules({requires:[enemyUtilities,enemies,enemyTurnPowers],build(){
  const intent=defineQuery({input:entityId,output:enemyIntentSchema,dependencies:[enemies.exports.current],base:(r,id)=>{const attack=r.query(enemies.exports.current,id).history[0]===moveId.CULTIST_DARK_STRIKE;return{attack,damage:attack?6:0,hits:attack?1:0};}});
  const choose=defineEffect<{enemy:number;roll:number},number>(b=>b.return(b.read(v=>v.get(query(enemies.exports.current,v.input.enemy)).history[0]===0?moveId.CULTIST_INCANTATION:moveId.CULTIST_DARK_STRIKE)));
  const act=defineEffect<EnemyAction,void>(b=>when(b.read(v=>v.input.move===moveId.CULTIST_INCANTATION),sequence(
    call(powers.exports.apply,{registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:b.read(v=>v.input.actor),definition:enemyTurnPowers.exports.EnemyRitual,amount:b.read(v=>{const a=v.get(query(enemies.exports.current,v.input.enemy)).ascension;return a>=17?5:a>=2?4:3;}),source:null,debuff:false,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)}),
    call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:moveId.CULTIST_DARK_STRIKE}),call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)),
  ),sequence(
    enqueue(battles.exports.hit,b.read(v=>{const target=v.get(query(battles.exports.current,v.input.battle)).actor;return{battle:v.input.battle,source:v.input.actor,target,amount:v.get(query(attributes.exports.attackAmount,{source:v.input.actor,target,base:6,card:null})),attack:true,selfDamage:false};}),{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope),eligible:'captured'}),
    enqueue(enemies.exports.noopRoll,b.read(v=>v.input.enemy),{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
  )));
  return{exports:{Cultist:defineEntity(enemies.exports.kind,{metadata:{id:monsterId.CULTIST,name:'Cultist'},health:enemyHealth(monsterId.CULTIST,7),intent,choose,act,initialize:defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>call(enemies.exports.roll,b.read(v=>v.input.entity)))})}};
}});
