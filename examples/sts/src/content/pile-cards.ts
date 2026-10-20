import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {cardPiles} from '../rules/card-piles.ts';
import {cardInstances} from '../rules/card-instances.ts';
import {resources} from '../rules/resources.ts';
import {attributes} from '../rules/attributes.ts';
import {battles} from '../rules/battles.ts';
import {actionQueue} from '../rules/combat-actions.ts';
import {cards} from '../cards.ts';
import type {CardUse} from '../rules/card-instances.types.ts';
import type {PileCard} from '../rules/card-piles.types.ts';
import {registerCardAbilities,standardUpgrade,upgradeOnce} from './card-utils.ts';
const {defineRules,defineQuery,defineEntity,defineEffect,on,call,query,enqueue}=rules;
export const pileCards=defineRules({requires:[cardPiles,attributes,battles],build(){
  const self=defineQuery({input:z.custom<rules.ReactionContext<PileCard>>(),output:z.boolean(),base:(_r,c)=>c.event.card===c.source});
  const voidDraw=on(cardPiles.exports.drawing,{condition:self,order:cardPiles.exports.stages.card,effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>call(resources.exports.useEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.min(1,v.get(query(resources.exports.current,v.input.owner)).energy))}))});
  const sentinelExhaust=on(cardPiles.exports.exhausting,{condition:self,order:cardPiles.exports.stages.card,effect:defineEffect<rules.ReactionContext<PileCard>,void>(b=>call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.get(query(cardInstances.exports.current,v.input.source)).upgraded?3:2)}))});
  const noop=defineEffect<CardUse,void>(b=>b.return(undefined));
  const playable=defineQuery({input:z.custom<CardUse>(),output:z.boolean(),base:()=>true});
  const inert=(id:'WOUND'|'DAZED'|'SLIMED')=>defineEntity(cardInstances.exports.kind,{id,metadata:cards[id],use:noop,canUse:id==='SLIMED'?playable:undefined,canUpgrade:upgradeOnce(cards[id]),upgrade:standardUpgrade(cards[id])});
  const burn=defineEffect<CardUse,void>(b=>enqueue(battles.exports.hit,{battle:b.read(v=>v.input.battle),source:null,target:b.read(v=>v.input.owner),amount:b.read(v=>v.input.state.upgraded?4:2),attack:false,selfDamage:true},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope),eligible:'captured'}));
  const sentinelUse=defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:query(attributes.exports.blockAmount,b.read(v=>({actor:v.input.owner,base:v.input.state.upgraded?8:5})))},
    {queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));
  return{exports:{Wound:inert('WOUND'),Dazed:inert('DAZED'),Slimed:inert('SLIMED'),Burn:defineEntity(cardInstances.exports.kind,{id:'BURN',metadata:cards.BURN,use:noop,endTurn:burn,canUpgrade:upgradeOnce(cards.BURN),upgrade:standardUpgrade(cards.BURN)}),Void:defineEntity(cardInstances.exports.kind,{id:'VOID',metadata:cards.VOID,use:noop,canUpgrade:upgradeOnce(cards.VOID),upgrade:standardUpgrade(cards.VOID),created:registerCardAbilities(voidDraw)}),
    Sentinel:defineEntity(cardInstances.exports.kind,{id:'SENTINEL',metadata:cards.SENTINEL,use:sentinelUse,canUpgrade:upgradeOnce(cards.SENTINEL),upgrade:standardUpgrade(cards.SENTINEL),created:registerCardAbilities(sentinelExhaust)})}};
}});
