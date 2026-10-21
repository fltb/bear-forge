import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import type {ChoiceRequest} from '../../../card-engine/src/rules-choices.types.ts';
import type {ChoiceAdapterSpec} from '../../../card-engine/src/rules-choices.types.ts';
const {defineRules,defineQuery,defineEffect,sequence,chooseMany,chooseOne,chooseOrder}=rules;
const module=defineRules({requires:[],build(){
  const publication=defineQuery({input:z.any(),output:z.any(),base:(_read,input)=>input as ChoiceRequest<number,string>});
  const adapter=ruleModules.choicePort<number,string,ChoiceRequest<number,string>,{indices:number[];skip?:boolean|undefined}>({port:'choose',request:publication,reply:z.object({indices:z.array(z.number()),skip:z.boolean().optional()}),decode:(_request,reply)=>reply.skip?{kind:'skipped'}:{kind:'selected',indices:reply.indices}});
  return{exports:{adapter}};
}});
if(false){
  // @ts-expect-error candidates are an array, never a scalar
  chooseOne({adapter:module.exports.adapter,player:'p',candidates:1,singleton:'request',allowSkip:true,empty:'skip'});
  // @ts-expect-error a decoder cannot return a Promise
  const asynchronous:ChoiceAdapterSpec<number,string,unknown,unknown>['decode']=async()=>({kind:'skipped'});
  // @ts-expect-error selected indices must be an array
  const malformed:ChoiceAdapterSpec<number,string,unknown,unknown>['decode']=()=>({kind:'selected',indices:1});
}
export function definition(mode:'many'|'one'|'order'|'empty'='many'){
  const entry=defineEffect<number,readonly number[]>(b=>{
    const result=b.local<readonly number[]>();
    if(mode==='one'){
      const one=b.local<import('../../../card-engine/src/rules-choices.types.ts').ChoiceResult<number>>();
      return sequence(b.assign(one,chooseOne({adapter:module.exports.adapter,player:'p',candidates:[10,20,30],singleton:'request',allowSkip:true,empty:'skip'})),b.return(b.read(v=>{const x=v.get(one);return x.kind==='skipped'?[]:[x.value];})));
    }
    return sequence(b.assign(result,mode==='order'?chooseOrder({adapter:module.exports.adapter,player:'p',items:[10,20,30],singleton:'request'}):chooseMany({adapter:module.exports.adapter,player:'p',candidates:mode==='empty'?[]:[10,20,30],min:mode==='empty'?0:1,max:2,order:'irrelevant',empty:'request',singleton:'request'})),b.return(result));
  });
  return linkRules({id:'typed-choice/'+mode,schemas:{setup:z.number(),result:z.array(z.number()),ports:{choose:{input:z.any(),output:z.object({indices:z.array(z.number()),skip:z.boolean().optional()})}}},initialize:()=>({}),entry,definitions:[entry],modules:[module]});
}
