import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import {portEffect} from '../../../card-engine/src/rules-internal.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineEffect,sequence,call,query,schedule,enqueue,emit}=rules;
const queue={label:'typed-tasks'},choose=portEffect<number,number>('choose');
export let initializations=0;
const module=defineRules({requires:[],build(m){
  const values=m.own(defineComponent({schema:z.array(z.number()),initial:()=>[]})),tick=m.own(defineEvent({payload:z.number(),publicEmit:true}));
  const append=m.atom({input:z.number(),output:z.undefined(),reads:[values],writes:[values],emits:[],run(r,value){return{writes:[{entity:0,component:values,value:[...r.component(0,values),value]}],events:[],result:undefined};}});
  const history=defineQuery({input:z.undefined(),output:z.array(z.number()),reads:[values],base:r=>[...r.component(0,values)]});
  return{exports:{append,history,tick:tick.public}};
}});
const task=defineEffect<number,void>(b=>{const reply=b.local<number>();return sequence(call(module.exports.append,ruleModules.queueSize(queue)),b.assign(reply,call(choose,b.input)),call(module.exports.append,reply));});
const entry=defineEffect<void,number[]>(b=>sequence(
  call(module.exports.append,ruleModules.queueSize(queue)),schedule(module.exports.append,9,{queue,lifetime:0,at:{event:module.exports.tick}}),emit(module.exports.tick,1),
  enqueue(task,7,{queue,position:'front',lifetime:0}),call(module.exports.append,ruleModules.queueSize(queue)),ruleModules.drainQueue(queue),call(module.exports.append,ruleModules.queueSize(queue)),b.return(query(module.exports.history,undefined)),
));
export const definition=linkRules({id:'typed-tasks/1',schemas:{setup:z.undefined(),result:z.array(z.number()),ports:{choose:{input:z.number(),output:z.number()}}},initialize(){initializations++;return{};},entry,definitions:[entry,task,choose],modules:[module],initialEntities:[0]});
