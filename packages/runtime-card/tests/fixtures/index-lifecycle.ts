import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import {portEffect} from '../../../card-engine/src/rules-internal.ts';
const {defineRules,defineComponent,defineEvent,defineQuery,defineEffect,defineEntity,sequence,call,query,forEach,enqueue,schedule,emit,spawnEntity}=rules;
const queue=Object.freeze({label:'index-lifecycle-tasks'}),lifetime=Object.freeze({label:'index-lifecycle-scope'});
const stopSchema=z.object({phase:z.enum(['ready','dispose']),entity:z.number(),holders:z.array(z.number())});
export type Ports={wait:{input:z.infer<typeof stopSchema>;output:null}};
const wait=portEffect<z.infer<typeof stopSchema>,null>('wait');
export const resultSchema=z.object({tasks:z.array(z.number()),disposals:z.array(z.array(z.number())),scope:z.array(z.number())});
export type Result=z.infer<typeof resultSchema>;
export let initializations=0,componentInitializations=0;
const module=defineRules({requires:[],build(m){
  const marker=m.own(defineComponent({schema:z.number(),initial:()=>{componentInitializations++;return 0;}}));
  const log=m.own(defineComponent({schema:resultSchema,initial:():Result=>({tasks:[],disposals:[],scope:[]})}));
  const tick=m.own(defineEvent({payload:z.undefined(),publicEmit:true}));
  const holders=defineQuery({input:z.undefined(),output:z.array(z.number()),reads:[marker],base:r=>r.entities(marker).filter(id=>id!==0)});
  const history=defineQuery({input:z.undefined(),output:resultSchema,reads:[log],base:r=>r.component(0,log)});
  const record=m.atom({input:z.object({kind:z.enum(['task','dispose','scope']),value:z.number(),holders:z.array(z.number())}),output:z.undefined(),reads:[log],writes:[log],emits:[],run(r,input){
    const previous=r.component(0,log);
    const value=input.kind==='task'?{...previous,tasks:[...previous.tasks,input.value]}:
      input.kind==='dispose'?{...previous,disposals:[...previous.disposals,input.holders]}:{...previous,scope:input.holders};
    return{writes:[{entity:0,component:log,value}],events:[],result:undefined};
  }});
  const task=defineEffect<number,void>(b=>call(record,{kind:'task',value:b.input,holders:[]}));
  const dispose=defineEffect<rules.EntityLifecycle&{reason:unknown},void>(b=>sequence(
    call(wait,{phase:'dispose',entity:b.read(v=>v.input.entity),holders:query(holders,undefined)}),
    call(record,{kind:'dispose',value:b.read(v=>v.input.entity),holders:query(holders,undefined)}),
  ));
  const kind=m.kind({config:z.undefined(),components:[marker],dispose});
  m.lifecycle(lifetime,{dispose:defineEffect(()=>call(record,{kind:'scope',value:0,holders:query(holders,undefined)}))});
  return{exports:{kind,task,holders,history,tick:tick.public}};
}});
const entity=defineEntity(module.exports.kind,undefined);
const entry=defineEffect<number,Result>(b=>{const scope=b.local<number>();return sequence(
  b.assign(scope,ruleModules.openScope(lifetime,0)),
  forEach(b.read(v=>Array.from({length:v.input},(_,i)=>i)),()=>spawnEntity({definition:entity,owner:0,scope})),
  forEach(b.read(v=>Array.from({length:v.input},(_,i)=>i)),value=>enqueue(module.exports.task,value,{queue,source:0,lifetime:scope,eligible:'captured'})),
  schedule(module.exports.task,-1,{queue,source:0,lifetime:scope,eligible:'captured',at:{event:module.exports.tick}}),
  call(wait,{phase:'ready',entity:0,holders:query(module.exports.holders,undefined)}),
  ruleModules.drainQueue(queue),ruleModules.closeScope(scope),emit(module.exports.tick,undefined),ruleModules.drainQueue(queue),
  b.return(query(module.exports.history,undefined)),
);});
export const definition=linkRules<{},number,Ports,Result>({id:'index-lifecycle',schemas:{setup:z.number().int().positive(),result:resultSchema,ports:{wait:{input:stopSchema,output:z.null()}}},
  initialize(){initializations++;return{};},entry,definitions:[entry,wait],modules:[module],initialEntities:[0]});
export function expected(size:number):Result{return{tasks:Array.from({length:size},(_,i)=>i),disposals:Array.from({length:size},(_,i)=>Array.from({length:size-i},(_,j)=>i+j+1)),scope:Array.from({length:size},(_,i)=>i+1)};}

export const largeSourceA=4294967296,largeSourceB=4294967297;
const highIdEntry=defineEffect<void,Result>(b=>sequence(
  enqueue(module.exports.task,1,{queue,source:largeSourceA,lifetime:0}),
  enqueue(module.exports.task,2,{queue,source:largeSourceB,lifetime:0}),
  enqueue(module.exports.task,3,{queue,source:largeSourceA,lifetime:0}),
  ruleModules.drainOne(queue),call(wait,{phase:'ready',entity:0,holders:[]}),
  ruleModules.drainQueue(queue),b.return(query(module.exports.history,undefined)),
));
export const highIdDefinition=linkRules<{},void,Ports,Result>({id:'index-large-sources',schemas:{setup:z.undefined(),result:resultSchema,ports:{wait:{input:stopSchema,output:z.null()}}},
  initialize(){initializations++;return{};},entry:highIdEntry,definitions:[highIdEntry,wait],modules:[module],initialEntities:[0,largeSourceA,largeSourceB]});
