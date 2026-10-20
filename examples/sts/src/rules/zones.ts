import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import type {ruleModules} from '@bear-forge/card-engine';
import {entityId} from './resources.schemas.ts';
import {zoneMoveSchema,zoneMovedSchema,zoneContentsSchema,zoneReorderSchema} from './zones.schemas.ts';
type Move=z.infer<typeof zoneMoveSchema>;
const {defineRules,defineComponent,defineEvent,defineCheckpoint,defineQuery,defineEffect,sequence,when,call}=rules;

/** One owner maintains both halves of membership; content cannot splice another pile directly. */
export const zones=defineRules({requires:[],build(m){
  const contents=m.own(defineComponent({schema:zoneContentsSchema,initial:()=>[]}));
  const member=m.own(defineComponent({schema:entityId.nullable(),initial:()=>null}));
  const moved=m.own(defineEvent({payload:zoneMovedSchema,dispatch:'immediate'}));
  const reordered=m.own(defineEvent({payload:zoneReorderSchema,dispatch:'immediate'}));
  const moving=m.own(defineCheckpoint({input:zoneMoveSchema,output:zoneMoveSchema}));
  const dispose=defineEffect<rules.EntityLifecycle&{reason:unknown},void>(b=>b.return(b.read(v=>{
    if(v.get(rules.query(members,v.input.entity)).length!==0)throw Error('An occupied zone cannot be despawned');return undefined;
  })));
  const kind=m.kind({config:z.object({capacity:z.int32().nonnegative().nullable()}).strict(),components:[contents],dispose});
  const members=defineQuery({input:entityId,output:zoneContentsSchema,reads:[contents],base:(r,entity)=>r.component(entity,contents)});
  const location=defineQuery({input:entityId,output:entityId.nullable(),reads:[member],base:(r,entity)=>r.component(entity,member)});
  const capacity=defineQuery({input:entityId,output:z.int32().nonnegative().nullable(),kinds:[kind],base:(r,entity)=>r.configuration(entity,kind).capacity});
  type Read={location:(entity:number)=>number|null;contents:(entity:number)=>readonly number[]};
  function plan(r:Read,input:Move,limit:number|null){
    if(input.from===null&&input.to===null||r.location(input.entity)!==input.from)return null;
    const from=input.from===null?[]:[...r.contents(input.from)],oldIndex=from.indexOf(input.entity);
    if(input.from!==null&&(oldIndex<0||from.lastIndexOf(input.entity)!==oldIndex))return null;
    if(oldIndex>=0)from.splice(oldIndex,1);
    const to=input.to===input.from?from:input.to===null?[]:[...r.contents(input.to)];
    if(to.includes(input.entity)||input.index>to.length||input.to===null&&input.index!==0||input.to!==null&&limit!==null&&to.length>=limit)return null;
    if(input.to!==null)to.splice(input.index,0,input.entity);
    const writes:ruleModules.ComponentWrite<typeof member.public|typeof contents.public>[]=[{entity:input.entity,component:member,value:input.to}];
    if(input.from!==null)writes.push({entity:input.from,component:contents,value:from});
    if(input.to!==null&&input.to!==input.from)writes.push({entity:input.to,component:contents,value:to});
    return{writes,payload:{...input,previousIndex:oldIndex}};
  }
  const canMove=defineQuery({input:zoneMoveSchema,output:z.boolean(),reads:[member,contents],dependencies:[capacity],base:(r,input)=>plan({location:id=>r.component(id,member),contents:id=>r.component(id,contents)},input,input.to===null?null:r.query(capacity,input.to))!==null});
  const commit=m.atom({input:zoneMoveSchema.extend({capacity:z.int32().nonnegative().nullable()}),output:z.boolean(),reads:[member,contents],writes:[member,contents],emits:[moved],run(r,input){
    const proposed=plan({location:id=>r.component(id,member),contents:id=>r.component(id,contents)},input,input.capacity);if(!proposed)throw Error('Illegal zone movement');
    const {capacity:_limit,...movement}=input;
    return{writes:proposed.writes,events:[{event:moved,payload:{...movement,previousIndex:proposed.payload.previousIndex}}],result:true};
  }});
  const move=defineEffect<Move,boolean>(b=>{const checked=b.local<rules.ReplacementResult<Move>>(),result=b.local<boolean>();return sequence(
    b.assign(checked,m.resolve(moving,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(false)),
    b.assign(result,call(commit,b.read(v=>{
      const resolved=v.get(checked);if(resolved.kind==='cancel')throw Error('Canceled movement');
      return{...resolved.value,capacity:resolved.value.to===null?null:v.get(rules.query(capacity,resolved.value.to))};
    }))),b.return(result),
  );});
  const reorder=m.atom({input:zoneReorderSchema,output:z.undefined(),reads:[contents],writes:[contents],emits:[reordered],run(r,input){
    const before=r.component(input.zone,contents);
    if(input.order.length!==before.length||new Set(input.order).size!==before.length||input.order.some(entity=>!before.includes(entity)))throw Error('Zone order must be a full permutation');
    return{writes:[{entity:input.zone,component:contents,value:[...input.order]}],events:[{event:reordered,payload:input}],result:undefined};
  }});
  return{exports:{kind,member:member.public,members,location,capacity,canMove,move,reorder,moving:moving.public,moved:moved.public,reordered:reordered.public}};
}});
