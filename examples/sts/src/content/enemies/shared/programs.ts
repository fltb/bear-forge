import {enemyOperations} from './operations.ts';
import {combatOperations,defineOperation,OperationKind} from '../../../rules/combat-operations.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {monsterId as monsterIds} from "../../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemyHealthSchema,enemyIntentSchema} from "../../../rules/enemies.schemas.ts";
import {monsterHpRanges} from "../../../monster-data.ts";
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {resources} from "../../../rules/resources.ts";
import {attributes} from "../../../rules/attributes.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import type {EnemyAction,EnemySetup,EnemyIntent} from "../../../rules/enemies.types.ts";
import type {HitResult} from '../../../rules/damage.types.ts';
import type {PowerDefinition} from "../../../rules/powers.types.ts";
export type EnemyAmount=number|((v:rules.ReadView<EnemyAction>)=>number);
const amount=(a:EnemyAmount,v:rules.ReadView<EnemyAction>)=>typeof a==='number'?a:a(v);
export function enemyHealth(id:number,threshold:number,discard:readonly{minimum:number;maximum:number}[]=[],draw=true,parameters:(ascension:number)=>{minimum:number;maximum:number}[]=()=>[]){return rules.defineQuery({input:z.int32(),output:enemyHealthSchema,base:(_r,ascension)=>{const range=monsterHpRanges[id]![ascension>=threshold?1:0];return{minimum:range[0],maximum:range[1],draw,discard:[...discard],parameters:parameters(ascension)};}});}
export type EnemyAttackRead=Pick<rules.ReadView<EnemyAction>,'input'|'query'>;
export type EnemyAttackAmount=number|((v:EnemyAttackRead)=>number);
const attackIntents=new WeakMap<rules.Effect<EnemyAction,void>,rules.Query<number,import('../../../rules/enemies.types.ts').EnemyIntent>>();
/** One query samples the declaration and resolves its damage category and amount.
 * Execution samples once before enqueueing, not again for each queued hit. */
