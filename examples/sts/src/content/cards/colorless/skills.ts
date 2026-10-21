import {shackledPower} from "../../powers/shackled.ts";
import {rules} from '@bear-forge/card-engine';
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {zones} from "../../../rules/zones.ts";
import {resources} from "../../../rules/resources.ts";
import {attributes} from "../../../rules/attributes.ts";
import {powers} from "../../../rules/powers.ts";
import {random} from "../../../rules/random.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {defensePowers} from "../../powers/defense.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {concreteCard,composePrograms,cardBlock,cardDraw,cardPower,cardAmount,type CardAmount} from "../shared/programs.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {PowerDefinition} from "../../../rules/powers.types.ts";
const {defineRules,defineEffect,sequence,forEach,when,whileDo,call,query,enqueue}=rules;
export const colorlessSkillCards=defineRules({requires:[shackledPower,battles,basicPowers,defensePowers],build(){
  const queue=(effect:rules.Effect<CardUse,void>,retained=false)=>defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>{const s=v.query(battles.exports.status,v.input.battle);return retained?s.scope:s.actionScope;}),eligible:'captured'}));
  const heal=(amount:CardAmount)=>defineEffect<CardUse,void>(b=>enqueue(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'}));
  const hpLoss=(amount:number)=>queue(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount,selfDamage:true}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),true);
  function allPower(definition:PowerDefinition,amount:CardAmount){return defineEffect<CardUse,void>(b=>forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>enqueue(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:target,definition,amount:b.read(v=>cardAmount(amount,v)),source:b.read(v=>v.input.owner),debuff:true,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})));}
  const apotheosis=queue(defineEffect<CardUse,void>(b=>forEach(b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles);return[p.hand,p.draw,p.discard,p.exhaust];}),zone=>forEach(query(zones.exports.members,zone),card=>call(cardInstances.exports.upgrade,card)))));
  const enlightenment=queue(defineEffect<CardUse,void>(b=>forEach(b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand)),card=>sequence(
    when(b.read(v=>v.query(cardInstances.exports.current,v.get(card)).costForTurn>1),call(cardInstances.exports.setCostForTurn,{entity:card,amount:1})),when(b.read(v=>v.input.state.upgraded&&v.query(cardInstances.exports.current,v.get(card)).cost>1),sequence(call(cardInstances.exports.setCostForCombat,{entity:card,amount:1}),call(cardInstances.exports.setCostForTurn,{entity:card,amount:1}))),
  ))));
  const madness=queue(defineEffect<CardUse,void>(b=>{const hand=b.local<readonly number[]>(),turn=b.local<boolean>(),index=b.local<number>(),card=b.local<number>();return sequence(
    b.assign(hand,b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand))),b.assign(turn,b.read(v=>v.get(hand).some(card=>v.query(cardInstances.exports.current,card).costForTurn>0))),when(b.read(v=>!v.get(turn)&&!v.get(hand).some(card=>v.query(cardInstances.exports.current,card).cost>0)),b.return(undefined)),
    whileDo(true,sequence(b.assign(index,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.get(hand).length-1)})),b.assign(card,b.read(v=>v.get(hand)[v.get(index)]!)),when(b.read(v=>{const c=v.query(cardInstances.exports.current,v.get(card));return v.get(turn)?c.costForTurn>0:c.cost>0;}),sequence(call(cardInstances.exports.setCostForCombat,{entity:card,amount:0}),call(cardInstances.exports.setCostForTurn,{entity:card,amount:0}),b.return(undefined))))),
  );}));
  const shackles=defineEffect<CardUse,void>(b=>sequence(call(cardPower(basicPowers.exports.Strength,[9,15],true,true),b.input),when(b.read(v=>v.input.target!==null&&v.query(attributes.exports.artifact,v.input.target)>0),call(cardPower(shackledPower.exports.Shackled,[9,15],true,false),b.input))));
  return{exports:{DarkShackles:concreteCard('DARK_SHACKLES',shackles),
    Apotheosis:concreteCard('APOTHEOSIS',apotheosis),
    Apparition:concreteCard('APPARITION',cardPower(defensePowers.exports.PlayerIntangible,1)),
    BandageUp:concreteCard('BANDAGE_UP',heal([4,6])),
    Blind:concreteCard('BLIND',defineEffect<CardUse,void>(b=>when(b.read(v=>v.input.state.upgraded),call(allPower(basicPowers.exports.EnemyWeak,2),b.input),call(cardPower(basicPowers.exports.EnemyWeak,2,true,true),b.input)))),
    Enlightenment:concreteCard('ENLIGHTENMENT',enlightenment),
    GoodInstincts:concreteCard('GOOD_INSTINCTS',cardBlock([6,9])),
    Impatience:concreteCard('IMPATIENCE',cardDraw([2,3])),
    Jax:concreteCard('JAX',composePrograms(hpLoss(3),cardPower(basicPowers.exports.Strength,[2,3]))),
    Madness:concreteCard('MADNESS',madness),
    MasterOfStrategy:concreteCard('MASTER_OF_STRATEGY',cardDraw([3,4])),
    Panacea:concreteCard('PANACEA',cardPower(basicPowers.exports.PlayerArtifact,[1,2])),
    PanicButton:concreteCard('PANIC_BUTTON',composePrograms(cardBlock([30,40]),cardPower(basicPowers.exports.NoBlock,2,false,true))),
    Trip:concreteCard('TRIP',defineEffect<CardUse,void>(b=>when(b.read(v=>v.input.state.upgraded),call(allPower(basicPowers.exports.EnemyVulnerable,2),b.input),call(cardPower(basicPowers.exports.EnemyVulnerable,2,true,true),b.input))))}};
}});
