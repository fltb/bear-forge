import {fromSource,OriginKind} from './effect-trace.ts';
import { typedValue } from './value.schemas.ts';
import {z} from 'zod';
import {rules} from './execution.ts';
import {describeProgram} from './program-descriptions.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {damage} from './damage.ts';
import {actionQueue} from './combat-actions.ts';
import type {HitResult} from './damage.types.ts';
import {resources} from './resources.ts';
import {random} from './random.ts';
import {attributes} from './attributes.ts';
import {battles} from './battles.ts';
import {entityId} from './resources.schemas.ts';
import {enemySetupSchema,enemyStateSchema,enemyIntentSchema,enemyActionSchema,enemyRollSchema,enemyHealthSchema,enemyActionReceiptSchema} from './enemies.schemas.ts';
import type {EnemySetup,EnemyConfig,EnemyAction,EnemyIntent,EnemyHealth,EnemyDefinition,EnemyActionReceipt} from './enemies.types.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineCheckpoint,defineEffect,sequence,when,query,call,entityEffect}=rules;

/** Enemy programs are static definitions; opportunity ownership and AI draws are generic operations. */
export const enemies=defineRules({requires:[battles,random,resources,attributes,damage],build(m){
  // Opportunity consumption also happens for newly deployed enemies; only this
  // fact records a turn actually entered through the common action executor.
  const revivalCount=m.own(defineComponent({schema:z.int32().nonnegative(),initial:()=>0}));
  const revivals=defineQuery({input:entityId,output:z.int32().nonnegative(),reads:[revivalCount],base:(r,id)=>r.component(id,revivalCount)});
  const actedRound=m.own(defineComponent({schema:z.int32().nonnegative(),initial:()=>0}));
  const actionTotals=m.own(defineComponent({schema:enemyActionReceiptSchema.nullable(),initial:()=>null}));
  const receipt=defineQuery({input:entityId,output:enemyActionReceiptSchema,reads:[actionTotals],base:(r,id)=>r.component(id,actionTotals)??{action:null,performed:false,absorbed:0,blockSpent:0}});
  const restoration={},growth={},completionStages={restoration,growth};
  const completed=m.own(defineEvent({payload:enemyActionReceiptSchema,dispatch:'immediate',order:{phases:[{phase:restoration,before:[growth]},{phase:growth}],default:growth}}));
  const staged=m.own(defineEvent({payload:enemyActionSchema,dispatch:'immediate'}));
  const announceStaged=m.atom({input:enemyActionSchema,output:z.undefined(),reads:[],writes:[],emits:[staged],run(_r,payload){return{writes:[],events:[{event:staged,payload}],result:undefined};}});
  const recordAction=m.atom({input:z.object({enemy:entityId,receipt:enemyActionReceiptSchema.nullable()}),output:z.undefined(),reads:[],writes:[actionTotals],emits:[],run(_r,i){return{writes:[{entity:i.enemy,component:actionTotals,value:i.receipt}],events:[],result:undefined};}});
  const addHit=m.atom({input:z.object({enemy:entityId,absorbed:z.int32().nonnegative(),blockSpent:z.int32().nonnegative()}),output:z.undefined(),reads:[actionTotals],writes:[actionTotals],emits:[],run(r,i){const before=r.component(i.enemy,actionTotals);if(!before)throw Error('Missing active enemy action');return{writes:[{entity:i.enemy,component:actionTotals,value:{...before,absorbed:before.absorbed+i.absorbed,blockSpent:before.blockSpent+i.blockSpent}}],events:[],result:undefined};}});
  const announceCompleted=m.atom({input:enemyActionReceiptSchema,output:z.undefined(),reads:[],writes:[],emits:[completed],run(_r,payload){return{writes:[],events:[{event:completed,payload}],result:undefined};}});
  const trackDamage=rules.on(damage.exports.resolved,{
    condition:defineQuery({input:typedValue<rules.ReactionContext<HitResult>>(),output:z.boolean(),dependencies:[receipt,battles.exports.status],base:(r,c)=>{
      const action=r.query(receipt,c.source).action;
      return action!==null&&c.event.attack&&c.event.source===action.actor&&c.event.battle===action.battle&&c.event.blockTarget===r.query(battles.exports.status,action.battle).actor;
    }}),
    effect:defineEffect<rules.ReactionContext<HitResult>,void>(b=>call(addHit,{enemy:b.read(v=>v.input.source),absorbed:b.read(v=>v.input.event.blocked),blockSpent:b.read(v=>v.input.event.blockSpent)})),
  });
  const prepared=m.own(defineEvent({payload:entityId,dispatch:'immediate'}));
  const state=m.own(defineComponent({schema:enemyStateSchema.nullable(),initial:()=>null}));
  const current=defineQuery({input:entityId,output:enemyStateSchema,reads:[state],base:(r,id)=>{const value=r.component(id,state);if(value===null)throw Error('Uninitialized enemy');return value;}});
  const acted=defineQuery({input:entityId,output:z.boolean(),reads:[actedRound],dependencies:[current,battles.exports.status],base:(r,id)=>r.component(id,actedRound)===r.query(battles.exports.status,r.query(current,id).battle).turn});
  const markActed=m.atom({input:entityId,output:z.undefined(),reads:[state],writes:[actedRound],emits:[],run(r,id){const s=r.component(id,state);if(s===null)throw Error('Uninitialized enemy');return{writes:[{entity:id,component:actedRound,value:s.opportunityTurn}],events:[],result:undefined};}});
  const forActor=defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,actor)=>{const ids=r.entities(state).filter(id=>r.component(id,state)?.actor===actor);if(ids.length>1)throw Error('Enemy actor already has a controller');return ids[0]??null;}});
  const live=defineQuery({input:entityId,output:z.boolean(),dependencies:[current,resources.exports.current,resources.exports.vitality],base:(r,id)=>{const s=r.query(current,id);return !s.escaped&&!s.halfDead&&r.query(resources.exports.vitality,s.actor).hp>0;}});
  const eligible=defineQuery({input:entityId,output:z.boolean(),dependencies:[current,live],base:(r,id)=>r.query(live,id)||r.query(current,id).halfDead});
  const beforeIntent=m.own(defineCheckpoint({input:enemyActionSchema,output:enemyActionSchema}));
  const begin=m.atom({input:enemySetupSchema.extend({entity:entityId,turn:z.int32().positive()}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){const {entity,turn,...setup}=i;return{writes:[{entity,component:state,value:{...setup,history:[0,0] as [number,number],opportunityTurn:turn,claimed:false,prepared:false,escaped:false,halfDead:false}}],events:[],result:undefined};}});
  const validate=defineQuery({input:enemySetupSchema,output:enemySetupSchema,dependencies:[battles.exports.current,resources.exports.side,random.exports.current,forActor,battles.exports.status],base:(r,i)=>{if(!r.query(battles.exports.status,i.battle).enemies.includes(i.actor)||r.query(resources.exports.side,i.actor)!==1||r.query(forActor,i.actor)!==null)throw Error('Invalid enemy actor');r.query(random.exports.current,i.aiRng);return i;}});
  const targetability=rules.modify(attributes.exports.damageable,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),base:(_r,c)=>c.input===c.owner}),dependencies:[current],transform:(r,c)=>{const s=r.query(current,c.source);return c.value&&!s.escaped&&!s.halfDead;}});
  const noInitialize=defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>b.return(undefined));
  const initialize:rules.Effect<rules.EntityLifecycle<EnemySetup>,void>=defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>{const setup=b.local<EnemySetup>();return sequence(b.assign(setup,query(validate,b.read(v=>v.input.setup))),call(begin,b.read(v=>({...v.get(setup),entity:v.input.entity,turn:v.query(battles.exports.status,v.get(setup).battle).turn}))),rules.install({ability:targetability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.get(setup).actor),environment:{},lifetime:b.read(v=>v.input.scope)}),rules.install({ability:trackDamage,source:b.read(v=>v.input.entity),owner:b.read(v=>v.get(setup).actor),environment:{},lifetime:b.read(v=>v.input.scope)}),call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.initialize??noInitialize),b.input));});
  const kind:rules.EntityKind<EnemyConfig,EnemySetup>=m.kind({config:z.object({metadata:z.object({id:z.int32(),name:z.string()}).optional(),health:typedValue<NonNullable<EnemyConfig['health']>>().optional(),presentation:typedValue<NonNullable<EnemyConfig['presentation']>>().optional(),intent:typedValue<EnemyConfig['intent']>(),choose:typedValue<EnemyConfig['choose']>(),act:typedValue<EnemyConfig['act']>(),initialize:typedValue<NonNullable<EnemyConfig['initialize']>>().optional()}).strict(),setup:enemySetupSchema,components:[state,actionTotals,actedRound,revivalCount],initialize});
  const missingHealth=defineQuery({input:z.int32(),output:enemyHealthSchema,base:()=>{throw Error('Enemy has no construction health policy');}});
  const healthPolicy={kind,select:(c:rules.Borrowed<EnemyConfig>)=>c.health??missingHealth};
  const definitionHealth=defineQuery({input:z.object({definition:typedValue<EnemyDefinition>(),ascension:z.int32()}),output:enemyHealthSchema,selections:[healthPolicy],base:(r,i)=>r.selectedDefinition(healthPolicy,i.definition,i.ascension)});
  const metadata=defineQuery({input:typedValue<EnemyDefinition>(),output:z.object({id:z.int32(),name:z.string()}),kinds:[kind],base:(r,definition)=>{const m=r.definitionConfiguration(definition,kind).metadata;if(!m)throw Error('Enemy has no presentation metadata');return m;}});
  const emptyPresentation=defineQuery<number,Record<string,number|boolean>>({input:entityId,output:z.record(z.string(),z.union([z.number(),z.boolean()])),base:()=>({})});
  const presentationPolicy={kind,select:(c:rules.Borrowed<EnemyConfig>)=>c.presentation??emptyPresentation};
  const presentation=defineQuery<number,Record<string,number|boolean>>({input:entityId,output:z.record(z.string(),z.union([z.number(),z.boolean()])),selections:[presentationPolicy],base:(r,id)=>r.selected(presentationPolicy,id,id)});
  const intentPolicy={kind,select:(c:rules.Borrowed<EnemyConfig>)=>c.intent};
  const intent=defineQuery({input:entityId,output:enemyIntentSchema,selections:[intentPolicy],base:(r,id)=>r.selected(intentPolicy,id,id)});
  const choose=defineEffect<{enemy:number;roll:number},number>(b=>{const move=b.local<number>();return sequence(b.assign(move,call(entityEffect(kind,b.read(v=>v.input.enemy),c=>c.choose),b.input)),b.return(move));});
  const setMove=m.atom({input:z.object({enemy:entityId,move:z.int32()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.enemy,state);if(s===null)throw Error('Uninitialized enemy');return{writes:[{entity:i.enemy,component:state,value:{...s,history:[i.move,s.history[0]] as [number,number]}}],events:[],result:undefined};}});
  const noopRoll=defineEffect<number,void>(b=>call(random.exports.int,{stream:b.read(v=>v.query(current,v.input).aiRng),start:0,end:99}));
  const roll=defineEffect<number,void>(b=>{const value=b.local<number>(),move=b.local<number>();return sequence(b.assign(value,call(random.exports.int,{stream:b.read(v=>v.query(current,v.input).aiRng),start:0,end:99})),b.assign(move,call(choose,{enemy:b.input,roll:value})),call(setMove,{enemy:b.input,move}));});
  const replaceMove=m.atom({input:z.object({enemy:entityId,move:z.int32()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.enemy,state);if(s===null)throw Error('Uninitialized enemy');return{writes:[{entity:i.enemy,component:state,value:{...s,history:[i.move,s.history[1]] as [number,number]}}],events:[],result:undefined};}});
  const prepare=m.atom({input:entityId,output:z.undefined(),reads:[state],writes:[state],emits:[prepared],run(r,entity){const s=r.component(entity,state);if(s===null||s.prepared)throw Error('Enemy preparation must occur exactly once');return{writes:[{entity,component:state,value:{...s,prepared:true}}],events:[{event:prepared,payload:entity}],result:undefined};}});
  const setFlags=m.atom({input:z.object({enemy:entityId,escaped:z.boolean().optional(),halfDead:z.boolean().optional()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const before=r.component(i.enemy,state);if(before===null)throw Error('Missing enemy controller');const enemy=i.enemy,flags={...(i.escaped===undefined?{}:{escaped:i.escaped}),...(i.halfDead===undefined?{}:{halfDead:i.halfDead})};return{writes:[{entity:enemy,component:state,value:{...before,...flags}}],events:[],result:undefined};}});
  const finishRevival=m.atom({input:z.object({enemy:entityId,move:z.int32().nullable()}),output:z.undefined(),reads:[state,revivalCount],writes:[state,revivalCount],emits:[],run(r,i){
    const before=r.component(i.enemy,state);if(before===null||!before.halfDead||before.escaped)throw Error('Revival needs a pending enemy');
    return{writes:[{entity:i.enemy,component:state,value:{...before,halfDead:false,history:i.move===null?before.history:[i.move,before.history[0]] as [number,number]}},{entity:i.enemy,component:revivalCount,value:r.component(i.enemy,revivalCount)+1}],events:[],result:undefined};
  }});
  const openOpportunity=m.atom({input:z.object({enemy:entityId,turn:z.int32().positive()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.enemy,state);if(s===null||i.turn<s.opportunityTurn)throw Error('Cannot reopen an old enemy opportunity');return{writes:i.turn===s.opportunityTurn?[]:[{entity:i.enemy,component:state,value:{...s,opportunityTurn:i.turn,claimed:false}}],events:[],result:undefined};}});
  const claim=m.atom({input:entityId,output:z.boolean(),reads:[state],writes:[state],emits:[],run(r,entity){const s=r.component(entity,state);if(s===null)throw Error('Uninitialized enemy');return{writes:s.claimed?[]:[{entity,component:state,value:{...s,claimed:true}}],events:[],result:!s.claimed};}});
  const stageTurnBody=defineEffect<number,boolean>(b=>{const claimed=b.local<boolean>(),action=b.local<EnemyAction>(),description=b.local<EnemyIntent>(),checked=b.local<rules.ReplacementResult<EnemyAction>>();return sequence(
    when(b.read(v=>!v.query(eligible,v.input)||v.query(current,v.input).claimed),b.return(false)),
    b.assign(description,query(intent,b.input)),b.assign(action,b.read(v=>{const s=v.query(current,v.input);if(s.opportunityTurn!==v.query(battles.exports.status,s.battle).turn)throw Error('Stale enemy opportunity');return{enemy:v.input,actor:s.actor,battle:s.battle,turn:s.opportunityTurn,move:s.history[0],attack:v.get(description).attack};})),b.assign(claimed,call(claim,b.input)),when(b.read(v=>!v.get(claimed)),b.return(false)),
    call(markActed,b.input),call(recordAction,{enemy:b.input,receipt:{action,performed:true,absorbed:0,blockSpent:0}}),b.assign(checked,m.resolve(beforeIntent,action)),when(b.read(v=>v.get(checked).kind==='cancel'),sequence(call(announceStaged,action),b.return(true))),
    when(b.read(v=>{const c=v.get(checked);if(c.kind==='cancel')return false;const a=v.get(action);return c.value.enemy!==a.enemy||c.value.actor!==a.actor||c.value.battle!==a.battle||c.value.turn!==a.turn||c.value.move!==a.move||c.value.attack!==a.attack;}),b.return(b.read(()=>{throw Error('Enemy intent identity cannot be replaced');}))),
    call(entityEffect(kind,b.input,c=>c.act),action),call(announceStaged,action),b.return(true),
  );});
  const stageTurn=fromSource(stageTurnBody,v=>{const enemy=v.query(current,v.input);return{source:v.input,owner:enemy.actor,registration:null,kind:OriginKind.EnemyAction,action:enemy.opportunityTurn};});
  const continueAction=defineEffect<number,boolean>(b=>sequence(
    call(battles.exports.checkOutcome,b.read(v=>v.query(current,v.input).battle)),
    // Victory already cancels attack-lifetime tasks; retain surviving settlement work.
    b.return(b.read(v=>v.query(battles.exports.status,v.query(current,v.input).battle).outcome!==2)),
  ));
  const finishAction=defineEffect<EnemyActionReceipt,void>(b=>call(announceCompleted,b.input));
  const takeTurnDetailed=defineEffect<number,EnemyActionReceipt>(b=>{const performed=b.local<boolean>(),result=b.local<EnemyActionReceipt>();return sequence(
    b.assign(performed,ruleModules.runTaskGroup(actionQueue,stageTurn,b.input,continueAction)),
    when(b.read(v=>!v.get(performed)),b.return({action:null,performed:false,absorbed:0,blockSpent:0})),
    b.assign(result,query(receipt,b.input)),call(recordAction,{enemy:b.input,receipt:null}),
    ruleModules.runTaskGroup(actionQueue,finishAction,result),b.return(result),
  );});
  const takeTurn=defineEffect<number,boolean>(b=>{const result=b.local<EnemyActionReceipt>();return sequence(b.assign(result,call(takeTurnDetailed,b.input)),b.return(b.read(v=>v.get(result).performed)));});
  describeProgram(acted,'敌人本轮是否已进入行动');describeProgram(beforeIntent.public,'敌人意图执行前');
  describeProgram(staged.public,'敌人行动入队阶段结束后');describeProgram(completed.public,'敌人行动结算后');describeProgram(prepared.public,'敌人准备完成后');
  return{exports:{takeTurnDetailed,staged:staged.public,completed:completed.public,completionStages,kind,current,acted,revivals,finishRevival,forActor,live,eligible,intent,definitionHealth,metadata,presentation,prepare,prepared:prepared.public,setFlags,replaceMove,claim,choose,setMove,roll,noopRoll,openOpportunity,takeTurn,beforeIntent:beforeIntent.public}};
}});
