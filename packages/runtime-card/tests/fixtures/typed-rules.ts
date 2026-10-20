import { z } from 'zod';
import { rules, linkRules } from '@bear-forge/card-engine';
import { portEffect } from '../../../card-engine/src/rules-internal.ts';
const {defineRules,defineComponent,defineEvent,defineEffect,sequence,call,forEach}=rules;
export let initializations=0;
const choose=portEffect<number,number>('choose');
const counters=defineRules({requires:[],build(m){
  const count=m.own(defineComponent({schema:z.number(),initial:()=>0}));
  const changed=m.own(defineEvent({payload:z.number()}));
  const add=m.atom({input:z.number(),output:z.number(),reads:[count],writes:[count],emits:[changed],run(r,n){
    const result=r.component(0,count)+n;
    return{writes:[{entity:0,component:count,value:result}],events:[{event:changed,payload:result}],result};
  }});
  return{exports:{add}};
}});
const entry=defineEffect<number,number>(b=>{
  const reply=b.local<number>(),result=b.local<number>();
  return sequence(b.assign(result,0),forEach([2,5],item=>sequence(
    b.assign(reply,call(choose,b.read(v=>v.input+v.get(item)+v.get(result)))),
    b.assign(result,call(counters.exports.add,reply)),
  )),b.return(result));
});
export const definition=linkRules({
  id:'typed-rules/counter-1',schemas:{setup:z.number(),result:z.number(),ports:{choose:{input:z.number(),output:z.number()}}},
  initialize(){initializations++;return{};},entry,definitions:[entry,choose],modules:[counters],initialEntities:[0],
});
