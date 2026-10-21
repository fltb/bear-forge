import {z} from 'zod';
import {typedValue} from './value.schemas.ts';
import {rules as core} from '@bear-forge/card-engine';

export const OriginKind={Entity:0,Ability:1,Card:2,EnemyAction:3,Replacement:4} as const;
const id=z.number().int().nonnegative();
export type Cause=OriginRecord[];
export type OriginRecord={identity:number;source:number|null;owner:number|null;registration:number|null;kind:0|1|2|3|4;action:number|null;installation:Cause};
export type Origin=Omit<OriginRecord,'identity'|'installation'|'action'>&{installation?:core.Borrowed<Cause>;action?:number|null};
export const originSchema=z.object({identity:id,source:id.nullable(),owner:id.nullable(),registration:id.nullable(),kind:z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),action:id.nullable(),installation:typedValue<Cause>()}).strict();
export const causeSchema=z.array(originSchema);

/** Game-rule state only; existing components, effects and queues own all state. */
export const effectTrace=core.defineRules({requires:[],build(m){
  const state=m.own(core.defineComponent({schema:z.object({next:id,active:causeSchema,owners:z.record(z.string(),z.object({owner:id.nullable(),active:z.boolean()}))}),initial:()=>({next:1,active:[],owners:{}})}));
  const marker=m.own(core.defineComponent({schema:z.literal(true),initial:()=>true as const}));
  const kind=m.kind({config:z.undefined(),components:[state,marker]});
  const definition=core.defineEntity(kind,undefined);
  const holder=core.defineQuery({input:z.undefined(),output:id.nullable(),reads:[marker],base:r=>{
    const entities=r.entities(marker);if(entities.length>1)throw Error('Multiple execution trace owners');return entities[0]??null;
  }});
  const current=core.defineQuery({input:z.undefined(),output:causeSchema,reads:[state],dependencies:[holder],base:r=>{
    const entity=r.query(holder,undefined);return entity===null?[]:r.component(entity,state).active;
  }});
  const write=m.atom({input:z.object({entity:id,cause:causeSchema}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){return{writes:[{entity:i.entity,component:state,value:{...r.component(i.entity,state),active:i.cause}}],events:[],result:undefined};}});
  const push=m.atom({input:z.object({entity:id,parent:causeSchema,origin:typedValue<Origin>()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){
    const previous=r.component(i.entity,state);return{writes:[{entity:i.entity,component:state,value:{...previous,next:previous.next+1,active:[...i.parent,{...i.origin,identity:previous.next,action:i.origin.action??null,installation:i.origin.installation??[]}]}}],events:[],result:undefined};
  }});
  const ensure=core.defineEffect<void,number>(b=>{const entity=b.local<number|null>();return core.sequence(
    b.assign(entity,core.query(holder,undefined)),core.when(b.read(v=>v.get(entity)===null),b.assign(entity,core.spawnEntity({definition,owner:null,scope:0}))),b.return(b.read(v=>v.get(entity)!)),
  );});
  const owner=core.defineQuery({input:id,output:id.nullable(),reads:[state],dependencies:[holder],base:(r,source)=>{const entity=r.query(holder,undefined);return entity===null?null:r.component(entity,state).owners[String(source)]?.owner??null;}});
  const remember=m.atom({input:z.object({entity:id,source:id,owner:id.nullable()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const before=r.component(i.entity,state);return{writes:[{entity:i.entity,component:state,value:{...before,owners:{...before.owners,[i.source]:{owner:i.owner,active:true}}}}],events:[],result:undefined};}});
  const bind=core.defineEffect<{source:number;owner:number|null},void>(b=>{const entity=b.local<number>();return core.sequence(b.assign(entity,core.call(ensure,undefined)),core.call(remember,{entity,source:b.read(v=>v.input.source),owner:b.read(v=>v.input.owner)}));});
  const present=core.defineQuery({input:id,output:z.boolean(),reads:[state],dependencies:[holder],base:(r,source)=>{const entity=r.query(holder,undefined);return entity!==null&&r.component(entity,state).owners[String(source)]?.active===true;}});
  const forget=m.atom({input:z.object({entity:id,source:id}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const before=r.component(i.entity,state),old=before.owners[String(i.source)];return{writes:old?[{entity:i.entity,component:state,value:{...before,owners:{...before.owners,[i.source]:{...old,active:false}}}}]:[],events:[],result:undefined};}});
  const depart=core.defineEffect<number,void>(b=>{const entity=b.local<number>();return core.sequence(b.assign(entity,core.call(ensure,undefined)),core.call(forget,{entity,source:b.input}));});
  const referenceSource=core.defineQuery({input:typedValue<{source:number}>(),output:id,base:(_r,i)=>i.source});
  const currentSource=core.defineQuery({input:z.undefined(),output:id.nullable(),dependencies:[current],base:(r)=>r.query(current,undefined).at(-1)?.source??null});
  const taskSource=core.defineQuery({input:typedValue<{reference:{source:number};requested:number|null|undefined}>(),output:id.nullable(),base:(_r,i)=>i.requested===undefined?i.reference.source:i.requested});
  return{exports:{current,ensure,write,push,owner,bind,referenceSource,currentSource,taskSource,present,depart}};
}});

/** Internal L2 boundary. A queued continuation resumes the captured chain;
 * entering another ability adds a child, rather than relabelling its parent. */
export function inCause<I,O>(effect:core.Effect<I,O>,parent:(v:core.ReadView<I>)=>core.Borrowed<Cause>,origin?:((v:core.ReadView<I>)=>Origin)):core.Effect<I,O>{
  return core.defineEffect<I,O>(b=>{const entity=b.local<number>(),previous=b.local<Cause>(),captured=b.local<Cause>(),result=b.local<O>();return core.sequence(
    b.assign(entity,core.call(effectTrace.exports.ensure,undefined)),
    b.assign(previous,core.query(effectTrace.exports.current,undefined)),b.assign(captured,b.read(parent)),
    origin?core.call(effectTrace.exports.push,{entity,parent:captured,origin:b.read(origin)}):core.call(effectTrace.exports.write,{entity,cause:captured}),
    b.assign(result,core.call(effect,b.input)),core.call(effectTrace.exports.write,{entity,cause:previous}),b.return(result),
  );});
}
export function fromSource<I,O>(effect:core.Effect<I,O>,origin:(v:core.ReadView<I>)=>Origin){
  return inCause(effect,v=>v.query(effectTrace.exports.current,undefined),origin);
}
