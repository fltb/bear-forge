import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../../rules/battles.ts";
import {cardInstances} from "../../../../rules/card-instances.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {zones} from "../../../../rules/zones.ts";
import {resources} from "../../../../rules/resources.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {damage} from "../../../../rules/damage.ts";
import {powers} from "../../../../rules/powers.ts";
import {random} from "../../../../rules/random.ts";
import {adventures} from "../../../../rules/adventures.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {concreteCard,composePrograms,targetAttack,cardAmount,type CardAmount} from "../../../cards/shared/programs.ts";
import type {CardUse,CardState} from "../../../../rules/card-instances.types.ts";
import type {HitRequest} from "../../../../rules/damage.types.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query,enqueue}=rules;
export const advancedAttacks=defineRules({requires:[battles,basicPowers,adventures],build(){
  const queue=(effect:rules.Effect<CardUse,void>)=>defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));
  const hand=(v:rules.ReadView<CardUse>)=>v.get(query(zones.exports.members,v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input.battle)).piles)).hand));
  const addSpecial=defineEffect<{use:CardUse;amount:number;permanent:boolean},void>(b=>{const next=b.local<CardState>();return sequence(
    b.assign(next,b.read(v=>{const c=v.get(query(battles.exports.context,{battle:v.input.use.battle,play:v.input.use.play})).state;return{...c,specialData:((c.specialData+v.input.amount)<<16)>>16};})),
    call(battles.exports.setPlayState,{battle:b.read(v=>v.input.use.battle),play:b.read(v=>v.input.use.play),state:next}),
    when(b.read(v=>v.input.use.purgeOnUse),when(b.read(v=>v.get(query(zones.exports.location,v.input.use.card))!==null),call(cardInstances.exports.setSpecialData,{entity:b.read(v=>v.input.use.card),value:b.read(v=>{const c=v.get(query(cardInstances.exports.current,v.input.use.card));return((c.specialData+v.input.amount)<<16)>>16;})}))),

  );});
  const rampage=defineEffect<CardUse,void>(b=>sequence(call(targetAttack(v=>8+v.input.state.specialData),b.input),call(addSpecial,{use:b.input,amount:b.read(v=>v.input.state.upgraded?8:5),permanent:false})));
  const dropkick=queue(defineEffect<CardUse,void>(b=>{const vulnerable=b.local<number|null>();return sequence(
    b.assign(vulnerable,query(powers.exports.find,{registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:b.read(v=>v.input.target!),definition:basicPowers.exports.EnemyVulnerable})),
    when(b.read(v=>v.input.target!==null&&v.get(query(battles.exports.targetable,v.input.target))&&v.get(vulnerable)!==null&&v.get(query(powers.exports.enabled,v.get(vulnerable)!))),sequence(
      enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),count:1},{queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
      enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:1},{queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
    )),enqueue(battles.exports.hit,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),amount:query(attributes.exports.attackAmount,{source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),card:b.read(v=>v.input.card),base:b.read(v=>v.input.state.upgraded?8:5)}),attack:true,selfDamage:false},{queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}),
  );}));
  function lethal(amount:CardAmount,reward:rules.Effect<CardUse,void>,attack=true){const act=defineEffect<{use:CardUse;amount:number},void>(b=>sequence(
    when(b.read(v=>v.input.use.target===null||!v.get(query(battles.exports.targetable,v.input.use.target))),b.return(undefined)),
    call(damage.exports.hit,{battle:b.read(v=>v.input.use.battle),source:b.read(v=>v.input.use.owner),target:b.read(v=>v.input.use.target!),amount:b.read(v=>v.input.amount),attack,selfDamage:false}),
    when(b.read(v=>v.get(query(resources.exports.current,v.input.use.target!)).hp===0&&v.get(query(battles.exports.rewardEligible,{battle:v.input.use.battle,target:v.input.use.target!}))),call(reward,b.read(v=>v.input.use))),call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle)),
  ));return defineEffect<CardUse,void>(b=>enqueue(act,{use:b.input,amount:query(attributes.exports.attackAmount,{source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),card:b.read(v=>v.input.card),base:b.read(v=>cardAmount(amount,v))})},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
  const feed=lethal([10,12],defineEffect<CardUse,void>(b=>call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.input.state.upgraded?4:3)})));
  const sever=queue(defineEffect<CardUse,void>(b=>forEach(b.read(v=>[...hand(v)].reverse().filter(card=>v.get(query(cardInstances.exports.metadata,card)).type!==0)),card=>enqueue(cardPiles.exports.exhaust,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),card},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}))));
  const fiend=defineEffect<CardUse,void>(b=>{const amount=b.local<number>();return sequence(b.assign(amount,query(attributes.exports.attackAmount,{source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),card:b.read(v=>v.input.card),base:b.read(v=>v.input.state.upgraded?10:7)})),enqueue(defineEffect<{use:CardUse;amount:number},void>(b=>{const count=b.local<number>();return sequence(b.assign(count,b.read(v=>{const p=v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input.use.battle)).piles));return v.get(query(zones.exports.members,p.hand)).length;})),forEach(b.read(v=>Array.from({length:v.get(count)},(_,index)=>index)),()=>enqueue(battles.exports.hit,{battle:b.read(v=>v.input.use.battle),source:b.read(v=>v.input.use.owner),target:b.read(v=>v.input.use.target!),amount:b.read(v=>v.input.amount),attack:true,selfDamage:false},{queue:actionQueue,position:'front',source:b.read(v=>v.input.use.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.use.battle)).actionScope),eligible:'captured'})),forEach(b.read(v=>Array.from({length:v.get(count)},(_,index)=>index)),()=>enqueue(defineEffect<CardUse,void>(b=>{const list=b.local<readonly number[]>(),at=b.local<number>();return sequence(b.assign(list,b.read(hand)),when(b.read(v=>v.get(list).length===0),b.return(undefined)),b.assign(at,call(random.exports.int,{stream:b.read(v=>v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input.battle)).piles)).cardRng),start:0,end:b.read(v=>v.get(list).length-1)})),call(cardPiles.exports.exhaust,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),card:b.read(v=>v.get(list)[v.get(at)]!)}));}),b.read(v=>v.input.use),{queue:actionQueue,position:'front',source:b.read(v=>v.input.use.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.use.battle)).actionScope),eligible:'captured'})));}),{use:b.input,amount},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));});
  const whirlwind=defineEffect<CardUse,void>(b=>{const energy=b.local<number>();return sequence(b.assign(energy,b.read(v=>v.input.ignoreEnergyTotal?v.input.energyOnUse:Math.min(v.input.energyOnUse,v.get(query(resources.exports.current,v.input.owner)).energy))),call(battles.exports.setEnergyOnUse,{battle:b.read(v=>v.input.battle),play:b.read(v=>v.input.play),value:energy}),enqueue(defineEffect<{use:CardUse;energy:number},void>(b=>{const matrix=b.local<HitRequest[]>(),count=b.local<number>();return sequence(
    when(b.read(v=>!(v.input.use.freeToPlay||v.input.use.state.freeToPlayOnce)),call(resources.exports.useEnergy,{entity:b.read(v=>v.input.use.owner),amount:b.read(v=>v.get(query(resources.exports.current,v.input.use.owner)).energy)})),
    b.assign(matrix,b.read(v=>v.get(query(battles.exports.targets,v.input.use.battle)).map(target=>({battle:v.input.use.battle,source:v.input.use.owner,target,amount:Math.min(65535,v.get(query(attributes.exports.attackAmount,{source:v.input.use.owner,target,base:v.input.use.state.upgraded?8:5,card:v.input.use.card}))),attack:true,selfDamage:false})))),
    b.assign(count,b.read(v=>{const run=v.get(query(adventures.exports.forActor,v.input.use.owner));return v.input.energy+(run!==null&&v.get(query(adventures.exports.hasRelic,{run,id:'CHEMICAL_X'}))?2:0);})),
    forEach(b.read(v=>Array.from({length:v.get(count)},(_,index)=>index)),()=>sequence(forEach(matrix,hit=>call(damage.exports.hit,hit)),call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle)),when(b.read(v=>v.get(query(battles.exports.current,v.input.use.battle)).outcome!==0),b.return(undefined)))),
  );}),{use:b.input,energy},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));});
  return{exports:{Dropkick:concreteCard('DROPKICK',dropkick),
    Feed:concreteCard('FEED',feed),
    FiendFire:concreteCard('FIEND_FIRE',fiend),
    PerfectedStrike:concreteCard('PERFECTED_STRIKE',targetAttack(v=>{const p=v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input.battle)).piles)),count=p.registered.filter(card=>v.get(query(cardInstances.exports.metadata,card)).strike).length;return 6+count*(v.input.state.upgraded?3:2);})),
    Rampage:concreteCard('RAMPAGE',rampage),
    SeverSoul:concreteCard('SEVER_SOUL',composePrograms(sever,targetAttack([16,22]))),
    Whirlwind:concreteCard('WHIRLWIND',whirlwind)}};
}});
