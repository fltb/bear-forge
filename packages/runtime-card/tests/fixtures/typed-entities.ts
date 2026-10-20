import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {portEffect} from '../../../card-engine/src/rules-internal.ts';
const {defineRules,defineComponent,defineEffect,defineEntity,defineQuery,sequence,spawnEntity,call,entityEffect,query}=rules;
type Use={entity:number;amount:number};
type Config={use:rules.Effect<Use,number>};
export let initializations=0,componentInitializations=0;
const wait=portEffect<number,number>('wait');
const entities=defineRules({requires:[],build(m){
  const value=m.own(defineComponent({schema:z.number(),initial(){componentInitializations++;return 0;}}));
  const set=m.atom({input:z.object({entity:z.number(),value:z.number()}),output:z.undefined(),reads:[],writes:[value],emits:[],run(_r,input){return{writes:[{entity:input.entity,component:value,value:input.value}],events:[],result:undefined};}});
  const add=m.atom({input:z.object({entity:z.number(),amount:z.number()}),output:z.number(),reads:[value],writes:[value],emits:[],run(r,input){const result=r.component(input.entity,value)+input.amount;return{writes:[{entity:input.entity,component:value,value:result}],events:[],result};}});
  const kind=m.kind({config:z.object({use:z.custom<rules.Effect<Use,number>>()}),setup:z.number(),components:[value],initialize:defineEffect<rules.EntityLifecycle<number>,void>(b=>call(set,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}))});
  const current=defineQuery({input:z.number(),output:z.number(),reads:[value],base:(r,entity)=>r.component(entity,value)});
  const one=defineEffect<Use,number>(b=>{const result=b.local<number>();return sequence(b.assign(result,call(add,b.input)),b.return(result));});
  const five=defineEffect<Use,number>(b=>{const result=b.local<number>();return sequence(b.assign(result,call(add,{entity:b.read(v=>v.input.entity),amount:b.read(v=>v.input.amount*5)})),b.return(result));});
  return{exports:{kind,current,one:defineEntity(kind,{use:one}),five:defineEntity(kind,{use:five})}};
}});
const setup=z.object({which:z.union([z.literal(0),z.literal(1)]),initial:z.number()});
const entry=defineEffect<z.infer<typeof setup>,number>(b=>{
  const catalog=b.local<readonly rules.EntityDefinition<Config,number>[]>(),definition=b.local<rules.EntityDefinition<Config,number>>(),entity=b.local<number>(),reply=b.local<number>(),result=b.local<number>();
  return sequence(b.assign(catalog,[entities.exports.one,entities.exports.five]),b.assign(definition,b.read(v=>v.get(catalog)[v.input.which]!)),
    b.assign(reply,call(wait,0)),b.assign(entity,spawnEntity({kind:entities.exports.kind,definition,owner:null,scope:0,setup:b.read(v=>v.input.initial)})),
    call(entityEffect(entities.exports.kind,entity,c=>c.use),{entity,amount:reply}),b.assign(reply,call(wait,query(entities.exports.current,entity))),
    b.assign(result,call(entityEffect(entities.exports.kind,entity,c=>c.use),{entity,amount:reply})),b.return(result),
  );
});
export const definition=linkRules({id:'typed-entities/cold-1',schemas:{setup,result:z.number(),ports:{wait:{input:z.number(),output:z.number()}}},initialize(){initializations++;return{};},entry,definitions:[entry,wait],modules:[entities]});
