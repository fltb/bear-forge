import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {zones} from './zones.ts';
import {entityId} from './resources.schemas.ts';
import {cardMutableSchema,cardStateSchema,cardSetupSchema,cardChangeSchema,cardEvaluationSchema,metadataSchema,variantSchema,combatCardSchema,int8,int16} from './card-instances.schemas.ts';
import type {CardConfig,CardMutable,CardSetup,CardState} from './card-instances.types.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineCheckpoint,defineEffect,sequence,when,call,query,entityEffect,definitionOf,spawnEntity}=rules;
const signed8=(n:number)=>(n<<24)>>24;
export const CardMode={Permanent:0,Combat:1} as const;

/** Card instance storage and lifetime. Every specific card effect and upgrade policy is content. */
export const cardInstances=defineRules({requires:[zones],build(m){
  const state=m.own(defineComponent({schema:cardStateSchema,initial:()=>({mode:0 as const,master:null,uniqueId:-1,specialData:0,cost:0,costForTurn:0,upgraded:false,freeToPlayOnce:false,retain:false})}));
  const changed=m.own(defineEvent({payload:cardChangeSchema,dispatch:'immediate'}));
  const upgraded=m.own(defineEvent({payload:cardChangeSchema,dispatch:'immediate'}));
  const beforeUpgrade=m.own(defineCheckpoint({input:entityId,output:entityId}));
  const noopCreated=defineEffect<rules.EntityLifecycle<CardSetup>,void>(b=>b.return(undefined));
  const noopRemoved=defineEffect<Omit<rules.EntityLifecycle<CardSetup>,'setup'>&{reason:unknown},void>(b=>b.return(undefined));
  const setInitial=m.atom({input:z.object({entity:entityId,value:cardStateSchema}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,input){
    if(input.value.master!==null&&(input.value.mode!==1||r.component(input.value.master,state).mode!==0))throw Error('A combat card master must be a permanent card');
    return{writes:[{entity:input.entity,component:state,value:input.value}],events:[],result:undefined};
  }});
  const initialize=defineEffect<rules.EntityLifecycle<CardSetup>,void>(b=>sequence(
    call(setInitial,{entity:b.read(v=>v.input.entity),value:query(initial,b.read(v=>({entity:v.input.entity,setup:v.input.setup})))}),
    call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.created??noopCreated),b.input),
  ));
  const assertDetached=defineEffect<number,void>(b=>b.return(b.read(v=>{if(v.get(query(zones.exports.location,v.input))!==null)throw Error('A card must leave its zone before deletion');return undefined;})));
  const dispose=defineEffect<Omit<rules.EntityLifecycle<CardSetup>,'setup'>&{reason:unknown},void>(b=>{
    const location=b.local<number|null>();return sequence(b.assign(location,query(zones.exports.location,b.read(v=>v.input.entity))),
      when(b.read(v=>v.get(location)!==null),call(zones.exports.move,{entity:b.read(v=>v.input.entity),from:location,to:null,index:0})),
      call(assertDetached,b.read(v=>v.input.entity)),call(entityEffect(kind,b.read(v=>v.input.entity),c=>c.removed??noopRemoved),b.input),call(assertDetached,b.read(v=>v.input.entity)),
    );
  });
  const kind:rules.EntityKind<CardConfig,CardSetup>=m.kind({config:z.object({
    id:z.string(),metadata:metadataSchema,use:z.custom<CardConfig['use']>(),canUpgrade:z.custom<CardConfig['canUpgrade']>(),upgrade:z.custom<CardConfig['upgrade']>(),
    returned:z.custom<NonNullable<CardConfig['returned']>>().optional(),canTransform:z.custom<NonNullable<CardConfig['canTransform']>>().optional(),canUse:z.custom<NonNullable<CardConfig['canUse']>>().optional(),endTurn:z.custom<NonNullable<CardConfig['endTurn']>>().optional(),
    upgradeCount:z.custom<NonNullable<CardConfig['upgradeCount']>>().optional(),
    created:z.custom<NonNullable<CardConfig['created']>>().optional(),removed:z.custom<NonNullable<CardConfig['removed']>>().optional(),
  }).strict(),setup:cardSetupSchema,components:[state,zones.exports.member],initialize,dispose});
  const initial=defineQuery({input:z.object({entity:entityId,setup:cardSetupSchema}),output:cardStateSchema,kinds:[kind],base:(r,input)=>{
    const config=r.configuration(input.entity,kind),setup=input.setup;
    if(setup.master!==null&&r.configuration(setup.master,kind)!==config)throw Error('Card master definition does not match');
    const cost=config.metadata.variants[setup.upgraded?1:0].cost;
    return{...setup,cost,costForTurn:cost,freeToPlayOnce:false,retain:false};
  }});
  const current=defineQuery({input:entityId,output:cardStateSchema,reads:[state],base:(r,entity)=>r.component(entity,state)});
  const sameDefinition=defineQuery({input:z.tuple([z.custom<rules.EntityDefinition<CardConfig,CardSetup>>(),z.custom<rules.EntityDefinition<CardConfig,CardSetup>>()]),output:z.boolean(),base:(r,pair)=>r.sameDefinition(pair[0],pair[1])});
  const matchesDefinition=defineQuery({input:z.object({entity:entityId,definition:z.custom<rules.EntityDefinition<CardConfig,CardSetup>>()}),output:z.boolean(),kinds:[kind],base:(r,i)=>r.configuration(i.entity,kind)===r.definitionConfiguration(i.definition,kind)});
  const hasCombatCopies=defineQuery({input:entityId,output:z.boolean(),reads:[state],base:(r,master)=>r.entities(state).some(id=>{const s=r.component(id,state);return s.mode===1&&s.master===master;})});
  const metadata=defineQuery({input:entityId,output:metadataSchema,kinds:[kind],base:(r,entity)=>r.configuration(entity,kind).metadata});
  const definitionMetadata=defineQuery({input:z.custom<rules.EntityDefinition<CardConfig,CardSetup>>(),output:metadataSchema,kinds:[kind],base:(r,definition)=>r.definitionConfiguration(definition,kind).metadata});
  const variant=defineQuery({input:entityId,output:variantSchema,reads:[state],kinds:[kind],base:(r,entity)=>r.configuration(entity,kind).metadata.variants[r.component(entity,state).upgraded?1:0]});
  const combatView=defineQuery({input:entityId,output:combatCardSchema,reads:[state],kinds:[kind],base:(r,entity)=>{
    const c=r.component(entity,state);return{id:r.configuration(entity,kind).id,uniqueId:c.uniqueId,specialData:c.specialData,cost:c.cost,costForTurn:c.costForTurn,upgraded:c.upgraded,freeToPlayOnce:c.freeToPlayOnce,retain:c.retain};
  }});
  const permanentView=defineQuery({input:entityId,output:z.object({id:z.string(),misc:int16,upgraded:z.boolean()}),reads:[state],kinds:[kind],base:(r,entity)=>{
    const c=r.component(entity,state);return{id:r.configuration(entity,kind).id,misc:c.specialData,upgraded:c.upgraded};
  }});
  function mutate<I extends {entity:number}>(input:rules.Schema<I>,update:(state:Readonly<CardState>,input:I)=>CardMutable):rules.Effect<I,void>{
    return m.atom({input,output:z.undefined(),reads:[state],writes:[state],emits:[changed],run(r,input){
      const before=r.component(input.entity,state),patch=cardMutableSchema.parse(update(before,input)),after={...before,...patch};
      return{writes:[{entity:input.entity,component:state,value:after}],events:[{event:changed,payload:{entity:input.entity,before,after}}],result:undefined};
    }});
  }
  const mutable=(c:Readonly<CardState>):CardMutable=>({specialData:c.specialData,cost:c.cost,costForTurn:c.costForTurn,upgraded:c.upgraded,freeToPlayOnce:c.freeToPlayOnce,retain:c.retain});
  const amountInput=z.object({entity:entityId,amount:z.int32()});
  const setCostForCombat=mutate(amountInput,(c,i)=>({...mutable(c),cost:signed8(i.amount)}));
  const setCostForTurn=mutate(amountInput,(c,i)=>({...mutable(c),costForTurn:c.costForTurn<0?c.costForTurn:signed8(Math.max(0,i.amount))}));
  const overrideTurnCost=mutate(z.object({entity:entityId,amount:int8}),(c,i)=>({...mutable(c),costForTurn:i.amount}));
  const updateCost=mutate(amountInput,(c,i)=>{
    const next=Math.max(0,c.cost+i.amount);if(next===c.cost)return mutable(c);
    const cost=signed8(next);return{...mutable(c),cost,costForTurn:signed8(Math.max(0,cost-(c.cost-c.costForTurn)))};
  });
  const upgradeBaseCost=mutate(amountInput,(c,i)=>{const cost=signed8(i.amount);return{...mutable(c),cost,costForTurn:c.costForTurn>0?signed8(Math.max(0,cost+c.costForTurn-c.cost)):c.costForTurn};});
  const resetTurn=mutate(z.object({entity:entityId}),(c)=>({...mutable(c),costForTurn:c.costForTurn<0?c.costForTurn:signed8(Math.max(0,c.cost))}));
  const setFlags=mutate(z.object({entity:entityId,freeToPlayOnce:z.boolean(),retain:z.boolean()}),(c,i)=>({...mutable(c),freeToPlayOnce:i.freeToPlayOnce,retain:i.retain}));
  const setCombatIdentity=m.atom({input:z.object({entity:entityId,uniqueId:int16,master:entityId.nullable()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const before=r.component(i.entity,state);if(before.mode!==1)throw Error('Only combat card identities may be reassigned');return{writes:[{entity:i.entity,component:state,value:{...before,uniqueId:i.uniqueId,master:i.master}}],events:[],result:undefined};}});
  const setSpecialData=mutate(z.object({entity:entityId,value:int16}),(c,i)=>({...mutable(c),specialData:i.value}));
  const setMutable=mutate(z.object({entity:entityId,value:cardMutableSchema}),(c,i)=>({...mutable(c),...i.value}));
  const defaultCount=defineQuery({input:cardEvaluationSchema,output:z.int32(),base:(_r,c)=>Number(c.state.upgraded)});
  const canSelection={kind,select:(c:Readonly<CardConfig>)=>c.canUpgrade},upgradeSelection={kind,select:(c:Readonly<CardConfig>)=>c.upgrade},countSelection={kind,select:(c:Readonly<CardConfig>)=>c.upgradeCount??defaultCount};
  const canUpgrade=defineQuery({input:entityId,output:z.boolean(),reads:[state],selections:[canSelection],base:(r,entity)=>r.selected(canSelection,entity,{entity,state:r.component(entity,state)})});
  const upgradeCount=defineQuery({input:entityId,output:z.int32(),reads:[state],selections:[countSelection],base:(r,entity)=>r.selected(countSelection,entity,{entity,state:r.component(entity,state)})});
  const defaultTransform=defineQuery({input:cardEvaluationSchema,output:z.boolean(),base:()=>true});
  const transformSelection={kind,select:(c:Readonly<CardConfig>)=>c.canTransform??defaultTransform};
  const canTransform=defineQuery({input:entityId,output:z.boolean(),reads:[state],selections:[transformSelection],base:(r,entity)=>r.selected(transformSelection,entity,{entity,state:r.component(entity,state)})});
  const nextUpgrade=defineQuery({input:z.object({entity:entityId,force:z.boolean()}),output:cardMutableSchema.nullable(),reads:[state],selections:[canSelection,upgradeSelection],base:(r,{entity,force})=>{
    const value={entity,state:r.component(entity,state)};return force||r.selected(canSelection,entity,value)?r.selected(upgradeSelection,entity,value):null;
  }});
  const commitUpgrade=m.atom({input:z.object({entity:entityId,next:cardMutableSchema}),output:z.undefined(),reads:[state],writes:[state],emits:[changed,upgraded],run(r,input){
    const before=r.component(input.entity,state),after={...before,...input.next},payload={entity:input.entity,before,after};
    return{writes:[{entity:input.entity,component:state,value:after}],events:[{event:changed,payload},{event:upgraded,payload}],result:undefined};
  }});
  const upgradeDetailed=defineEffect<{entity:number;force:boolean},{entity:number;applied:boolean}>(b=>{const checked=b.local<rules.ReplacementResult<number>>(),entity=b.local<number>(),next=b.local<CardMutable|null>();return sequence(
    b.assign(checked,m.resolve(beforeUpgrade,b.read(v=>v.input.entity))),when(b.read(v=>v.get(checked).kind==='cancel'),b.return({entity:b.read(v=>v.input.entity),applied:false})),
    b.assign(entity,b.read(v=>{const result=v.get(checked);if(result.kind==='cancel')throw Error('Canceled upgrade');return result.value;})),
    b.assign(next,query(nextUpgrade,{entity,force:b.read(v=>v.input.force)})),when(b.read(v=>v.get(next)===null),b.return({entity,applied:false})),
    call(commitUpgrade,{entity,next:b.read(v=>v.get(next)!)}),b.return({entity,applied:true}),
  );});
  const upgrade=defineEffect<number,boolean>(b=>{const result=b.local<{entity:number;applied:boolean}>();return sequence(b.assign(result,call(upgradeDetailed,{entity:b.input,force:false})),b.return(b.read(v=>v.get(result).applied)));});
  const copySetup=defineQuery({input:z.object({master:entityId,uniqueId:int16}),output:cardSetupSchema,dependencies:[current],base:(r,input)=>{
    const source=r.query(current,input.master);if(source.mode!==0)throw Error('Only permanent cards seed a new battle');
    return{mode:1 as const,master:input.master,uniqueId:input.uniqueId,upgraded:source.upgraded,specialData:source.specialData};
  }});
  function copyIntoCombat(input:{master:rules.Input<number>;uniqueId:rules.Input<number>;owner:rules.Input<number>;scope:rules.Input<number>}):rules.Command<number>{
    return spawnEntity({kind,definition:definitionOf(kind,input.master),owner:input.owner,scope:input.scope,setup:query(copySetup,{master:input.master,uniqueId:input.uniqueId})});
  }
  return{exports:{kind,current,sameDefinition,matchesDefinition,hasCombatCopies,metadata,definitionMetadata,variant,combatView,permanentView,setCombatIdentity,setCostForCombat,setCostForTurn,overrideTurnCost,updateCost,upgradeBaseCost,resetTurn,setFlags,setSpecialData,setMutable,canUpgrade,canTransform,upgradeCount,upgrade,upgradeDetailed,copyIntoCombat,changed:changed.public,upgraded:upgraded.public,beforeUpgrade:beforeUpgrade.public}};
}});
