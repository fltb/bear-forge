import { z } from 'zod';
import { rules,linkRules } from '@bear-forge/card-engine';
import { portEffect } from '../../../card-engine/src/rules-internal.ts';
import type { ReplacementContext,ReplacementResult } from '../../../card-engine/src/rules-checkpoints.types.ts';
import type { ReactionContext } from '../../../card-engine/src/rules-reactions.types.ts';
const {defineRules,defineComponent,defineCheckpoint,defineEvent,defineQuery,defineEffect,sequence,call,when,query,replace,on,install}=rules;
const choose=portEffect<number,number>('choose');
export let initializations=0,componentInitializations=0;
const module=defineRules({requires:[],build(m){
  const amount=m.own(defineComponent({schema:z.number(),initial:()=>{componentInitializations++;return 0;}}));
  const history=m.own(defineComponent({schema:z.number(),initial:()=>{componentInitializations++;return 0;}}));
  const checkpoint=m.own(defineCheckpoint({input:z.number(),output:z.number()}));
  const changed=m.own(defineEvent({payload:z.number(),dispatch:'immediate'}));
  const commit=m.atom({input:z.number(),output:z.number(),reads:[],writes:[amount],emits:[changed],run(_r,value){return{writes:[{entity:0,component:amount,value}],events:[{event:changed,payload:value}],result:value};}});
  const record=m.atom({input:z.number(),output:z.undefined(),reads:[],writes:[history],emits:[],run(_r,value){return{writes:[{entity:0,component:history,value}],events:[],result:undefined};}});
  const outcome=defineQuery({input:z.undefined(),output:z.number(),reads:[amount,history],base:r=>r.component(0,amount)+r.component(0,history)});
  const change=defineEffect<number,number>(b=>{const checked=b.local<ReplacementResult<number>>(),result=b.local<number>();return sequence(
    b.assign(checked,m.resolve(checkpoint,b.input)),when(b.read(v=>v.get(checked).kind==='cancel'),b.return(-1),sequence(
      b.assign(result,call(commit,b.read(v=>{const r=v.get(checked);if(r.kind==='cancel')throw Error('unreachable');return r.value;}))),b.return(result),
    )),
  );});
  return{exports:{checkpoint:checkpoint.public,changed:changed.public,record,outcome,change}};
}});
const replaceEffect=defineEffect<ReplacementContext<number>,ReplacementResult<number>>(b=>{
  const answer=b.local<number>();return sequence(b.assign(answer,call(choose,b.read(v=>v.input.value))),b.return({kind:'change',value:answer}));
});
const reactEffect=defineEffect<ReactionContext<number>,void>(b=>{
  const answer=b.local<number>();return sequence(b.assign(answer,call(choose,b.read(v=>v.input.event*10))),call(module.exports.record,answer));
});
const replacement=replace(module.exports.checkpoint,{effect:replaceEffect}),reaction=on(module.exports.changed,{effect:reactEffect});
const entry=defineEffect<number,number>(b=>sequence(
  install({source:0,owner:0,ability:replacement,environment:{},lifetime:0}),install({source:0,owner:0,ability:reaction,environment:{},lifetime:0}),
  call(module.exports.change,b.input),b.return(query(module.exports.outcome,undefined)),
));
export const definition=linkRules({id:'typed-interactions/1',schemas:{setup:z.number(),result:z.number(),ports:{choose:{input:z.number(),output:z.number()}}},
  initialize(){initializations++;return{};},entry,definitions:[entry,choose],modules:[module],initialEntities:[0]});
