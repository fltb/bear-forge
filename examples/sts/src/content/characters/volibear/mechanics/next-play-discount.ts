import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';

const setup=z.object({battle:z.int32(),card:z.int32(),turn:z.int32()});
const coupon=setup.extend({play:z.int32().nullable()});
/** One shared coupon kind makes C15/U25/R10 non-stacking by construction. */
export const volibearNextPlayDiscount=rules.defineRules({requires:[battles],build(m){
  const reductionAmount=1;
  const state=m.own(rules.defineComponent({schema:coupon.nullable(),initial:()=>null}));
  const find=rules.defineQuery({input:setup,output:z.int32().nullable(),reads:[state],base:(r,i)=>r.entities(state).find(id=>{
    const s=r.component(id,state);return s!==null&&s.battle===i.battle&&s.card===i.card&&s.turn===i.turn&&s.play===null;
  })??null});
  const save=m.atom({input:z.object({entity:z.int32(),value:coupon}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){
    return {writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};
  }});
  const reduction=rules.modify(battles.exports.cost,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),reads:[state],dependencies:[battles.exports.current],base:(r,c)=>{
      const s=r.component(c.source,state);
      return s!==null&&s.battle===c.input.battle&&s.card===c.input.card&&s.turn===r.query(battles.exports.current,s.battle).turn&&(s.play===null||s.play===c.input.play)&&c.value>=0;
    }}),
    transform:(_r,c)=>Math.max(0,c.value-reductionAmount),
  });
  const consume=m.atom({input:z.object({entity:z.int32(),use:cardUseSchema}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){
    const s=r.component(i.entity,state);if(s===null)throw Error('Missing next-play discount');
    return {writes:[{entity:i.entity,component:state,value:{...s,play:i.use.play}}],events:[],result:undefined};
  }});
  const begin=rules.on(battles.exports.using,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),reads:[state],dependencies:[battles.exports.current],base:(r,c)=>{
      const s=r.component(c.source,state);
      return s!==null&&s.play===null&&s.battle===c.event.battle&&s.card===c.event.card&&s.turn===r.query(battles.exports.current,s.battle).turn&&c.event.triggerOnUse&&!c.event.purgeOnUse;
    }}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.call(consume,{entity:b.read(v=>v.input.source),use:b.read(v=>v.input.event)})),
  });
  const finish=rules.on(battles.exports.finished,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),reads:[state],base:(r,c)=>{
      const s=r.component(c.source,state);return s!==null&&s.battle===c.event.battle&&s.play===c.event.play;
    }}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.despawnEntity({entity:b.read(v=>v.input.source),reason:{discountSpent:true}})),
  });
  const kind=m.kind({config:z.undefined(),setup,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof setup>>,void>(b=>rules.sequence(
    rules.call(save,{entity:b.read(v=>v.input.entity),value:b.read(v=>({...v.input.setup,play:null}))}),
    ...[reduction,begin,finish].map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{
      if(v.input.owner===null)throw Error('Next-play discount requires an owner');return v.input.owner;
    }),environment:{},lifetime:b.read(v=>v.input.scope)})),
  ))});
  const definition=rules.defineEntity(kind,undefined);
  const grant=rules.defineEffect<{battle:number;card:number},void>(b=>{
    const input=b.local<z.infer<typeof setup>>(),existing=b.local<number|null>();
    return rules.sequence(
      b.assign(input,b.read(v=>({...v.input,turn:v.get(rules.query(battles.exports.current,v.input.battle)).turn}))),
      b.assign(existing,rules.query(find,input)),
      rules.when(b.read(v=>v.get(existing)!==null),b.return(undefined)),
      rules.spawnEntity({definition,setup:input,owner:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).actor),scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)}),
    );
  });
  const pending=rules.defineQuery({input:z.object({battle:z.int32(),card:z.int32()}),output:z.boolean(),dependencies:[find,battles.exports.status],base:(r,i)=>r.query(find,{...i,turn:r.query(battles.exports.status,i.battle).turn})!==null});
  const text=`本回合下次实际打出减${reductionAmount}费，最低0；同类效果不叠加，该次重复效果共享减费。`;
  return {exports:{pending,grant,text}};
}});
