import {combatPrivate,observeCounter} from "../../../program/combat-state.ts";
import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {cardPiles} from "../../../rules/card-piles.ts";
import {resources} from "../../../rules/resources.ts";
import {relics} from "../../../rules/relics.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {registerRelicAbilities} from "../hooks.ts";
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,on,sequence,when,query,enqueue,readComponent,updateLocalComponent}=rules;
const sundialCount=defineComponent({schema:z.int32().min(0).max(2),initial:()=>0});
export const pileRelics=defineRules({requires:[cardPiles,relics,combatPrivate],build(){
  const owns=defineQuery({input:z.custom<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[cardPiles.exports.current],base:(r,c)=>r.query(cardPiles.exports.current,c.event).actor===c.owner});
  const abacus=on(cardPiles.exports.shuffling,{condition:owns,order:cardPiles.exports.stages.relic,effect:defineEffect<rules.ReactionContext<number>,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:6},
    {queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.get(query(cardPiles.exports.current,v.input.event)).actionScope),eligible:'captured'}))});
  const sundial=on(cardPiles.exports.shuffling,{condition:owns,order:{phase:cardPiles.exports.stages.relic,priority:10},effect:defineEffect<rules.ReactionContext<number>,void>(b=>{
    const value=b.local<number>();return sequence(b.assign(value,readComponent(b.read(v=>v.input.source),sundialCount)),
      updateLocalComponent(b.read(v=>v.input.source),sundialCount,b.read(v=>v.get(value)===2?0:v.get(value)+1)),
      when(b.read(v=>v.get(value)===2),enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:2},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.get(query(cardPiles.exports.current,v.input.event)).actionScope),eligible:'captured'})),
    );
  })});
  const count=defineQuery({input:z.number(),output:z.int32(),reads:[sundialCount],base:(r,entity)=>r.component(entity,sundialCount)});
  return{exports:{TheAbacus:defineEntity(relics.exports.kind,{id:'THE_ABACUS' as const,install:registerRelicAbilities(abacus)}),
    Sundial:defineEntity(relics.exports.kind,{id:'SUNDIAL' as const,install:registerRelicAbilities(sundial,observeCounter('sundialCounter',sundialCount),rules.modify(relics.exports.data,{condition:defineQuery({input:z.custom<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[sundialCount],transform:(r,c)=>r.component(c.source,sundialCount)}))},{components:[sundialCount]}),sundialCount:count}};
}});
