import { typedValue } from './value.schemas.ts';
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {adventures} from './adventures.ts';
import {entityId} from './resources.schemas.ts';
export type RoomInput={run:number;room:number};
export type RoomConfig={enter:rules.Effect<RoomInput,void>;admit?:rules.Query<number,boolean>|undefined};
export type RoomDefinition=rules.EntityDefinition<RoomConfig,{run:number}>;
export const rooms=rules.defineRules({requires:[adventures],build(m){
  const kind:rules.EntityKind<RoomConfig,{run:number}>=m.kind({config:z.object({enter:typedValue<RoomConfig['enter']>(),admit:typedValue<NonNullable<RoomConfig['admit']>>().optional()}).strict(),setup:z.object({run:entityId}).strict(),components:[],initialize:rules.defineEffect<rules.EntityLifecycle<{run:number}>,void>(b=>rules.call(rules.entityEffect(kind,b.read(v=>v.input.entity),c=>c.enter),{run:b.read(v=>v.input.setup.run),room:b.read(v=>v.input.entity)}))});
  const yes=rules.defineQuery({input:entityId,output:z.boolean(),base:()=>true});
  const policy={kind,select:(c:rules.Borrowed<RoomConfig>)=>c.admit??yes};
  const allowed=rules.defineQuery({input:z.object({run:entityId,definition:typedValue<RoomDefinition>()}),output:z.boolean(),selections:[policy],base:(r,i)=>r.selectedDefinition(policy,i.definition,i.run)});
  return{exports:{kind,allowed}};
}});
