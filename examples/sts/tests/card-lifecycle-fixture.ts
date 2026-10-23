import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {linkRules} from '@bear-forge/card-engine';
import {portEffect} from '../../../packages/card-engine/src/rules-internal.ts';
import {cardInstances,CardMode} from '../src/rules/card-instances.ts';
import type {CardSetup,CardState,CardUse} from '../src/rules/card-instances.types.ts';
import {cardStateSchema} from '../src/rules/card-instances.schemas.ts';
import {cards} from '../src/cards.ts';
import {standardUpgrade,upgradeOnce} from "../src/content/cards/shared/lifecycle.ts";
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,spawnEntity,despawnEntity,call,query}=rules;
const choose=portEffect<number,number>('choose');
export let initializations=0;
const logger=defineRules({requires:[],build(m){
  const value=m.own(defineComponent({schema:cardStateSchema.nullable(),initial:()=>null}));
  const save=m.atom({input:z.object({entity:z.number(),value:cardStateSchema}),output:z.undefined(),reads:[],writes:[value],emits:[],run(_r,input){return{writes:[{entity:input.entity,component:value,value:input.value}],events:[],result:undefined};}});
  const kind=m.kind({config:z.undefined(),components:[value]});
  const current=defineQuery({input:z.number(),output:cardStateSchema.nullable(),reads:[value],base:(r,entity)=>r.component(entity,value)});
  return{exports:{save,kind,current}};
}});
const logDefinition=defineEntity(logger.exports.kind,undefined);
const fixtureRules=defineRules({requires:[logger,cardInstances],build(){
  const created=defineEffect<rules.EntityLifecycle<CardSetup>,void>(b=>{const reply=b.local<number>();return sequence(
    call(cardInstances.exports.setSpecialData,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.get(query(cardInstances.exports.current,v.input.entity)).specialData+100)}),
    b.assign(reply,call(choose,1)),call(cardInstances.exports.setCostForCombat,{entity:b.read(v=>v.input.entity),amount:reply}),
  );});
  const removed=defineEffect<Omit<rules.EntityLifecycle<CardSetup>,'setup'>&{reason:unknown},void>(b=>{const reply=b.local<number>();return sequence(
    b.assign(reply,call(choose,b.read(v=>v.get(query(cardInstances.exports.current,v.input.entity)).cost))),
    call(cardInstances.exports.updateCost,{entity:b.read(v=>v.input.entity),amount:reply}),
    call(logger.exports.save,{entity:b.read(v=>v.input.owner!),value:query(cardInstances.exports.current,b.read(v=>v.input.entity))}),
  );});
  const use=defineEffect<CardUse,void>(b=>b.return(undefined));
  // This lifecycle-only fixture has no attack behavior; do not duplicate production damage values.
  const metadata={...cards.BASH,variants:[{...cards.BASH.variants[0],damage:-1},{...cards.BASH.variants[1],damage:-1}] as const};
  return{exports:{card:defineEntity(cardInstances.exports.kind,{id:'BASH',metadata,use,canUpgrade:upgradeOnce(metadata),upgrade:standardUpgrade(metadata),created,removed})}};
}});
const entry=defineEffect<void,CardState|null>(b=>{const log=b.local<number>(),card=b.local<number>();return sequence(
  b.assign(log,spawnEntity({definition:logDefinition,owner:null,scope:0})),b.assign(card,spawnEntity({definition:fixtureRules.exports.card,owner:log,scope:0,setup:{mode:CardMode.Permanent,master:null,uniqueId:-1,specialData:5,upgraded:false}})),
  call(cardInstances.exports.upgrade,card),despawnEntity({entity:card,reason:{finished:true}}),b.return(query(logger.exports.current,log)),
);});
export const definition=linkRules({id:'sts/card-lifecycle-fixture-1',schemas:{setup:z.undefined(),result:cardStateSchema.nullable(),ports:{choose:{input:z.number(),output:z.number()}}},initialize(){initializations++;return{};},entry,definitions:[entry,choose],modules:[fixtureRules]});
