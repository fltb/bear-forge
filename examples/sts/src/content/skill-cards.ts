import {rules} from '@bear-forge/card-engine';
import {battles} from '../rules/battles.ts';
import {cardInstances} from '../rules/card-instances.ts';
import {cardPiles} from '../rules/card-piles.ts';
import {zones} from '../rules/zones.ts';
import {resources} from '../rules/resources.ts';
import {attributes} from '../rules/attributes.ts';
import {powers} from '../rules/powers.ts';
import {random} from '../rules/random.ts';
import {additionalPowers} from './additional-powers.ts';
import {basicPowers} from './basic-powers.ts';
import {defensePowers} from './defense-powers.ts';
import {pileCards} from './pile-cards.ts';
import {actionQueue} from '../rules/combat-actions.ts';
import {concreteCard,composePrograms,cardBlock,cardDraw,cardPower,cardAmount,type CardAmount} from './combat-card-utils.ts';
import type {CardUse} from '../rules/card-instances.types.ts';
import type {PowerDefinition} from '../rules/powers.types.ts';
const {defineRules,defineEffect,sequence,forEach,when,whileDo,call,query,enqueue}=rules;
export const skillCards=defineRules({requires:[additionalPowers,battles,basicPowers,defensePowers,pileCards],build(){
  const queue=(effect:rules.Effect<CardUse,void>,retained=false)=>defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>{const s=v.get(query(battles.exports.current,v.input.battle));return retained?s.scope:s.actionScope;}),eligible:'captured'}));
  const energy=(amount:CardAmount)=>defineEffect<CardUse,void>(b=>enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));
  const heal=(amount:CardAmount)=>defineEffect<CardUse,void>(b=>enqueue(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope),eligible:'captured'}));
  const hpLoss=(amount:number)=>queue(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount,selfDamage:true}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),true);
  const wounds=defineEffect<CardUse,void>(b=>forEach([0,1],()=>enqueue(cardPiles.exports.create,{piles:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).piles),definition:pileCards.exports.Wound,upgraded:false,specialData:0,destination:1,shuffle:false,mutable:null},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'})));
  function allPower(definition:PowerDefinition,amount:CardAmount){return defineEffect<CardUse,void>(b=>forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>enqueue(powers.exports.apply,{registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:target,definition,amount:b.read(v=>cardAmount(amount,v)),source:b.read(v=>v.input.owner),debuff:true,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'})));}
  const entrench=queue(defineEffect<CardUse,void>(b=>call(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.get(query(resources.exports.current,v.input.owner)).block)})));
  const limitBreak=queue(defineEffect<CardUse,void>(b=>call(powers.exports.apply,{registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:query(attributes.exports.strength,b.read(v=>v.input.owner)),source:b.read(v=>v.input.owner),debuff:false,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)})));
  const apotheosis=queue(defineEffect<CardUse,void>(b=>forEach(b.read(v=>{const p=v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input.battle)).piles));return[p.hand,p.draw,p.discard,p.exhaust];}),zone=>forEach(query(zones.exports.members,zone),card=>call(cardInstances.exports.upgrade,card)))));
  const enlightenment=queue(defineEffect<CardUse,void>(b=>forEach(b.read(v=>v.get(query(zones.exports.members,v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input.battle)).piles)).hand))),card=>sequence(
    when(b.read(v=>v.get(query(cardInstances.exports.current,v.get(card))).costForTurn>1),call(cardInstances.exports.setCostForTurn,{entity:card,amount:1})),when(b.read(v=>v.input.state.upgraded&&v.get(query(cardInstances.exports.current,v.get(card))).cost>1),sequence(call(cardInstances.exports.setCostForCombat,{entity:card,amount:1}),call(cardInstances.exports.setCostForTurn,{entity:card,amount:1}))),
  ))));
  const madness=queue(defineEffect<CardUse,void>(b=>{const hand=b.local<readonly number[]>(),turn=b.local<boolean>(),index=b.local<number>(),card=b.local<number>();return sequence(
    b.assign(hand,b.read(v=>v.get(query(zones.exports.members,v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input.battle)).piles)).hand)))),b.assign(turn,b.read(v=>v.get(hand).some(card=>v.get(query(cardInstances.exports.current,card)).costForTurn>0))),when(b.read(v=>!v.get(turn)&&!v.get(hand).some(card=>v.get(query(cardInstances.exports.current,card)).cost>0)),b.return(undefined)),
    whileDo(true,sequence(b.assign(index,call(random.exports.int,{stream:b.read(v=>v.get(query(cardPiles.exports.current,v.get(query(battles.exports.current,v.input.battle)).piles)).cardRng),start:0,end:b.read(v=>v.get(hand).length-1)})),b.assign(card,b.read(v=>v.get(hand)[v.get(index)]!)),when(b.read(v=>{const c=v.get(query(cardInstances.exports.current,v.get(card)));return v.get(turn)?c.costForTurn>0:c.cost>0;}),sequence(call(cardInstances.exports.setCostForCombat,{entity:card,amount:0}),call(cardInstances.exports.setCostForTurn,{entity:card,amount:0}),b.return(undefined))))),
  );}));
  // The pinned source passes positive strength to DebuffEnemy here.
  const shackles=defineEffect<CardUse,void>(b=>sequence(call(cardPower(basicPowers.exports.Strength,[9,15],true,true),b.input),when(b.read(v=>v.input.target!==null&&v.get(query(attributes.exports.artifact,v.input.target))>0),call(cardPower(additionalPowers.exports.Shackled,[9,15],true,false),b.input))));
  const definitions={
    DarkShackles:concreteCard('DARK_SHACKLES',shackles),
    Apotheosis:concreteCard('APOTHEOSIS',apotheosis),Apparition:concreteCard('APPARITION',cardPower(defensePowers.exports.PlayerIntangible,1)),BandageUp:concreteCard('BANDAGE_UP',heal([4,6])),
    Blind:concreteCard('BLIND',defineEffect<CardUse,void>(b=>when(b.read(v=>v.input.state.upgraded),call(allPower(basicPowers.exports.EnemyWeak,2),b.input),call(cardPower(basicPowers.exports.EnemyWeak,2,true,true),b.input)))),
    Bloodletting:concreteCard('BLOODLETTING',composePrograms(hpLoss(3),energy([2,3]))),Disarm:concreteCard('DISARM',cardPower(basicPowers.exports.Strength,-2,true,true)),
    Enlightenment:concreteCard('ENLIGHTENMENT',enlightenment),Entrench:concreteCard('ENTRENCH',entrench),GhostlyArmor:concreteCard('GHOSTLY_ARMOR',cardBlock([10,13])),GoodInstincts:concreteCard('GOOD_INSTINCTS',cardBlock([6,9])),
    Impatience:concreteCard('IMPATIENCE',cardDraw([2,3])),Impervious:concreteCard('IMPERVIOUS',cardBlock([30,40])),Intimidate:concreteCard('INTIMIDATE',allPower(basicPowers.exports.EnemyWeak,[1,2])),
    Jax:concreteCard('JAX',composePrograms(hpLoss(3),cardPower(basicPowers.exports.Strength,[2,3]))),LimitBreak:concreteCard('LIMIT_BREAK',limitBreak),Madness:concreteCard('MADNESS',madness),MasterOfStrategy:concreteCard('MASTER_OF_STRATEGY',cardDraw([3,4])),
    Offering:concreteCard('OFFERING',composePrograms(hpLoss(6),energy(2),cardDraw([3,5]))),Panacea:concreteCard('PANACEA',cardPower(basicPowers.exports.PlayerArtifact,[1,2])),PanicButton:concreteCard('PANIC_BUTTON',composePrograms(cardBlock([30,40]),cardPower(basicPowers.exports.NoBlock,2,false,true))),
    PowerThrough:concreteCard('POWER_THROUGH',composePrograms(wounds,cardBlock([15,20]))),Shockwave:concreteCard('SHOCKWAVE',composePrograms(allPower(basicPowers.exports.EnemyWeak,[3,5]),allPower(basicPowers.exports.EnemyVulnerable,[3,5]))),
    Trip:concreteCard('TRIP',defineEffect<CardUse,void>(b=>when(b.read(v=>v.input.state.upgraded),call(allPower(basicPowers.exports.EnemyVulnerable,2),b.input),call(cardPower(basicPowers.exports.EnemyVulnerable,2,true,true),b.input)))),
  };
  return{exports:definitions};
}});
