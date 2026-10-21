import { typedValue } from './value.schemas.ts';
import {z} from 'zod';
import {rules} from './execution.ts';
import {enemies} from './enemies.ts';
import {random} from './random.ts';
import {entityId} from './resources.schemas.ts';
import {encounterSetupSchema,encounterRosterSchema,type EncounterSetup,type EncounterEnemy} from './encounters.schemas.ts';
import type {EnemyDefinition} from './enemies.types.ts';
export type EncounterConfig={assemble:rules.Effect<EncounterSetup,(EncounterEnemy|null)[]>};
export type EncounterDefinition=rules.EntityDefinition<EncounterConfig,EncounterSetup>;
const {defineRules,defineComponent,defineEffect,defineQuery,entityEffect,sequence,call}=rules;
/** An encounter is a composed roster program; source encounter IDs are catalog metadata only. */
export const encounters=defineRules({requires:[enemies,random],build(m){
  const roster=m.own(defineComponent({schema:encounterRosterSchema.nullable(),initial:()=>null}));
  const save=m.atom({input:z.object({entity:entityId,roster:encounterRosterSchema}),output:z.undefined(),reads:[],writes:[roster],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:roster,value:i.roster}],events:[],result:undefined};}});
  const initialize=defineEffect<rules.EntityLifecycle<EncounterSetup>,void>(b=>{const result=b.local<(EncounterEnemy|null)[]>();return sequence(b.assign(result,call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.assemble),b.read(v=>v.input.setup))),call(save,{entity:b.read(v=>v.input.entity),roster:result}));});
  const kind:rules.EntityKind<EncounterConfig,EncounterSetup>=m.kind({config:z.object({assemble:typedValue<EncounterConfig['assemble']>()}).strict(),setup:encounterSetupSchema,components:[roster],initialize});
  const current=defineQuery({input:entityId,output:encounterRosterSchema,reads:[roster],base:(r,entity)=>{const list=r.component(entity,roster);if(list===null)throw Error('Encounter roster is incomplete');return list;}});
  return{exports:{kind,current}};
}});
