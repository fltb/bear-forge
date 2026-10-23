import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';

const setup=z.object({battle:z.number().int(),owner:z.number().int()});
const stateSchema=setup.extend({amount:z.number().int().nonnegative(),spent:z.number().int().nonnegative(),turn:z.number().int(),turnSpent:z.number().int().nonnegative()});
export type ChargeSpent={battle:number;owner:number;amount:number};
/** Battle-scoped resources: shared definitions, independent serializable Context. */
export const stormCharge=rules.defineRules({requires:[battles],build(m){
  const state=m.own(rules.defineComponent({schema:stateSchema.nullable(),initial:()=>null}));
  const spent=m.own(rules.defineEvent({payload:setup.extend({amount:z.number().int().positive()}),dispatch:'immediate'}));
  const find=rules.defineQuery({input:z.number(),output:z.number().nullable(),reads:[state],base:(r,battle)=>r.entities(state).find(id=>r.component(id,state)?.battle===battle)??null});
  const current=rules.defineQuery({input:z.number(),output:stateSchema,reads:[state],dependencies:[find,battles.exports.status],base:(r,battle)=>{
    const id=r.query(find,battle),turn=r.query(battles.exports.status,battle).turn;
    const s=id===null?{battle,owner:r.query(battles.exports.status,battle).actor,amount:0,spent:0,turn,turnSpent:0}:r.component(id,state)!;
    return {...s,turn,turnSpent:s.turn===turn?s.turnSpent:0};
  }});
  const initialize=m.atom({input:setup.extend({entity:z.number()}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:{battle:i.battle,owner:i.owner,amount:0,spent:0,turn:0,turnSpent:0}}],events:[],result:undefined};}});
  const kind=m.kind({config:z.undefined(),setup,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof setup>>,void>(b=>rules.call(initialize,{entity:b.read(v=>v.input.entity),battle:b.read(v=>v.input.setup.battle),owner:b.read(v=>v.input.setup.owner)}))});
  const definition=rules.defineEntity(kind,undefined);
  const ensure=rules.defineEffect<z.infer<typeof setup>,number>(b=>{const found=b.local<number|null>(),made=b.local<number>();return rules.sequence(
    b.assign(found,rules.query(find,b.read(v=>v.input.battle))),rules.when(b.read(v=>v.get(found)!==null),b.return(b.read(v=>v.get(found)!))),
    b.assign(made,rules.spawnEntity({definition,setup:b.input,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),b.return(made));});
  const change=m.atom({input:z.object({entity:z.number(),amount:z.number().int().nonnegative(),consume:z.boolean(),turn:z.number()}),output:z.number().int().nonnegative(),reads:[state],writes:[state],emits:[spent],run(r,i){
    const s=r.component(i.entity,state);if(!s)throw Error('Missing storm charge');
    const n=i.consume?Math.min(s.amount,i.amount):i.amount;
    return{writes:[{entity:i.entity,component:state,value:{...s,amount:s.amount+(i.consume?-n:n),spent:s.spent+(i.consume?n:0),turn:i.turn,turnSpent:(s.turn===i.turn?s.turnSpent:0)+(i.consume?n:0)}}],events:i.consume&&n>0?[{event:spent,payload:{battle:s.battle,owner:s.owner,amount:n}}]:[],result:n};
  }});
  const modify=(consume:boolean)=>rules.defineEffect<ChargeSpent,number>(b=>{const entity=b.local<number>(),n=b.local<number>();return rules.sequence(
    b.assign(entity,rules.call(ensure,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner)})),
    b.assign(n,rules.call(change,{entity,amount:b.read(v=>v.input.amount),consume,turn:b.read(v=>v.query(battles.exports.status,v.input.battle).turn)})),b.return(n));});
  const text='本场战斗资源，跨回合保留。消耗不超过当前数量；实际消耗为正数时提交资源和累计量后只发送一次事件，0消耗不触发。';
  return{exports:{current,gain:modify(false),consume:modify(true),spent:spent.public,text,turnSpentText:'本回合累计实际消耗。',spentText:'本场战斗累计实际消耗。'}};
}});
