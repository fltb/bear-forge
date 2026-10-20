import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {portEffect} from '../../../card-engine/src/rules-internal.ts';
import type {ReactionContext} from '../../../card-engine/src/rules-reactions.types.ts';
const {defineRules,defineComponent,defineEvent,defineEffect,defineEntity,sequence,call,on,install,emit,spawnEntity,readComponent,updateLocalComponent}=rules;
const choose=portEffect<number,number>('choose');
const provider=defineRules({requires:[],build(m){return{exports:{
  event:m.own(defineEvent({payload:z.number(),dispatch:'immediate',publicEmit:true})).public,
  kind:m.kind({config:z.object({label:z.string()}),components:[]}),
}};}});
const counter=defineComponent({schema:z.number(),initial:()=>0});
const relic=defineEntity(provider.exports.kind,{label:'counter'},{components:[counter]});
const reaction=on(provider.exports.event,{effect:defineEffect<ReactionContext<number>,void>(b=>{
  const reply=b.local<number>(),source=b.read(v=>v.input.source);
  return sequence(b.assign(reply,call(choose,source)),updateLocalComponent(source,counter,b.read(v=>v.get(readComponent(source,counter))+v.get(reply))),
    // The chosen value lives in the saved caller frame, never a mutable host capture.
    b.return(undefined));
})});
const entry=defineEffect<number,number>(b=>{const first=b.local<number>(),second=b.local<number>();return sequence(
  b.assign(first,spawnEntity({definition:relic,owner:null,scope:0})),b.assign(second,spawnEntity({definition:relic,owner:null,scope:0})),
  install({source:first,owner:first,ability:reaction,environment:{},lifetime:0}),install({source:second,owner:second,ability:reaction,environment:{},lifetime:0}),
  emit(provider.exports.event,1),b.return(b.read(v=>v.get(readComponent(first,counter))*100+v.get(readComponent(second,counter)))),
);});
export const definition=linkRules({id:'typed-private/1',schemas:{setup:z.number(),result:z.number(),ports:{choose:{input:z.number(),output:z.number()}}},initialize:()=>({}),entry,definitions:[entry,choose],modules:[provider]});