function attackOperation(base:EnemyAttackAmount,hits:EnemyAttackAmount,dependencies:readonly rules.Query<number,number>[],mode:'attack'|'drain'|'blast'){
  const attack=mode!=='blast';
  const parameters=rules.defineQuery({input:typedValue<EnemyAction>(),output:enemyIntentSchema,dependencies:[enemies.exports.current,battles.exports.status,attributes.exports.attackAmount,...dependencies],base:(r,input)=>{
    const view:EnemyAttackRead={input,query:(definition,value)=>r.query(definition,value)};
    const damage=typeof base==='number'?base:base(view),count=typeof hits==='number'?hits:hits(view);
    return{attack,damage,hits:count,attackDamage:attack?r.query(attributes.exports.attackAmount,{source:input.actor,target:r.query(battles.exports.status,input.battle).actor,base:damage,card:null}):damage};
  }});
  const intent=rules.defineQuery({input:z.number(),output:enemyIntentSchema,dependencies:[enemies.exports.current,parameters],base:(r,enemy)=>{
    const s=r.query(enemies.exports.current,enemy);return r.query(parameters,{enemy,actor:s.actor,battle:s.battle,turn:s.opportunityTurn,move:s.history[0],attack});
  }});
  const hit=defineOperation<{action:EnemyAction;damage:number;attack:boolean},void>(OperationKind.Attack,undefined,b=>{const result=b.local<HitResult>();return rules.when(b.read(v=>v.query(enemies.exports.live,v.input.action.enemy)),rules.sequence(
    b.assign(result,rules.call(battles.exports.hit,{battle:b.read(v=>v.input.action.battle),source:b.read(v=>v.input.action.actor),target:b.read(v=>v.query(battles.exports.status,v.input.action.battle).actor),amount:b.read(v=>v.input.damage),attack:b.read(v=>v.input.attack),selfDamage:false})),
    ...(mode==='drain'?[rules.when(b.read(v=>v.query(resources.exports.vitality,v.input.action.actor).hp>0),rules.call(enemyOperations.exports.heal,{entity:b.read(v=>v.input.action.actor),amount:b.read(v=>Math.min(v.input.damage,v.get(result).unblocked))}))]:[]),
  ));});
  const execute=rules.defineEffect<EnemyAction,void>(b=>{const spec=b.local<EnemyIntent>();return rules.sequence(
    b.assign(spec,rules.query(parameters,b.input)),
    rules.forEach(b.read(v=>Array.from({length:v.get(spec).hits})),()=>rules.enqueue(hit,{action:b.input,damage:b.read(v=>v.get(spec).attackDamage),attack:b.read(v=>v.get(spec).attack)},{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),
  );});
  attackIntents.set(execute,intent);return execute;
}
export function enemyAttack(base:EnemyAttackAmount,hits:EnemyAttackAmount=1,dependencies:readonly rules.Query<number,number>[]=[]){return attackOperation(base,hits,dependencies,'attack');}
export function enemyDrain(base:EnemyAttackAmount){return attackOperation(base,1,[],'drain');}
export function enemyBlast(base:EnemyAttackAmount){return attackOperation(base,1,[],'blast');}
export function enemyIntentFrom(entries:readonly (readonly[number,rules.Effect<EnemyAction,void>])[]):rules.Query<number,import('../../../rules/enemies.types.ts').EnemyIntent>{
  const moves=entries.map(([move,attack])=>{const intent=attackIntents.get(attack);if(!intent)throw Error('Intent requires an attack operation');return{move,intent};});
  return rules.defineQuery({input:z.number(),output:enemyIntentSchema,dependencies:[enemies.exports.current,...moves.map(m=>m.intent)],base:(r,enemy)=>{const move=moves.find(m=>m.move===r.query(enemies.exports.current,enemy).history[0]);return move?r.query(move.intent,enemy):{attack:false,damage:0,attackDamage:0,hits:0};}});
}
export function attackMove(move:number,attack:rules.Effect<EnemyAction,void>,compose:(attack:rules.Effect<EnemyAction,void>)=>rules.Effect<EnemyAction,void>=attack=>attack):EnemyMoveProgram{
  const intent=attackIntents.get(attack);if(!intent)throw Error('Attack move requires a declared attack operation');
  return{move,intent,execute:compose(attack)};
}
export function enemyBlock(base:EnemyAmount){return rules.defineEffect<EnemyAction,void>(b=>rules.enqueue(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:b.read(v=>amount(base,v))},{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}
export function enemyPower(definition:PowerDefinition,base:EnemyAmount,targetPlayer=false,debuff=false,queued=false){return rules.defineEffect<EnemyAction,void>(b=>{const input={registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>targetPlayer?v.query(battles.exports.status,v.input.battle).actor:v.input.actor),definition,amount:b.read(v=>amount(base,v)),source:b.read(v=>v.input.actor),debuff,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)};return queued?rules.enqueue(enemyOperations.exports.applyPower,input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}):rules.call(enemyOperations.exports.applyPower,input);});}
export const enemyUtilities=rules.defineRules({requires:[enemyOperations,combatOperations,enemies,battles,powers,resources,attributes],build(){
  const rollEnemyAfter=rules.defineEffect<EnemyAction,void>(b=>rules.enqueue(enemies.exports.roll,b.read(v=>v.input.enemy),{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  const initialEnemyRoll=rules.defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>rules.when(b.read(v=>v.input.setup.deferInitialRoll!==true),rules.call(enemies.exports.roll,b.read(v=>v.input.entity))));
  return{exports:{rollEnemyAfter,initialEnemyRoll}};
}});
export const {rollEnemyAfter,initialEnemyRoll}=enemyUtilities.exports;
export function enemyProgram(...effects:rules.Effect<EnemyAction,void>[]){return rules.defineEffect<EnemyAction,void>(b=>rules.sequence(...effects.map(effect=>rules.call(effect,b.input))));}

export const sourceMonsterNames:rules.Borrowed<Record<number,string>>={...Object.fromEntries(Object.entries(monsterIds).map(([name,id])=>[id,name])),[monsterIds.INVALID]:'INVALID = 0'};
export function publicMonsterName(meta:{readonly id:number;readonly name:string}|null):string{return meta===null?sourceMonsterNames[monsterIds.INVALID]!:sourceMonsterNames[meta.id]??meta.name;}

export type EnemyMoveProgram={move:number;intent?:rules.Query<number,import('../../../rules/enemies.types.ts').EnemyIntent>;execute:rules.Effect<EnemyAction,void>};
/** Author utility: lowers a concrete move table to ordinary branches and typed calls at link time. */
export function enemyDefinition(spec:{id:number;threshold?:number;choose:rules.Effect<import('../../../rules/enemies.types.ts').EnemyRoll,number>;moves:readonly EnemyMoveProgram[];initialize?:rules.Effect<rules.EntityLifecycle<EnemySetup>,void>;health?:rules.Query<number,import('../../../rules/enemies.types.ts').EnemyHealth>;presentation?:rules.Query<number,Record<string,number|boolean>>;components?:readonly rules.Component<any>[]} ){
  const moves=Object.freeze([...spec.moves]);
  const intent=rules.defineQuery({input:z.number(),output:enemyIntentSchema,dependencies:[enemies.exports.current,...moves.flatMap(m=>m.intent?[m.intent]:[])],base:(r,entity)=>{
    const move=moves.find(m=>m.move===r.query(enemies.exports.current,entity).history[0]);
    return move?.intent?r.query(move.intent,entity):{attack:false,damage:0,attackDamage:0,hits:0};
  }});
  const act=rules.defineEffect<EnemyAction,void>(b=>rules.sequence(...moves.map(m=>rules.when(b.read(v=>v.input.move===m.move),rules.sequence(rules.call(m.execute,b.input),b.return(undefined))))));
  return rules.defineEntity(enemies.exports.kind,{metadata:{id:spec.id,name:sourceMonsterNames[spec.id]!},health:spec.health??enemyHealth(spec.id,spec.threshold??7),choose:spec.choose,intent,act,initialize:spec.initialize??initialEnemyRoll,presentation:spec.presentation},{components:spec.components??[]});
}

export function enemyAtStart(effect:rules.Effect<EnemyAction,void>){return rules.on(enemies.exports.prepared,{condition:rules.defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[enemies.exports.current],base:(_r,c)=>c.source===c.event}),effect:rules.defineEffect<rules.ReactionContext<number>,void>(b=>rules.call(effect,b.read(v=>{const s=v.query(enemies.exports.current,v.input.source);return{enemy:v.input.source,actor:v.input.owner,battle:s.battle,turn:s.opportunityTurn,move:s.history[0],attack:v.query(enemies.exports.intent,v.input.source).attack};})))});}
export function enemyInitialize(...abilities:rules.Ability[]){return rules.defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>rules.sequence(rules.call(initialEnemyRoll,b.input),...abilities.map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)}))));}
