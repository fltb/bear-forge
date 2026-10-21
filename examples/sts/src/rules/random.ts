import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {randomState,randomInt,randomFloat,randomLong,nextLong,randomLongRange,randomBoolean,setRandomCounter,javaShuffle,rngView} from '../rng.ts';
import type {RandomState} from '../rng.ts';
import {entityId} from './resources.schemas.ts';
import {unsigned64,signed64,randomStateSchema,randomViewSchema} from './random.schemas.ts';
const {defineRules,defineComponent,defineEffect,defineQuery,call}=rules;

/** The source's checked numeric algorithms are reused; every mutable stream is owned Context data. */
export const random=defineRules({requires:[],build(m){
  const state=m.own(defineComponent({schema:randomStateSchema,initial:()=>randomState(0n)}));
  const seed=m.atom({input:z.object({stream:entityId,seed:unsigned64}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,input){return{writes:[{entity:input.stream,component:state,value:randomState(input.seed)}],events:[],result:undefined};}});
  const stream=m.kind({config:z.undefined(),setup:unsigned64,components:[state],initialize:defineEffect<rules.EntityLifecycle<bigint>,void>(b=>call(seed,{stream:b.read(v=>v.input.entity),seed:b.read(v=>v.input.setup)}))});
  function sample<I extends {stream:number},O>(input:rules.Schema<I>,output:rules.Schema<O>,draw:(state:RandomState,input:rules.Borrowed<I>)=>O):rules.Effect<I,O>{
    return m.atom({input,output,reads:[state],writes:[state],emits:[],run(r,input){
      const next={...r.component(input.stream,state)},result=draw(next,input);
      return{writes:[{entity:input.stream,component:state,value:next}],events:[],result};
    }});
  }
  const int=sample(z.object({stream:entityId,start:z.int32(),end:z.int32()}),z.int32(),(r,i)=>randomInt(r,i.start,i.end));
  const float=sample(z.object({stream:entityId}),z.number(),r=>randomFloat(r));
  const floatRange=sample(z.object({stream:entityId,start:z.number().finite(),end:z.number().finite()}),z.number(),(r,i)=>randomFloat(r,i.start,i.end));
  const long=sample(z.object({stream:entityId}),signed64,r=>randomLong(r));
  const longRange=sample(z.object({stream:entityId,start:signed64,end:signed64}),signed64,(r,i)=>randomLongRange(r,i.start,i.end));
  const boolean=sample(z.object({stream:entityId}),z.boolean(),r=>randomBoolean(r));
  const chance=sample(z.object({stream:entityId,chance:z.number().finite()}),z.boolean(),(r,i)=>randomBoolean(r,i.chance));
  const shuffleElements=sample(z.object({stream:entityId,items:z.array(z.unknown()).readonly(),counted:z.boolean()}),z.array(z.unknown()).readonly(),(r,i)=>{const items=[...i.items];javaShuffle(items,i.counted?randomLong(r):nextLong(r));return items;});
  function shuffle<T>(input:{stream:rules.Input<number>;items:rules.Input<readonly T[]>;counted?:rules.Input<boolean>}):rules.Command<readonly T[]>{
    // The atom only permutes its input. This wrapper retains the element type at the author boundary.
    return call(shuffleElements as rules.Effect<{stream:number;items:readonly T[];counted:boolean},readonly T[]>,{...input,counted:input.counted??true});
  }
  const advanceCounter=sample(z.object({stream:entityId,count:z.int32().nonnegative()}),z.undefined(),(r,i)=>setRandomCounter(r,i.count));
  const copyFrom=m.atom({input:z.object({target:entityId,source:entityId}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){return{writes:[{entity:i.target,component:state,value:{...r.component(i.source,state)}}],events:[],result:undefined};}});
  const current=defineQuery({input:entityId,output:randomViewSchema,reads:[state],base:(r,stream)=>rngView(r.component(stream,state))});
  return{exports:{stream,current,int,float,floatRange,long,longRange,boolean,chance,shuffle,advanceCounter,reseed:seed,copyFrom}};
}});
