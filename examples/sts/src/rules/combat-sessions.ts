import { typedValue } from './value.schemas.ts';
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {battles} from './battles.ts';
import {turns} from './turns.ts';
import {enemies} from './enemies.ts';
import {damage} from './damage.ts';
import {resources} from './resources.ts';
import {random} from './random.ts';
import {entityId} from './resources.schemas.ts';
import type {HitResult} from './damage.types.ts';
import type {HpLost} from './resources.types.ts';

export const battleStreamNames=['ai','cardRandom','misc','monsterHp','potion','shuffle'] as const;
const streamsSchema=z.object({ai:entityId,cardRandom:entityId,misc:entityId,monsterHp:entityId,potion:entityId,shuffle:entityId});
export const combatSessionSetupSchema=z.object({run:entityId,battle:entityId,controller:entityId,seed:z.bigint(),floor:z.int32(),ascension:z.int32(),encounter:z.int32(),streams:streamsSchema,roster:z.array(z.object({actor:entityId.nullable(),controller:entityId.nullable(),id:z.int32(),name:z.string(),miscInfo:z.int32(),initialized:z.boolean().optional()}))}).strict();
export type CombatSessionSetup=z.infer<typeof combatSessionSetupSchema>;
const stateSchema=combatSessionSetupSchema.extend({lastAttackUnblockedDamage:z.int32(),timesDamaged:z.int32(),haveUsedDiscoveryAction:z.boolean(),undefinedBehaviorEvoked:z.boolean(),selectionMetadata:z.object({pickCount:z.int32(),canPickZero:z.boolean(),canPickAnyNumber:z.boolean()})});
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,query,call,sequence,on,install}=rules;

/** Cross-owner identities and combat-only counters; health/cards remain in their own owners. */
export const combatSessions=defineRules({requires:[battles,turns,enemies,damage,random],build(m){
  const state=m.own(defineComponent({schema:stateSchema.nullable(),initial:()=>null}));
  const current=defineQuery({input:entityId,output:stateSchema,reads:[state],base:(r,id)=>{const s=r.component(id,state);if(s===null)throw Error('Uninitialized combat session');return s;}});
  const forRun=defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,run)=>{const ids=r.entities(state).filter(id=>r.component(id,state)?.run===run);if(ids.length>1)throw Error('Duplicate combat session');return ids[0]??null;}});
  const forBattle=defineQuery({input:entityId,output:entityId.nullable(),reads:[state],base:(r,battle)=>{const ids=r.entities(state).filter(id=>r.component(id,state)?.battle===battle);if(ids.length>1)throw Error('Duplicate combat session');return ids[0]??null;}});
  const validate=defineQuery({input:combatSessionSetupSchema,output:combatSessionSetupSchema,dependencies:[battles.exports.current,turns.exports.current,enemies.exports.current,random.exports.current,forRun,battles.exports.status],base:(r,i)=>{
    const b=r.query(battles.exports.status,i.battle);if(r.query(forRun,i.run)!==null||r.query(turns.exports.current,i.controller).battle!==i.battle||i.roster.filter(e=>e.actor!==null).length!==b.enemies.length||i.roster.some(e=>e.actor!==null&&(e.controller===null||!b.enemies.includes(e.actor)||r.query(enemies.exports.current,e.controller).actor!==e.actor)))throw Error('Invalid combat session');
    for(const stream of Object.values(i.streams))r.query(random.exports.current,stream);return i;
  }});
  const begin=m.atom({input:combatSessionSetupSchema.extend({entity:entityId}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){const {entity,...s}=i;return{writes:[{entity,component:state,value:{...s,lastAttackUnblockedDamage:0,timesDamaged:0,haveUsedDiscoveryAction:false,undefinedBehaviorEvoked:false,selectionMetadata:{pickCount:0,canPickZero:false,canPickAnyNumber:false}}}],events:[],result:undefined};}});
  const setRoster=m.atom({input:z.object({session:entityId,roster:combatSessionSetupSchema.shape.roster}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.session,state);if(s===null)throw Error('Missing combat session');return{writes:[{entity:i.session,component:state,value:{...s,roster:i.roster}}],events:[],result:undefined};}});
  const setAttack=m.atom({input:z.object({session:entityId,amount:z.int32()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.session,state);if(s===null)throw Error('Missing combat session');return{writes:[{entity:i.session,component:state,value:{...s,lastAttackUnblockedDamage:(i.amount<<16)>>16}}],events:[],result:undefined};}});
  const markDiscovery=m.atom({input:z.object({session:entityId,undefinedBehavior:z.boolean()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.session,state);if(s===null)throw Error('Missing combat session');return{writes:[{entity:i.session,component:state,value:{...s,haveUsedDiscoveryAction:true,undefinedBehaviorEvoked:s.undefinedBehaviorEvoked||i.undefinedBehavior}}],events:[],result:undefined};}});
  const setSelectionMetadata=m.atom({input:z.object({session:entityId,pickCount:z.int32().optional(),canPickZero:z.boolean().optional(),canPickAnyNumber:z.boolean().optional()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.session,state);if(s===null)throw Error('Missing combat session');return{writes:[{entity:i.session,component:state,value:{...s,selectionMetadata:{pickCount:i.pickCount??s.selectionMetadata.pickCount,canPickZero:i.canPickZero??s.selectionMetadata.canPickZero,canPickAnyNumber:i.canPickAnyNumber??s.selectionMetadata.canPickAnyNumber}}}],events:[],result:undefined};}});
  const countDamage=m.atom({input:entityId,output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,session){const s=r.component(session,state);if(s===null)throw Error('Missing combat session');return{writes:[{entity:session,component:state,value:{...s,timesDamaged:((s.timesDamaged+1)<<16)>>16}}],events:[],result:undefined};}});
  const attack=on(damage.exports.resolved,{condition:defineQuery({input:typedValue<rules.ReactionContext<HitResult>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>c.event.target===r.query(battles.exports.status,c.owner).actor&&c.event.attack}),effect:defineEffect<rules.ReactionContext<HitResult>,void>(b=>call(setAttack,{session:b.read(v=>v.input.source),amount:b.read(v=>v.input.event.unblocked)}))});
  const hp=on(resources.exports.hpLost,{condition:defineQuery({input:typedValue<rules.ReactionContext<HpLost>>(),output:z.boolean(),dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>c.event.entity===r.query(battles.exports.status,c.owner).actor&&c.event.amount>0}),effect:defineEffect<rules.ReactionContext<HpLost>,void>(b=>call(countDamage,b.read(v=>v.input.source)))});
  const initialize=defineEffect<rules.EntityLifecycle<CombatSessionSetup>,void>(b=>sequence(
    call(begin,b.read(v=>({...v.query(validate,v.input.setup),entity:v.input.entity}))),
    install({ability:attack,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.battle),environment:{},lifetime:b.read(v=>v.input.scope)}),
    install({ability:hp,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.battle),environment:{},lifetime:b.read(v=>v.input.scope)}),
  ));
  const kind=m.kind({config:z.undefined(),setup:combatSessionSetupSchema,components:[state],initialize});
  return{exports:{kind,current,forRun,forBattle,setRoster,markDiscovery,setSelectionMetadata}};
}});
