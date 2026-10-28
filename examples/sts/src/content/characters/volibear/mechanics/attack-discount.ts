import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {battles} from '../../../../rules/battles.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';

const setup=z.object({battle:z.int32(),turn:z.int32(),amount:z.int32()});
export const volibearAttackDiscount=rules.defineRules({requires:[battles,cardInstances],build(m){
  const eligible=rules.defineQuery({input:z.int32(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,card)=>r.query(cardInstances.exports.metadata,card).type===0});
  const state=rules.defineComponent({schema:setup.extend({play:z.int32().nullable()}),initial:()=>({battle:0,turn:0,amount:0,play:null})});
  const find=rules.defineQuery({input:setup,output:z.int32().nullable(),reads:[state],base:(r,i)=>r.entities(state).find(id=>{
    const s=r.component(id,state);return s.battle===i.battle&&s.turn===i.turn&&s.play===null;
  })??null});
  const discount=rules.modify(battles.exports.cost,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),reads:[state],dependencies:[eligible,battles.exports.current],base:(r,c)=>{
      const s=r.component(c.source,state);return c.input.owner===c.owner&&c.value>=0&&s.battle===c.input.battle&&s.turn===r.query(battles.exports.current,s.battle).turn&&
        (s.play===null||s.play===c.input.play)&&r.query(eligible,c.input.card);
    }}),reads:[state],transform:(r,c)=>Math.max(0,c.value-r.component(c.source,state).amount),
  });
  const consume=rules.on(battles.exports.using,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),reads:[state],dependencies:[eligible,battles.exports.current],base:(r,c)=>{
      const s=r.component(c.source,state);return c.event.owner===c.owner&&c.event.triggerOnUse&&!c.event.purgeOnUse&&s.play===null&&s.battle===c.event.battle&&
        s.turn===r.query(battles.exports.current,s.battle).turn&&r.query(eligible,c.event.card);
    }}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),state,b.read(v=>({
      ...v.get(rules.readComponent(v.input.source,state)),play:v.input.event.play,
    })))),
  });
  const finish=rules.on(battles.exports.finished,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),reads:[state],base:(r,c)=>{
      const s=r.component(c.source,state);return s.battle===c.event.battle&&s.play===c.event.play;
    }}),effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.despawnEntity({entity:b.read(v=>v.input.source),reason:{engageDiscountSpent:true}})),
  });
  const kind=m.kind({config:z.undefined(),setup,components:[],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof setup>>,void>(b=>rules.sequence(
    rules.updateLocalComponent(b.read(v=>v.input.entity),state,b.read(v=>({...v.input.setup,play:null}))),
    ...[discount,consume,finish].map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{
      if(v.input.owner===null)throw Error('Engage preparation requires an owner');return v.input.owner;
    }),environment:{},lifetime:b.read(v=>v.input.scope)})),
  ))});
  const definition=rules.defineEntity(kind,undefined,{components:[state]});
  const prepare=rules.defineEffect<{battle:number;amount:number},void>(b=>{
    const input=b.local<z.infer<typeof setup>>(),existing=b.local<number|null>();
    return rules.sequence(
      b.assign(input,b.read(v=>({battle:v.input.battle,turn:v.get(rules.query(battles.exports.current,v.input.battle)).turn,amount:v.input.amount}))),
      b.assign(existing,rules.query(find,input)),rules.when(b.read(v=>v.get(existing)!==null),rules.sequence(rules.updateLocalComponent(b.read(v=>v.get(existing)!),state,b.read(v=>({...v.get(rules.readComponent(v.get(existing)!,state)),amount:Math.max(v.input.amount,v.get(rules.readComponent(v.get(existing)!,state)).amount)}))),b.return(undefined))),
      rules.spawnEntity({definition,setup:input,owner:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)}),
    );
  });
  const pending=rules.defineQuery({input:z.int32(),output:z.int32(),reads:[state],dependencies:[battles.exports.status],base:(r,battle)=>r.entities(state).filter(id=>{const s=r.component(id,state);return s.battle===battle&&s.turn===r.query(battles.exports.status,battle).turn&&s.play===null;}).length});
  const text="本回合下一张攻击减指定费用；同类待用减费取最大值，最低0。";
  describeProgram(prepare,text);
  return {exports:{pending,eligible,prepare,text}};
}});
