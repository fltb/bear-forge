import { typedValue } from './value.schemas.ts';
import {z} from 'zod';
import {rules} from './execution.ts';
export type RelicConfig={id:string;replaces?:RelicDefinition|undefined;install:rules.Effect<rules.EntityLifecycle,void>;interact?:rules.Effect<{entity:number;actor:number},void>|undefined};
export type RelicDefinition=rules.EntityDefinition<RelicConfig>;
const {defineRules,defineComponent,defineQuery,defineEffect,entityEffect,definitionOf,sequence,when,call,query,spawnEntity}=rules;
/** Relic contents supply installation code; this module contains no named relic behavior. */
export const relics=defineRules({requires:[],build(m){
  const ownership=m.own(defineComponent({schema:z.object({actor:z.number().int().nonnegative().nullable(),definition:typedValue<RelicDefinition>()}).nullable(),initial:()=>null}));
  const owned=defineQuery({input:z.number().int().nonnegative(),output:z.array(z.number().int().nonnegative()),reads:[ownership],base:(r,actor)=>r.entities(ownership).filter(id=>r.component(id,ownership)?.actor===actor)});
  const find=defineQuery({input:z.object({actor:z.number().int().nonnegative().nullable(),definition:typedValue<RelicDefinition>()}),output:z.number().int().nonnegative().nullable(),reads:[ownership],base:(r,i)=>{const ids=r.entities(ownership).filter(id=>{const s=r.component(id,ownership);return s!==null&&s.actor===i.actor&&r.sameDefinition(s.definition,i.definition);});if(ids.length>1)throw Error('Duplicate relic definition for actor');return ids[0]??null;}});
  const begin=m.atom({input:z.object({entity:z.number().int().nonnegative(),actor:z.number().int().nonnegative().nullable(),definition:typedValue<RelicDefinition>()}),output:z.undefined(),reads:[],writes:[ownership],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:ownership,value:{actor:i.actor,definition:i.definition}}],events:[],result:undefined};}});
  const initialize=defineEffect<rules.EntityLifecycle,void>(b=>sequence(
    when(b.read(v=>v.query(find,{actor:v.input.owner,definition:v.get(definitionOf(kind,v.input.entity))})!==null),b.return(b.read(()=>{throw Error('Relic is already owned');}))),
    call(begin,{entity:b.read(v=>v.input.entity),actor:b.read(v=>v.input.owner),definition:definitionOf(kind,b.read(v=>v.input.entity))}),call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.install),b.input),
  ));
  const kind:rules.EntityKind<RelicConfig>=m.kind({config:z.object({id:z.string(),replaces:typedValue<RelicDefinition>().optional(),install:typedValue<rules.Effect<rules.EntityLifecycle,void>>(),interact:typedValue<NonNullable<RelicConfig['interact']>>().optional()}),components:[ownership],initialize});
  const holder=defineQuery({input:z.number().int().nonnegative(),output:z.number().int().nonnegative(),reads:[ownership],base:(r,entity)=>{const owner=r.component(entity,ownership)?.actor;if(owner===null||owner===undefined)throw Error('Relic has no actor');return owner;}});
  const noInteraction=defineEffect<{entity:number;actor:number},void>(b=>b.return(b.read(()=>{throw Error('Relic has no interaction program');})));
  const interact=defineEffect<number,void>(b=>call(entityEffect(kind,b.input,c=>c.interact??noInteraction),{entity:b.input,actor:query(holder,b.input)}));
  const data=defineQuery({input:z.number().int().nonnegative(),output:z.int32(),base:()=>0});
  const sameDefinition=defineQuery({input:z.tuple([typedValue<RelicDefinition>(),typedValue<RelicDefinition>()]),output:z.boolean(),base:(r,pair)=>r.sameDefinition(pair[0],pair[1])});
  const view=defineQuery({input:z.number().int().nonnegative(),output:z.object({id:z.string(),data:z.int32()}),kinds:[kind],dependencies:[data],base:(r,id)=>({id:r.configuration(id,kind).id,data:r.query(data,id)})});
  const replacement=defineQuery({input:typedValue<RelicDefinition>(),output:typedValue<RelicDefinition>().nullable(),kinds:[kind],base:(r,definition)=>r.definitionConfiguration(definition,kind).replaces??null});
  const canObtain=defineQuery({input:z.object({actor:z.number().int().nonnegative(),definition:typedValue<RelicDefinition>()}),output:z.boolean(),dependencies:[find,replacement],base:(r,i)=>{
    if(r.query(find,i)!==null)return false;
    const previous=r.query(replacement,i.definition);
    return previous===null||r.query(find,{actor:i.actor,definition:previous})!==null;
  }});
  const obtain=defineEffect<{actor:number;definition:RelicDefinition;scope:number},number|null>(b=>{
    const previous=b.local<RelicDefinition|null>(),old=b.local<number|null>(),made=b.local<number>();
    return sequence(
      when(b.read(v=>!v.query(canObtain,{actor:v.input.actor,definition:v.input.definition})),b.return(null)),
      b.assign(previous,query(replacement,b.read(v=>v.input.definition))),
      when(b.read(v=>v.get(previous)!==null),sequence(
        b.assign(old,query(find,{actor:b.read(v=>v.input.actor),definition:b.read(v=>v.get(previous)!)})),
        rules.despawnEntity({entity:b.read(v=>v.get(old)!),reason:{replaced:true}}),
      )),
      b.assign(made,spawnEntity({kind,definition:b.read(v=>v.input.definition),owner:b.read(v=>v.input.actor),scope:b.read(v=>v.input.scope)})),b.return(made),
    );
  });
  return{exports:{kind,owned,find,data,view,obtain,canObtain,sameDefinition,holder,interact}};
}});
