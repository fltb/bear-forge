import { typedValue } from './value.schemas.ts';
import {z} from 'zod';
import {rules} from './execution.ts';
import {entityId} from './resources.schemas.ts';
export type ConsumableUse={battle:number;actor:number;target:number|null;multiplier:1|2};
export type ConsumableConfig={targeted:boolean;allowed:rules.Query<ConsumableUse,boolean>;use:rules.Effect<ConsumableUse,void>};
export type ConsumableDefinition=rules.EntityDefinition<ConsumableConfig,ConsumableUse>;
export const consumableUseSchema=z.object({battle:entityId,actor:entityId,target:entityId.nullable(),multiplier:z.union([z.literal(1),z.literal(2)])}).strict();
/** A consumed item's static entry is selected by a typed definition, through the ordinary entity lifecycle. */
export const consumables=rules.defineRules({requires:[],build(m){
  const kind:rules.EntityKind<ConsumableConfig,ConsumableUse>=m.kind({config:z.object({targeted:z.boolean(),allowed:typedValue<ConsumableConfig['allowed']>(),use:typedValue<ConsumableConfig['use']>()}).strict(),setup:consumableUseSchema,components:[],initialize:rules.defineEffect<rules.EntityLifecycle<ConsumableUse>,void>(b=>rules.call(rules.entityEffect(kind,b.read(v=>v.input.entity),c=>c.use),b.read(v=>v.input.setup)))});
  const selection={kind,select:(c:rules.Borrowed<ConsumableConfig>)=>c.allowed};
  const allowed=rules.defineQuery({input:z.object({definition:typedValue<ConsumableDefinition>(),input:consumableUseSchema}),output:z.boolean(),selections:[selection],base:(r,i)=>r.selectedDefinition(selection,i.definition,i.input)});
  const targeted=rules.defineQuery({input:typedValue<ConsumableDefinition>(),output:z.boolean(),kinds:[kind],base:(r,definition)=>r.definitionConfiguration(definition,kind).targeted});
  return{exports:{kind,allowed,targeted}};
}});
