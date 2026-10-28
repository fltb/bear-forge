import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';

const setup=z.object({battle:z.number().int(),owner:z.number().int()});
const stateSchema=setup.extend({amount:z.number().int().nonnegative(),turn:z.number().int(),strikes:z.number().int().nonnegative()});
export type ThunderForceGain={battle:number;owner:number;amount:number};
/** Battle-scoped resources: shared definitions, independent serializable Context. */
export const stormCharge=rules.defineRules({requires:[battles],build(m){
  const state=m.own(rules.defineComponent({schema:stateSchema.nullable(),initial:()=>null}));
  const find=rules.defineQuery({input:z.number(),output:z.number().nullable(),reads:[state],base:(r,battle)=>r.entities(state).find(id=>r.component(id,state)?.battle===battle)??null});
  const current=rules.defineQuery({input:z.number(),output:stateSchema,reads:[state],dependencies:[find,battles.exports.status],base:(r,battle)=>{
    const id=r.query(find,battle),turn=r.query(battles.exports.status,battle).turn;
    const s=id===null?{battle,owner:r.query(battles.exports.status,battle).actor,amount:0,turn,strikes:0}:r.component(id,state)!;
    return {...s,turn,strikes:s.turn===turn?s.strikes:0};
  }});
  const initialize=m.atom({input:setup.extend({entity:z.number()}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:{battle:i.battle,owner:i.owner,amount:0,turn:0,strikes:0}}],events:[],result:undefined};}});
  const kind=m.kind({config:z.undefined(),setup,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof setup>>,void>(b=>rules.call(initialize,{entity:b.read(v=>v.input.entity),battle:b.read(v=>v.input.setup.battle),owner:b.read(v=>v.input.setup.owner)}))});
  const definition=rules.defineEntity(kind,undefined);
  const ensure=rules.defineEffect<z.infer<typeof setup>,number>(b=>{const found=b.local<number|null>(),made=b.local<number>();return rules.sequence(
    b.assign(found,rules.query(find,b.read(v=>v.input.battle))),rules.when(b.read(v=>v.get(found)!==null),b.return(b.read(v=>v.get(found)!))),
    b.assign(made,rules.spawnEntity({definition,setup:b.input,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),b.return(made));});
  const change=m.atom({input:z.object({entity:z.number(),amount:z.number().int().nonnegative()}),output:z.number().int().nonnegative(),reads:[state],writes:[state],emits:[],run(r,i){
    const s=r.component(i.entity,state)!;
    return{writes:[{entity:i.entity,component:state,value:{...s,amount:s.amount+i.amount}}],events:[],result:i.amount};
  }});
  const gain=rules.defineEffect<ThunderForceGain,number>(b=>{const entity=b.local<number>(),n=b.local<number>();return rules.sequence(
    b.assign(entity,rules.call(ensure,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner)})),
    b.assign(n,rules.call(change,{entity,amount:b.read(v=>v.input.amount)})),b.return(n));});
  const recordStrike=m.atom({input:z.object({entity:z.number(),turn:z.number()}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){const s=r.component(i.entity,state)!;return{writes:[{entity:i.entity,component:state,value:{...s,turn:i.turn,strikes:(s.turn===i.turn?s.strikes:0)+1}}],events:[],result:undefined};}});
  const noteStrike=rules.defineEffect<z.infer<typeof setup>,void>(b=>{const entity=b.local<number>();return rules.sequence(b.assign(entity,rules.call(ensure,b.input)),rules.call(recordStrike,{entity,turn:b.read(v=>v.query(battles.exports.status,v.input.battle).turn)}));});
  const text='雷势为角色独立增幅，每点使每段雷伤增加1，持续本战，不自动消耗。';
  return{exports:{current,gain,noteStrike,text}};
}});
