import { typedValue } from '../../../rules/value.schemas.ts';
import {monsterId as monsterIds} from "../../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {enemyHealthSchema,enemyIntentSchema} from "../../../rules/enemies.schemas.ts";
import {monsterHpRanges} from "../../../monster-data.ts";
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {resources} from "../../../rules/resources.ts";
import {attributes} from "../../../rules/attributes.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import type {EnemyAction,EnemySetup} from "../../../rules/enemies.types.ts";
import type {PowerDefinition} from "../../../rules/powers.types.ts";
export type EnemyAmount=number|((v:rules.ReadView<EnemyAction>)=>number);
const amount=(a:EnemyAmount,v:rules.ReadView<EnemyAction>)=>typeof a==='number'?a:a(v);
export function enemyHealth(id:number,threshold:number,discard:readonly{minimum:number;maximum:number}[]=[],draw=true,parameters:(ascension:number)=>{minimum:number;maximum:number}[]=()=>[]){return rules.defineQuery({input:z.int32(),output:enemyHealthSchema,base:(_r,ascension)=>{const range=monsterHpRanges[id]![ascension>=threshold?1:0];return{minimum:range[0],maximum:range[1],draw,discard:[...discard],parameters:parameters(ascension)};}});}
export function enemyAttack(base:EnemyAmount,hits:EnemyAmount=1){return rules.defineEffect<EnemyAction,void>(b=>{const damage=b.local<number>();return rules.sequence(b.assign(damage,b.read(v=>{const target=v.query(battles.exports.status,v.input.battle).actor;return v.query(attributes.exports.attackAmount,{source:v.input.actor,target,base:amount(base,v),card:null});})),rules.forEach(b.read(v=>Array.from({length:amount(hits,v)},(_,i)=>i)),()=>rules.enqueue(battles.exports.hit,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.actor),target:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),amount:damage,attack:true,selfDamage:false},{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})));});}
export function enemyBlock(base:EnemyAmount){return rules.defineEffect<EnemyAction,void>(b=>rules.enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.actor),amount:b.read(v=>amount(base,v))},{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}
export function enemyPower(definition:PowerDefinition,base:EnemyAmount,targetPlayer=false,debuff=false,queued=false){return rules.defineEffect<EnemyAction,void>(b=>{const input={registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>targetPlayer?v.query(battles.exports.status,v.input.battle).actor:v.input.actor),definition,amount:b.read(v=>amount(base,v)),source:b.read(v=>v.input.actor),debuff,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)};return queued?rules.enqueue(powers.exports.apply,input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}):rules.call(powers.exports.apply,input);});}
export const enemyUtilities=rules.defineRules({requires:[enemies,battles,powers,resources,attributes],build(){
  const rollEnemyAfter=rules.defineEffect<EnemyAction,void>(b=>rules.enqueue(enemies.exports.roll,b.read(v=>v.input.enemy),{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  const initialEnemyRoll=rules.defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>rules.when(b.read(v=>v.input.setup.deferInitialRoll!==true),rules.call(enemies.exports.roll,b.read(v=>v.input.entity))));
  return{exports:{rollEnemyAfter,initialEnemyRoll}};
}});
export const {rollEnemyAfter,initialEnemyRoll}=enemyUtilities.exports;
export function enemyProgram(...effects:rules.Effect<EnemyAction,void>[]){return rules.defineEffect<EnemyAction,void>(b=>rules.sequence(...effects.map(effect=>rules.call(effect,b.input))));}

export const sourceMonsterNames:rules.Borrowed<Record<number,string>>={...Object.fromEntries(Object.entries(monsterIds).map(([name,id])=>[id,name])),[monsterIds.INVALID]:'INVALID = 0'};

export type EnemyMoveProgram={move:number;damage?:number|((s:rules.Borrowed<import('../../../rules/enemies.types.ts').EnemyState>)=>number);hits?:number|((s:rules.Borrowed<import('../../../rules/enemies.types.ts').EnemyState>)=>number);execute:rules.Effect<EnemyAction,void>};
/** Author utility: lowers a concrete move table to ordinary branches and typed calls at link time. */
export function enemyDefinition(spec:{id:number;threshold?:number;choose:rules.Effect<import('../../../rules/enemies.types.ts').EnemyRoll,number>;moves:readonly EnemyMoveProgram[];initialize?:rules.Effect<rules.EntityLifecycle<EnemySetup>,void>;health?:rules.Query<number,import('../../../rules/enemies.types.ts').EnemyHealth>;intent?:rules.Query<number,import('../../../rules/enemies.types.ts').EnemyIntent>;presentation?:rules.Query<number,Record<string,number|boolean>>;components?:readonly rules.Component<any>[]} ){
  const moves=Object.freeze([...spec.moves]);
  const intent=rules.defineQuery({input:z.number(),output:enemyIntentSchema,dependencies:[enemies.exports.current],base:(r,entity)=>{const s=r.query(enemies.exports.current,entity),m=moves.find(m=>m.move===s.history[0]);const damage=m?.damage===undefined?0:typeof m.damage==='number'?m.damage:m.damage(s),hits=m?.damage===undefined?0:m.hits===undefined?1:typeof m.hits==='number'?m.hits:m.hits(s);return{attack:m?.damage!==undefined,damage,hits};}});
  const act=rules.defineEffect<EnemyAction,void>(b=>rules.sequence(...moves.map(m=>rules.when(b.read(v=>v.input.move===m.move),rules.sequence(rules.call(m.execute,b.input),b.return(undefined))))));
  return rules.defineEntity(enemies.exports.kind,{metadata:{id:spec.id,name:sourceMonsterNames[spec.id]!},health:spec.health??enemyHealth(spec.id,spec.threshold??7),choose:spec.choose,intent:spec.intent??intent,act,initialize:spec.initialize??initialEnemyRoll,presentation:spec.presentation},{components:spec.components??[]});
}

export function enemyAtStart(effect:rules.Effect<EnemyAction,void>){return rules.on(enemies.exports.prepared,{condition:rules.defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[enemies.exports.current],base:(_r,c)=>c.source===c.event}),effect:rules.defineEffect<rules.ReactionContext<number>,void>(b=>rules.call(effect,b.read(v=>{const s=v.query(enemies.exports.current,v.input.source);return{enemy:v.input.source,actor:v.input.owner,battle:s.battle,turn:s.opportunityTurn,move:s.history[0],attack:v.query(enemies.exports.intent,v.input.source).attack};})))});}
export function enemyInitialize(...abilities:rules.Ability[]){return rules.defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>rules.sequence(rules.call(initialEnemyRoll,b.input),...abilities.map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)}))));}
