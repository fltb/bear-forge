import {rules} from './execution.ts';
import {z} from 'zod';
import {adventures} from './adventures.ts';
export type AdventureChoiceExports={choose:rules.Effect<{run:number;actions:readonly number[];details?:Readonly<Record<string,string>>},number>};
/** The wire is supplied at Program assembly; accepted actions resume their original typed caller. */
export function createAdventureChoices<W,R>(adapter:rules.ChoiceAdapter<number,number,W,R>,requires:readonly rules.RuleModule<unknown>[]){return rules.defineRules({requires:[adventures,...requires],build(m){
  const additional=rules.defineQuery({input:z.number(),output:z.array(z.number()),base:()=>[]});
  const accepted=m.own(rules.defineEvent({payload:z.object({run:z.number(),bits:z.number()}),dispatch:'immediate'}));
  const announce=m.atom({input:z.object({run:z.number(),bits:z.number()}),output:z.undefined(),reads:[],writes:[],emits:[accepted],run(_r,payload){return{writes:[],events:[{event:accepted,payload}],result:undefined};}});
  const choose=rules.defineEffect<{run:number;actions:readonly number[];details?:Readonly<Record<string,string>>},number>(b=>{const selected=b.local<rules.ChoiceResult<number>>(),bits=b.local<number>();return rules.whileDo(true,rules.sequence(
    rules.call(adventures.exports.setOptionDetails,{run:b.read(v=>v.input.run),options:b.read(v=>v.input.details??{})}),rules.call(adventures.exports.prepareRequest,b.read(v=>v.input.run)),b.assign(selected,rules.chooseOne({adapter,player:b.read(v=>v.input.run),candidates:b.read(v=>[...v.input.actions,...v.query(additional,v.input.run)]),allowSkip:false,empty:'error',singleton:'request'})),b.assign(bits,b.read(v=>{const result=v.get(selected);if(result.kind!=='selected')throw Error('Required adventure choice was skipped');return result.value;})),rules.call(adventures.exports.record,{run:b.read(v=>v.input.run),kind:'game',bits}),rules.call(announce,{run:b.read(v=>v.input.run),bits}),rules.when(b.read(v=>v.input.actions.includes(v.get(bits))),b.return(bits)),
  ));});return{exports:{choose,additional,accepted:accepted.public}};
}});}
