import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';

const setup=z.object({battle:z.int32(),turn:z.int32()});
export const volibearRepeat=rules.defineRules({requires:[battles,cardInstances],build(m){
  const eligible=rules.defineQuery({input:z.int32(),output:z.boolean(),dependencies:[cardInstances.exports.metadata,cardInstances.exports.variant],base:(r,card)=>r.query(cardInstances.exports.metadata,card).type===0&&r.query(cardInstances.exports.variant,card).target});
  const state=rules.defineComponent({schema:setup.extend({play:z.int32().nullable()}),initial:()=>({battle:0,turn:0,play:null})});
  const repeat=rules.modify(battles.exports.effectRepetitions,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),reads:[state],dependencies:[eligible,battles.exports.current],base:(r,c)=>{
      const s=r.component(c.source,state);return c.input.owner===c.owner&&s.battle===c.input.battle&&s.turn===r.query(battles.exports.current,s.battle).turn&&
        (s.play===null||s.play===c.input.play)&&r.query(eligible,c.input.card);
    }}),transform:(_r,c)=>c.value+1,
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
    }}),effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.despawnEntity({entity:b.read(v=>v.input.source),reason:{effectRepeatSpent:true}})),
  });
  const kind=m.kind({config:z.undefined(),setup,components:[],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof setup>>,void>(b=>rules.sequence(
    rules.updateLocalComponent(b.read(v=>v.input.entity),state,b.read(v=>({...v.input.setup,play:null}))),
    ...[repeat,consume,finish].map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{
      if(v.input.owner===null)throw Error('Effect repetition requires an owner');return v.input.owner;
    }),environment:{},lifetime:b.read(v=>v.input.scope)})),
  ))});
  const definition=rules.defineEntity(kind,undefined,{components:[state]});
  const prepare=rules.defineEffect<CardUse,void>(b=>{
    const input=b.local<z.infer<typeof setup>>();
    return rules.sequence(
      b.assign(input,b.read(v=>({battle:v.input.battle,turn:v.get(rules.query(battles.exports.current,v.input.battle)).turn}))),
      rules.spawnEntity({definition,setup:input,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)}),
    );
  });
  const pending=rules.defineQuery({input:z.int32(),output:z.int32(),reads:[state],dependencies:[battles.exports.status],base:(r,battle)=>r.entities(state).filter(id=>{const s=r.component(id,state);return s.battle===battle&&s.turn===r.query(battles.exports.status,battle).turn&&s.play===null;}).length});
  return {exports:{pending,prepare}};
}});
