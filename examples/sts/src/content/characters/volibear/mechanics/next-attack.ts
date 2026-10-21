import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import type {CardUse,CardVariant} from '../../../../rules/card-instances.types.ts';
import {volibearCardPrograms} from '../cards/programs.ts';

const setup=z.object({battle:z.int32(),card:z.int32(),amount:z.number().int()});
export const volibearNextAttack=rules.defineRules({requires:[battles,cardInstances,volibearCardPrograms],build(m){
  const retainThisTurn=rules.modify(cardInstances.exports.variant,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,CardVariant,{battle:number;turn:number}>>(),output:z.boolean(),dependencies:[battles.exports.current],base:(r,c)=>c.input===c.source&&r.query(battles.exports.current,c.environment.battle).turn===c.environment.turn}),
    transform:(_r,c)=>({...c.value,retain:true}),
  });
  const state=rules.defineComponent({schema:setup.extend({play:z.int32().nullable()}),initial:()=>({battle:0,card:0,amount:0,play:null})});
  const amount=rules.defineQuery({input:z.int32(),output:z.number().int(),reads:[state],base:(r,id)=>r.component(id,state).amount});
  const boost=rules.modify(volibearCardPrograms.exports.fixedBonus,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),reads:[state],base:(r,c)=>{
      const s=r.component(c.source,state);return s.battle===c.input.battle&&s.card===c.input.card&&(s.play===null||s.play===c.input.play);
    }}),
    dependencies:[amount],transform:(r,c)=>c.value+r.query(amount,c.source),
  });
  const start=rules.on(battles.exports.using,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),reads:[state],base:(r,c)=>{
      const s=r.component(c.source,state);return s.battle===c.event.battle&&s.card===c.event.card&&s.play===null&&c.event.triggerOnUse&&!c.event.purgeOnUse;
    }}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),state,b.read(v=>({
      ...v.get(rules.readComponent(v.input.source,state)),play:v.input.event.play,
    })))),
  });
  const finish=rules.on(battles.exports.finished,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),reads:[state],base:(r,c)=>{
      const s=r.component(c.source,state);return s.battle===c.event.battle&&s.play===c.event.play;
    }}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.despawnEntity({entity:b.read(v=>v.input.source),reason:{attackBonusSpent:true}})),
  });
  const kind=m.kind({config:z.undefined(),setup,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof setup>>,void>(b=>rules.sequence(
    rules.updateLocalComponent(b.read(v=>v.input.entity),state,b.read(v=>({...v.input.setup,play:null}))),
    ...[boost,start,finish].map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>{
      if(v.input.owner===null)throw Error('Next attack bonus requires an owner');return v.input.owner;
    }),environment:{},lifetime:b.read(v=>v.input.scope)})),
  ))});
  const definition=rules.defineEntity(kind,undefined);
  const prepare=rules.defineEffect<z.infer<typeof setup>,void>(b=>rules.sequence(
    rules.install({ability:retainThisTurn,source:b.read(v=>v.input.card),owner:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).actor),
      environment:b.read(v=>({battle:v.input.battle,turn:v.get(rules.query(battles.exports.current,v.input.battle)).turn})),
      lifetime:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)}),
    rules.spawnEntity({definition,setup:b.input,owner:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).actor),scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)}),
  ));
  return {exports:{prepare}};
}});
