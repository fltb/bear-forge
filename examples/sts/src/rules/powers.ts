import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {entityId} from './resources.schemas.ts';
import {powerChangeSchema,powerMutableSchema,powerStateSchema,powerSetupSchema,powerDefinitionSchema,powerEntrySchema,registrySchema,powerApplySchema,powerMergeSchema,powerReductionSchema,powerChangedSchema,polaritySchema} from './powers.schemas.ts';
import type {PowerConfig,PowerSetup,PowerLifecycle,PowerRemoval,PowerMerged,PowerState,PowerApplication,PowerMutable,PowerPresentation} from './powers.types.ts';
const {defineRules,defineComponent,defineEvent,defineCheckpoint,defineQuery,defineEffect,sequence,when,call,query,entityEffect,definitionOf,spawnEntity,despawnEntity,forEach}=rules;
export const PowerPhase={Creating:0,Attached:1,Removing:2} as const;

/** Generic status instances. Named game powers provide typed queries and hooks in the content layer. */
export const powers=defineRules({requires:[],build(m){
  const raw=m.own(defineComponent({schema:powerStateSchema,initial:()=>({registry:0,actor:0,phase:0 as const,level:0,active:false,justApplied:false})}));
  const registry=m.own(defineComponent({schema:registrySchema,initial:()=>({accepting:true,entries:[]})}));
  const changed=m.own(defineEvent({payload:powerChangedSchema,dispatch:'immediate'}));
  const applied=m.own(defineEvent({payload:z.object({entity:entityId,application:powerApplySchema}),dispatch:'immediate'}));
  const announceApplied=m.atom({input:z.object({entity:entityId,application:powerApplySchema}),output:z.undefined(),reads:[],writes:[],emits:[applied],run(_r,payload){return{writes:[],events:[{event:applied,payload}],result:undefined};}});
  const attached=m.own(defineEvent({payload:z.object({entity:entityId,state:powerStateSchema}),dispatch:'immediate'}));
  const immunity={},consumption={},transform={},stages={immunity,consumption,transform};
  const beforeApply=m.own(defineCheckpoint({input:powerApplySchema,output:powerApplySchema,order:{phases:[{phase:immunity,before:[consumption]},{phase:consumption,before:[transform]},{phase:transform}],default:transform}}));
  const emptyDetach=defineEffect<PowerRemoval,void>(b=>b.return(undefined)),emptyMerged=defineEffect<PowerMerged,void>(b=>b.return(undefined));
  const register=m.atom({input:z.object({entity:entityId,definition:powerDefinitionSchema,state:powerStateSchema}),output:z.undefined(),reads:[registry,raw],writes:[registry,raw],emits:[],run(r,input){
    const before=r.component(input.state.registry,registry);if(!before.accepting)throw Error('Status registry is closing');
    return{writes:[{entity:input.entity,component:raw,value:input.state},{entity:input.state.registry,component:registry,value:{...before,entries:[...before.entries,{entity:input.entity,definition:input.definition}]}}],events:[],result:undefined};
  }});
  const activate=m.atom({input:entityId,output:z.undefined(),reads:[raw],writes:[raw],emits:[attached],run(r,entity){
    const before=r.component(entity,raw);if(before.phase!==PowerPhase.Creating)throw Error('Status activation must occur once');
    const after={...before,phase:PowerPhase.Attached};return{writes:[{entity,component:raw,value:after}],events:[{event:attached,payload:{entity,state:after}}],result:undefined};
  }});
  const beginRemoval=m.atom({input:entityId,output:z.undefined(),reads:[raw],writes:[raw],emits:[changed],run(r,entity){
    const before=r.component(entity,raw),after={...before,phase:PowerPhase.Removing};
    return{writes:[{entity,component:raw,value:after}],events:[{event:changed,payload:{entity,before,after}}],result:undefined};
  }});
  const unregister=m.atom({input:entityId,output:z.undefined(),reads:[raw,registry],writes:[registry],emits:[],run(r,entity){
    const status=r.component(entity,raw),before=r.component(status.registry,registry);
    return{writes:[{entity:status.registry,component:registry,value:{...before,entries:before.entries.filter(x=>x.entity!==entity)}}],events:[],result:undefined};
  }});
  const find=defineQuery({input:z.object({registry:entityId,actor:entityId,definition:powerDefinitionSchema}),output:entityId.nullable(),reads:[registry,raw],base:(r,input)=>{
    const candidates=r.component(input.registry,registry).entries.filter(entry=>r.sameDefinition(entry.definition,input.definition)&&r.component(entry.entity,raw).actor===input.actor&&r.component(entry.entity,raw).phase!==PowerPhase.Removing);
    if(candidates.length>1)throw Error('Duplicate active status definition');return candidates[0]?.entity??null;
  }});
  const initialize=defineEffect<PowerLifecycle,void>(b=>{const valid=b.local<void>();return sequence(
    b.assign(valid,b.read(v=>{if(v.input.owner!==v.input.setup.actor)throw Error('Status owner must match its actor');return undefined;})),
    call(register,{entity:b.read(v=>v.input.entity),definition:definitionOf(kind,b.read(v=>v.input.entity)),state:query(initialState,{entity:b.read(v=>v.input.entity),setup:b.read(v=>v.input.setup),definition:definitionOf(kind,b.read(v=>v.input.entity))})}),
    call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.attach),b.input),call(activate,b.read(v=>v.input.entity)),
  );});
  const presentationSchema=z.object({key:z.int32().nonnegative(),flag:z.boolean(),slot:z.union([z.literal(0),z.literal(1)]).optional(),side:z.union([z.literal(0),z.literal(1)]).optional()}).strict();
  const kind:rules.EntityKind<PowerConfig,PowerSetup>=m.kind({config:z.object({
    presentation:presentationSchema.optional(),admit:z.custom<NonNullable<PowerConfig['admit']>>().optional(),
    remove:z.custom<NonNullable<PowerConfig['remove']>>().optional(),
    initial:z.custom<PowerConfig['initial']>(),merge:z.custom<PowerConfig['merge']>(),reduce:z.custom<PowerConfig['reduce']>(),polarity:z.custom<PowerConfig['polarity']>(),attach:z.custom<PowerConfig['attach']>(),
    detach:z.custom<NonNullable<PowerConfig['detach']>>().optional(),merged:z.custom<NonNullable<PowerConfig['merged']>>().optional(),
  }).strict(),setup:powerSetupSchema,components:[raw],initialize,
    dispose:defineEffect<PowerRemoval,void>(b=>sequence(call(beginRemoval,b.read(v=>v.input.entity)),call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.detach??emptyDetach),b.input),call(unregister,b.read(v=>v.input.entity)))),
  });
  const initialSelection={kind,select:(c:Readonly<PowerConfig>)=>c.initial},mergeSelection={kind,select:(c:Readonly<PowerConfig>)=>c.merge},reduceSelection={kind,select:(c:Readonly<PowerConfig>)=>c.reduce},polaritySelection={kind,select:(c:Readonly<PowerConfig>)=>c.polarity};
  const alwaysAdmit=defineQuery({input:z.object({actor:entityId,change:powerChangeSchema}),output:z.boolean(),base:()=>true});
  const defaultRemoval=defineQuery({input:powerStateSchema,output:powerMutableSchema,base:(_r,c)=>({level:c.level,active:false,justApplied:c.justApplied})});
  const removeSelection={kind,select:(c:Readonly<PowerConfig>)=>c.remove??defaultRemoval};
  const admitSelection={kind,select:(c:Readonly<PowerConfig>)=>c.admit??alwaysAdmit};
  const admitted=defineQuery({input:powerApplySchema,output:z.boolean(),selections:[admitSelection],base:(r,input)=>r.selectedDefinition(admitSelection,input.definition,{actor:input.actor,change:{amount:input.amount,source:input.source,debuff:input.debuff}})});
  const initialState=defineQuery({input:z.object({entity:entityId,setup:powerSetupSchema,definition:powerDefinitionSchema}),output:powerStateSchema,selections:[initialSelection],dependencies:[find],base:(r,input)=>{
    if(r.query(find,{registry:input.setup.registry,actor:input.setup.actor,definition:input.definition})!==null)throw Error('Duplicate active status definition');
    return{...r.selected(initialSelection,input.entity,{amount:input.setup.amount,source:input.setup.source,debuff:input.setup.debuff,skipFirstDecay:input.setup.skipFirstDecay}),registry:input.setup.registry,actor:input.setup.actor,phase:PowerPhase.Creating};
  }});
  const current=defineQuery({input:entityId,output:powerStateSchema,reads:[raw],base:(r,entity)=>r.component(entity,raw)});
  const presentation=defineQuery({input:entityId,output:presentationSchema.nullable(),kinds:[kind],base:(r,entity)=>r.configuration(entity,kind).presentation??null});
  const enabled=defineQuery({input:entityId,output:z.boolean(),reads:[raw],base:(r,entity)=>{const state=r.component(entity,raw);return state.phase===PowerPhase.Attached&&state.active;}});
  const level=defineQuery({input:entityId,output:z.int32(),reads:[raw],dependencies:[enabled],base:(r,entity)=>r.query(enabled,entity)?r.component(entity,raw).level:0});
  const polarity=defineQuery({input:entityId,output:polaritySchema,reads:[raw],selections:[polaritySelection],base:(r,entity)=>r.selected(polaritySelection,entity,r.component(entity,raw))});
  const entries=defineQuery({input:entityId,output:z.array(powerEntrySchema),reads:[registry],base:(r,entity)=>r.component(entity,registry).entries});
  const accepting=defineQuery({input:entityId,output:z.boolean(),reads:[registry],base:(r,entity)=>r.component(entity,registry).accepting});
  const patch=m.atom({input:z.object({entity:entityId,next:powerMutableSchema}),output:powerChangedSchema,reads:[raw],writes:[raw],emits:[changed],run(r,input){
    const before=r.component(input.entity,raw);if(before.phase===PowerPhase.Removing)throw Error('Cannot update a departing status');
    const after={...before,...input.next},result={entity:input.entity,before,after};return{writes:[{entity:input.entity,component:raw,value:after}],events:[{event:changed,payload:result}],result};
  }});
  const nextMerge=defineQuery({input:z.object({entity:entityId,change:powerChangeSchema}),output:powerMutableSchema,reads:[raw],selections:[mergeSelection],base:(r,input)=>r.selected(mergeSelection,input.entity,{state:r.component(input.entity,raw),change:input.change})});
  const merge=defineEffect<{entity:number;change:z.infer<typeof powerChangeSchema>},void>(b=>{
    const result=b.local<z.infer<typeof powerChangedSchema>>();return sequence(
      b.assign(result,call(patch,{entity:b.read(v=>v.input.entity),next:query(nextMerge,b.input)})),
      call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.merged??emptyMerged),b.read(v=>({...v.get(result),change:v.input.change}))),
    );
  });
  const nextReduction=defineQuery({input:z.object({entity:entityId,amount:z.int32().nonnegative()}),output:powerMutableSchema,reads:[raw],selections:[reduceSelection],base:(r,input)=>r.selected(reduceSelection,input.entity,{state:r.component(input.entity,raw),amount:input.amount})});
  const decrement=defineEffect<{entity:number;amount:number},void>(b=>call(patch,{entity:b.read(v=>v.input.entity),next:query(nextReduction,b.input)}));
  const deactivate=defineEffect<number,void>(b=>call(patch,{entity:b.input,next:b.read(v=>{const state=v.get(query(current,v.input));return{level:state.level,active:false,justApplied:state.justApplied};})}));
  const removalValue=defineQuery({input:entityId,output:powerMutableSchema,reads:[raw],selections:[removeSelection],base:(r,entity)=>r.selected(removeSelection,entity,r.component(entity,raw))});
  const remove=defineEffect<number,void>(b=>call(patch,{entity:b.input,next:query(removalValue,b.input)}));
  const clearJustApplied=defineEffect<number,void>(b=>call(patch,{entity:b.input,next:b.read(v=>{const state=v.get(query(current,v.input));return{level:state.level,active:state.active,justApplied:false};})}));
  const set=defineEffect<{entity:number;next:PowerMutable},void>(b=>call(patch,b.input));
  const apply=defineEffect<PowerApplication,number|null>(b=>{
    const checked=b.local<rules.ReplacementResult<PowerApplication>>(),request=b.local<PowerApplication>(),existing=b.local<number|null>(),created=b.local<number>();
    return sequence(when(b.read(v=>!v.get(query(admitted,v.input))),b.return(null)),b.assign(checked,m.resolve(beforeApply,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(null)),
      b.assign(request,b.read(v=>{const result=v.get(checked);if(result.kind==='cancel')throw Error('Canceled status application');if(!v.get(query(accepting,result.value.registry)))throw Error('Status registry is closing');return result.value;})),
      when(b.read(v=>!v.get(query(admitted,v.get(request)))),b.return(null)),b.assign(existing,query(find,{registry:b.read(v=>v.get(request).registry),actor:b.read(v=>v.get(request).actor),definition:b.read(v=>v.get(request).definition)})),
      when(b.read(v=>v.get(existing)!==null),sequence(call(merge,{entity:b.read(v=>v.get(existing)!),change:b.read(v=>{const r=v.get(request);return{amount:r.amount,source:r.source,debuff:r.debuff,skipFirstDecay:r.skipFirstDecay};})}),call(announceApplied,{entity:b.read(v=>v.get(existing)!),application:request}),b.return(existing))),
      b.assign(created,spawnEntity({kind,definition:b.read(v=>v.get(request).definition),owner:b.read(v=>v.get(request).actor),scope:b.read(v=>v.get(request).scope),setup:b.read(v=>{const r=v.get(request);return{registry:r.registry,actor:r.actor,amount:r.amount,source:r.source,debuff:r.debuff,skipFirstDecay:r.skipFirstDecay};})})),call(announceApplied,{entity:created,application:request}),b.return(created),
    );
  });
  const stopRegistry=m.atom({input:entityId,output:z.undefined(),reads:[registry],writes:[registry],emits:[],run(r,entity){return{writes:[{entity,component:registry,value:{...r.component(entity,registry),accepting:false}}],events:[],result:undefined};}});
  const registryKind=m.kind({config:z.undefined(),components:[registry],dispose:defineEffect<rules.EntityLifecycle&{reason:unknown},void>(b=>sequence(
    call(stopRegistry,b.read(v=>v.input.entity)),forEach(query(entries,b.read(v=>v.input.entity)),entry=>despawnEntity({entity:b.read(v=>v.get(entry).entity),reason:{registryClosed:true}})),
    b.return(b.read(v=>{if(v.get(query(entries,v.input.entity)).length!==0)throw Error('Status registry cleanup did not finish');return undefined;})),
  ))});
  return{exports:{kind,registryKind,current,presentation,enabled,level,polarity,entries,find,apply,merge,decrement,deactivate,remove,clearJustApplied,set,changed:changed.public,attached:attached.public,applied:applied.public,beforeApply:beforeApply.public,stages}};
}});
