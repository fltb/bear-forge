import {z} from 'zod';
import type {ModuleBuilder} from '../../../../packages/card-engine/src/rules-module.types.ts';
import {stateOf} from '../../../../packages/card-engine/src/rules-module-internal.ts';
import {withProbability} from '../../../../packages/card-engine/src/rules-probability.ts';
import type {ForwardProbabilityResult} from '../../../../packages/card-engine/src/probability.ts';
import {searchEntropyWord} from '../../../../packages/policies/src/search/entropy.ts';
import {rules} from './execution.ts';
import {entityId} from './resources.schemas.ts';

export type JointChanges={representation:'exact'|'particles';reason:string|null;paths:string[][];outcomes:{probability:number;values:unknown[]}[]};
const tag='probability-capture';
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function equal(a:unknown,b:unknown):boolean {
  if(Object.is(a,b))return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,i)=>equal(value,b[i]));
  if(object(a)&&object(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));}
  return false;
}
/** Retain only values changed by the original effect. No instructions, frames,
 * old Context, RNG states or second interpretation of the effect are stored. */
export function jointChanges(result:rules.Borrowed<ForwardProbabilityResult>):JointChanges {
  if(result.reason)return{representation:result.representation,reason:result.reason,paths:[],outcomes:[]};
  const paths=new Map<string,string[]>();
  function changed(before:unknown,after:unknown,path:string[]){
    if(equal(before,after))return;
    if(object(before)&&object(after)){
      const keys=Object.keys(before).sort();
      if(equal(keys,Object.keys(after).sort()))for(const key of keys)changed(before[key],after[key],[...path,key]);
      else paths.set(JSON.stringify(path),path);
    }else paths.set(JSON.stringify(path),path);
  }
  for(const outcome of result.outcomes)changed(result.basis,outcome.value,[]);
  const all=[...paths.values()],ordered=all.filter(path=>!all.some(parent=>parent.length<path.length&&parent.every((key,i)=>path[i]===key))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const valueAt=(value:unknown,path:readonly string[])=>path.reduce<unknown>((value,key)=>(value as Record<string,unknown>)[key],value);
  const outcomes:JointChanges['outcomes']=[];
  for(const outcome of result.outcomes){
    const values=ordered.map(path=>valueAt(outcome.value,path)),same=outcomes.find(row=>equal(row.values,values));
    if(same)same.probability+=outcome.probability;else outcomes.push({probability:outcome.probability,values});
  }
  return{representation:result.representation,reason:null,paths:ordered,outcomes};
}

/** Module-owned storage plus a generic forward probability operation. The
 * supplied owner still creates/updates its component through the normal atom
 * permission and commit path. Projection reads data, not card or enemy rules. */
export function createEntityProbabilityCapture(m:ModuleBuilder,until:string){
  const jointSchema=z.object({representation:z.enum(['exact','particles']),reason:z.string().nullable(),paths:z.array(z.array(z.string())),outcomes:z.array(z.object({probability:z.number().positive(),values:z.array(z.unknown())}))});
  const stored=m.own(rules.defineComponent({schema:z.object({kind:z.literal(tag),law:jointSchema.nullable()}),initial:()=>({kind:tag as typeof tag,law:null})}));
  const current=rules.defineQuery({input:entityId,output:jointSchema.nullable(),reads:[stored],base:(r,entity)=>r.component(entity,stored).law});
  const begin=withProbability(m.atom({input:entityId,output:jointSchema.nullable(),reads:[],writes:[],emits:[],run:()=>({writes:[],events:[],result:null})}),{
    space:()=>({kind:'boundary',name:'enemy-roll:before'}),run:()=>({writes:[],events:[],result:null}),
    forward:{
      plan:()=>({until,maximum:8,milliseconds:2000}),word:searchEntropyWord,
      project(state,entity){const record=stateOf(state).entities[entity];if(!record)throw Error('Missing probability subject');return Object.fromEntries(Object.entries(record.components).filter(([,value])=>!object(value)||value.kind!==tag));},
      commit:(_r,_entity,result)=>({writes:[],events:[],result:jointChanges(result)}),
    },
  });
  const commit=m.atom({input:z.object({entity:entityId,result:jointSchema.nullable()}),output:z.undefined(),reads:[],writes:[stored],emits:[],run(_r,input){
    return{writes:[{entity:input.entity,component:stored,value:{kind:tag as typeof tag,law:input.result}}],events:[],result:undefined};
  }});
  return{component:stored,begin,commit,current};
}
