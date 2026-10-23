import { typedValue } from '../../../rules/value.schemas.ts';
import {combatPrivate,observeCounter} from '../../../program/combat-state.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {cardPiles} from '../../../rules/card-piles.ts';
import {resources} from '../../../rules/resources.ts';
import {relics} from '../../../rules/relics.ts';
import {actionQueue} from '../../../rules/combat-actions.ts';
import {registerRelicAbilities} from '../hooks.ts';
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,on,sequence,when,enqueue,call,readComponent,updateLocalComponent}=rules;
type Shuffle=rules.ReactionContext<number>;
export const pileRelics=defineRules({requires:[cardPiles,relics,combatPrivate],build(){
  const owns=defineQuery({input:typedValue<Shuffle>(),output:z.boolean(),dependencies:[cardPiles.exports.current,cardPiles.exports.bindings],base:(r,c)=>r.query(cardPiles.exports.bindings,c.event).actor===c.owner});
  const block=(amount:number)=>({
    effect:defineEffect<Shuffle,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event).actionScope),eligible:'captured'})),
    text:`自身获得${amount}格挡`,
  });
  const energy=(amount:number)=>({
    effect:defineEffect<Shuffle,void>(b=>enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event).actionScope),eligible:'captured'})),
    text:`自身获得${amount}能量`,
  });
  const onShuffle=(operation:{effect:rules.Effect<Shuffle,void>;text:string},priority=0)=>({
    ability:on(cardPiles.exports.shuffling,{condition:owns,order:{phase:cardPiles.exports.stages.relic,priority},effect:operation.effect}),
    text:`自身洗牌时，${operation.text}。`,
  });
  function everyShuffles(period:number,operation:{effect:rules.Effect<Shuffle,void>;text:string}){
    const component=defineComponent({schema:z.int32().min(0).max(period-1),initial:()=>0});
    const effect=defineEffect<Shuffle,void>(b=>{
      const value=b.local<number>();return sequence(
        b.assign(value,readComponent(b.read(v=>v.input.source),component)),
        updateLocalComponent(b.read(v=>v.input.source),component,b.read(v=>v.get(value)===period-1?0:v.get(value)+1)),
        when(b.read(v=>v.get(value)===period-1),call(operation.effect,b.input)),
      );
    });
    return{component,...onShuffle({effect,text:`每累计${period}次，${operation.text}`},10)};
  }
  const abacus=onShuffle(block(6));
  const sundial=everyShuffles(3,energy(2));
  const sundialCount=sundial.component;
  const count=defineQuery({input:z.number(),output:z.int32(),reads:[sundialCount],base:(r,entity)=>r.component(entity,sundialCount)});
  return{exports:{TheAbacus:defineEntity(relics.exports.kind,{id:'THE_ABACUS' as const,install:registerRelicAbilities(abacus.ability)}),
    Sundial:defineEntity(relics.exports.kind,{id:'SUNDIAL' as const,install:registerRelicAbilities(sundial.ability,observeCounter('sundialCounter',sundialCount),rules.modify(relics.exports.data,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),reads:[sundialCount],transform:(r,c)=>r.component(c.source,sundialCount)}))},{components:[sundialCount]}),sundialCount:count,
    texts:Object.freeze({THE_ABACUS:abacus.text,SUNDIAL:sundial.text}),
  }};
}});
