import {z} from 'zod';
import {rules} from './execution.ts';
import type {ruleModules} from '@bear-forge/card-engine';
import {entityId} from './resources.schemas.ts';
import {zoneMoveSchema,zoneMovedSchema,zoneContentsSchema,zoneReorderSchema} from './zones.schemas.ts';
import {withProbability} from '../../../../packages/card-engine/src/rules-probability.ts';
import {insertOrdered,removeOrdered,revealOrdered,revealPositions,randomInsertion,canonicalOrder,observeLastMatch,topOrderMasses,afterTop,prefixRepresentative,orderSize,orderAt,type OrderKnowledge} from './order-space.ts';
import type {AtomRead} from '../../../../packages/card-engine/src/rules-module.types.ts';
type Move=z.infer<typeof zoneMoveSchema>;
const {defineRules,defineComponent,defineEvent,defineCheckpoint,defineQuery,defineEffect,sequence,forEach,when,call,query}=rules;

/** One owner maintains both halves of membership; content cannot splice another pile directly. */
export const zones=defineRules({requires:[],build(m){
  const contents=m.own(defineComponent({schema:zoneContentsSchema,initial:()=>[]}));
  const massSchema=z.object({numerator:z.bigint().nonnegative(),denominator:z.bigint().positive()});
  const languageSchema=z.object({root:z.int32().nonnegative(),nodes:z.array(z.object({end:massSchema,edges:z.array(z.object({group:z.int32().nonnegative(),to:z.int32().nonnegative(),weight:massSchema}))}))});
  const orderSchema=z.object({language:languageSchema.optional(),blocks:z.array(zoneContentsSchema),resolved:z.boolean(),unsupported:z.boolean()});
  const knowledge=m.own(defineComponent({schema:orderSchema,initial:()=>({blocks:[],resolved:false,unsupported:false})}));
  const member=m.own(defineComponent({schema:entityId.nullable(),initial:()=>null}));
  const moved=m.own(defineEvent({payload:zoneMovedSchema,dispatch:'immediate'}));
  const reordered=m.own(defineEvent({payload:zoneReorderSchema,dispatch:'immediate'}));
  const moving=m.own(defineCheckpoint({input:zoneMoveSchema,output:zoneMoveSchema}));
  const dispose=defineEffect<rules.EntityLifecycle&{reason:unknown},void>(b=>b.return(b.read(v=>{
    if(v.query(members,v.input.entity).length!==0)throw Error('An occupied zone cannot be despawned');return undefined;
  })));
  const kind=m.kind({config:z.object({capacity:z.int32().nonnegative().nullable()}).strict(),components:[contents,knowledge],dispose});
  const members=defineQuery({input:entityId,output:zoneContentsSchema,reads:[contents],base:(r,entity)=>r.component(entity,contents)});
  const orderKnowledge=defineQuery({input:entityId,output:orderSchema,reads:[knowledge],base:(r,entity)=>r.component(entity,knowledge)});
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
  const commit=m.atom({input:zoneMoveSchema.extend({capacity:z.int32().nonnegative().nullable()}),output:z.boolean(),reads:[member,contents,knowledge],writes:[member,contents,knowledge],emits:[moved],run(r,input){
    const proposed=plan({location:id=>r.component(id,member),contents:id=>r.component(id,contents)},input,input.capacity);if(!proposed)throw Error('Illegal zone movement');
    const {capacity:_limit,...movement}=input;
    const changes:ruleModules.ComponentWrite<typeof member.public|typeof contents.public|typeof knowledge.public>[]=[...proposed.writes];
    const own=(zone:number)=>r.component(zone,knowledge) as OrderKnowledge;
    const from=input.from===null?null:removeOrdered(own(input.from),input.entity);
    if(input.from!==null)changes.push({entity:input.from,component:knowledge,value:from!});
    if(input.to!==null){
      const value=insertOrdered(input.from===input.to?from!:own(input.to),input.entity,input.index);
      if(input.from===input.to)changes.pop();
      changes.push({entity:input.to,component:knowledge,value});
    }
    return{writes:changes,events:[{event:moved,payload:{...movement,previousIndex:proposed.payload.previousIndex}}],result:true};
  }});
  const move=defineEffect<Move,boolean>(b=>{const checked=b.local<rules.ReplacementResult<Move>>(),result=b.local<boolean>();return sequence(
    b.assign(checked,m.resolve(moving,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(false)),
    b.assign(result,call(commit,b.read(v=>{
      const resolved=v.get(checked);if(resolved.kind==='cancel')throw Error('Canceled movement');
      return{...resolved.value,capacity:resolved.value.to===null?null:v.query(capacity,resolved.value.to)};
    }))),b.return(result),
  );});
  const reorder=m.atom({input:zoneReorderSchema,output:z.undefined(),reads:[contents,knowledge],writes:[contents,knowledge],emits:[reordered],run(r,input){
    const before=r.component(input.zone,contents);
    if(input.order.length!==before.length||new Set(input.order).size!==before.length||input.order.some(entity=>!before.includes(entity)))throw Error('Zone order must be a full permutation');
    const old=r.component(input.zone,knowledge);
    return{writes:[{entity:input.zone,component:contents,value:[...input.order]},{entity:input.zone,component:knowledge,value:{resolved:old.resolved,blocks:input.order.map(id=>[id]),unsupported:old.unsupported||old.language!==undefined||old.blocks.some(block=>block.length>1)}}],events:[{event:reordered,payload:input}],result:undefined};
  }});
  const partitionSchema=z.object({zone:entityId,language:languageSchema.optional(),blocks:z.array(zoneContentsSchema),unsupported:z.boolean()});
  function partitionWrites(input:rules.Borrowed<z.infer<typeof partitionSchema>>,resolved:boolean){
    return{writes:[{entity:input.zone,component:knowledge,value:{blocks:input.blocks.map(block=>[...block]),resolved,unsupported:input.unsupported,...(input.language?{language:input.language}:{})}}],events:[],result:undefined};
  }
  // The original permutation has already been expanded by the random kernel.
  // Concealment changes player knowledge, not the realized order in a branch.
  // Reopening this law would draw a SECOND independent permutation and lose
  // correlations with any earlier observer (including the caller itself).
  // Normal execution keeps unresolved knowledge for a future search root;
  // probability execution retains its already-materialized joint outcome.
  const conceal=withProbability(m.atom({input:partitionSchema,output:z.undefined(),reads:[],writes:[knowledge],emits:[],run:(_r,i)=>partitionWrites(i,false)}),{
    space:()=>({kind:'uniform',size:1n}),run:(_r,i)=>partitionWrites(i,true),
  });
  const memberKeys=z.array(z.object({entity:entityId,key:z.number()})).readonly();
  const revealInput=z.object({zone:entityId,count:z.int32().nonnegative(),keys:memberKeys});
  const revealRun=(r:AtomRead<any>,i:rules.Borrowed<z.infer<typeof revealInput>>)=>({writes:[{entity:i.zone,component:knowledge,value:revealOrdered(r.component(i.zone,knowledge) as OrderKnowledge,r.component(i.zone,contents),i.count)}],events:[],result:undefined});
  const reveal=withProbability(m.atom({input:revealInput,output:z.undefined(),reads:[contents,knowledge],writes:[knowledge],emits:[],run:revealRun}),{
    space:()=>({kind:'uniform',size:1n}),run:revealRun,
    // The original reveal defines the public scope; never read its suffix.
    publication:(r,i)=>{
      const keys=new Map(i.keys.map(row=>[row.entity,row.key]));
      const top=i.count===0?[]:(r.component(i.zone,contents) as readonly number[]).slice(-i.count).toReversed();
      return{kind:'ordered-prefix',orderedMembers:top.map(entity=>keys.get(entity)!)};
    },
  });
  const revealMembers=m.atom({input:z.object({zone:entityId,members:zoneContentsSchema}),output:z.undefined(),reads:[contents,knowledge],writes:[knowledge],emits:[],run(r,i){
    const actual=r.component(i.zone,contents),positions=i.members.map(id=>actual.indexOf(id));
    return{writes:[{entity:i.zone,component:knowledge,value:revealPositions(r.component(i.zone,knowledge) as OrderKnowledge,actual,positions)}],events:[],result:undefined};
  }});
  const observeMatch=m.atom({input:z.object({zone:entityId,matching:zoneContentsSchema,selected:entityId.nullable()}),output:z.undefined(),reads:[knowledge],writes:[knowledge],emits:[],run(r,i){
    return{writes:[{entity:i.zone,component:knowledge,value:observeLastMatch(r.component(i.zone,knowledge) as OrderKnowledge,i.matching,i.selected)}],events:[],result:undefined};
  }});
  const obscureInput=z.object({zone:entityId,entity:entityId,slots:z.int32().positive()});
  const obscure=withProbability(m.atom({input:obscureInput,output:z.undefined(),reads:[knowledge],writes:[knowledge],emits:[],run(r,i){return{writes:[{entity:i.zone,component:knowledge,value:randomInsertion(r.component(i.zone,knowledge) as OrderKnowledge,i.entity,i.slots)}],events:[],result:undefined};}}),{
    space:()=>({kind:'uniform',size:1n}),run:(r,i)=>({writes:[{entity:i.zone,component:knowledge,value:{...r.component(i.zone,knowledge),resolved:true}}],events:[],result:undefined}),
  });
  // Real execution already owns its actual order. Only probability execution
  // enters this sorting kernel; no card or enemy rule is interpreted here.
  const probabilityOrder=withProbability(m.atom({input:z.undefined(),output:z.boolean(),reads:[],writes:[],emits:[],run:()=>({writes:[],events:[],result:false})}),{
    space:()=>({kind:'uniform',size:1n}),run:()=>({writes:[],events:[],result:true}),
  });
  const chooseTop=withProbability(m.atom({input:orderSchema,output:entityId,reads:[],writes:[],emits:[],run:()=>{throw Error('Probability ordering requires its kernel');}}),{
    space:i=>({kind:'rational',weights:topOrderMasses(i).map(row=>row.mass)}),
    run:(_r,i,coordinate)=>{
      const choice=topOrderMasses(i)[Number(coordinate)]!;
      return{writes:[],events:[],result:choice.entity};
    },
  });
  // An unconstrained block of n members has n! equiprobable complete orders.
  // The product coordinate replaces only unobserved sorting-internal choices;
  // no original callback runs between them. Prefixes and conditional languages
  // still use chooseTop, retaining their conditional suffixes below.
  const chooseFull=withProbability(m.atom({input:orderSchema,output:zoneContentsSchema,reads:[],writes:[],emits:[],run:()=>{throw Error('Probability ordering requires its kernel');}}),{
    space:i=>({kind:'uniform',size:orderSize(i.blocks)}),
    run:(_r,i,coordinate)=>({writes:[],events:[],result:orderAt(i.blocks,coordinate).toReversed()}),
  });
  const commitOrder=m.atom({input:z.object({zone:entityId,original:orderSchema,top:zoneContentsSchema,full:z.boolean()}),output:z.undefined(),reads:[],writes:[contents,knowledge],emits:[],run(_r,i){
    const original={...i.original,blocks:i.original.blocks.map(block=>[...block])};
    return{writes:[{entity:i.zone,component:contents,value:i.full?[...i.top].reverse():prefixRepresentative(original,i.top)},
      ...(i.full?[{entity:i.zone,component:knowledge,value:{...original,resolved:true}}]:[])],events:[],result:undefined};
  }});
  const resolveOrder=defineEffect<{zone:number;keys:readonly {entity:number;key:number}[];top?:number},void>(b=>{
    const enabled=b.local<boolean>(),original=b.local<OrderKnowledge>(),remaining=b.local<OrderKnowledge>(),top=b.local<number[]>(),chosen=b.local<number>();
    return sequence(b.assign(original,query(orderKnowledge,b.read(v=>v.input.zone))),
      when(b.read(v=>v.input.top!==0&&!v.get(original).resolved&&(v.get(original).unsupported||v.get(original).language!==undefined||v.get(original).blocks.some(block=>block.length>1))),sequence(
        b.assign(enabled,call(probabilityOrder,undefined)),when(enabled,sequence(
          b.assign(original,b.read(v=>{
            const keys=new Map(v.input.keys.map(item=>[item.entity,item.key]));
            return canonicalOrder(v.get(original),keys);
          })),b.assign(remaining,original),b.assign(top,[]),
          // A branch retains these locals at each chance stop. The next draw
          // conditions on the chosen prefix; neither the prefix nor its rule
          // effects are executed again when the frontier resumes.
          when(b.read(v=>v.input.top===undefined&&!v.get(original).unsupported&&v.get(original).language===undefined),
            b.assign(top,call(chooseFull,original)),
            forEach(b.read(v=>Array.from({length:Math.min(v.input.top??Infinity,v.get(original).blocks.reduce((sum,block)=>sum+block.length,0))})),()=>sequence(
              b.assign(chosen,call(chooseTop,remaining)),
              b.assign(top,b.read(v=>[...v.get(top),v.get(chosen)])),
              b.assign(remaining,b.read(v=>afterTop(v.get(remaining),v.get(chosen)))),
            )),
          ),
          call(commitOrder,{zone:b.read(v=>v.input.zone),original,top,full:b.read(v=>v.input.top===undefined)}),
        )),
      )),
    );
  });
  return{exports:{kind,member:member.public,members,orderKnowledge,conceal,reveal,revealMembers,observeMatch,obscure,resolveOrder,location,capacity,canMove,move,reorder,moving:moving.public,moved:moved.public,reordered:reordered.public}};
}});
