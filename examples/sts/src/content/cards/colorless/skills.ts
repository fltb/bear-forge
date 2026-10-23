import {cardTargets} from '../../../rules/card-targets.ts';
import {shackledPower} from "../../powers/shackled.ts";
import {rules} from '../../../rules/execution.ts';
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
import {concreteCard,composePrograms,cardBlock,cardDraw,cardPower,cardAmount,describeAmounts,type CardAmount,type DescribedPower} from "../shared/programs.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import {describeProgram,programText,inheritPrograms} from '../shared/program-facts.ts';
const {defineRules,defineEffect,sequence,forEach,when,whileDo,call,query,enqueue}=rules;
export const colorlessSkillCards=defineRules({requires:[cardTargets,shackledPower,battles,basicPowers,defensePowers],build(){
  const queue=(effect:rules.Effect<CardUse,void>,retained=false)=>inheritPrograms(defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>{const s=v.query(battles.exports.status,v.input.battle);return retained?s.scope:s.actionScope;}),eligible:'captured'})),effect);
  const heal=(amount:CardAmount)=>describeAmounts(defineEffect<CardUse,void>(b=>enqueue(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v))},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),eligible:'captured'})),[amount],value=>`回复${value}生命。`);
  const hpLoss=(amount:number)=>queue(describeAmounts(defineEffect<CardUse,void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.owner),amount,selfDamage:true}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle)))),[amount],value=>`失去${value}生命。`),true);
  function allPower(power:DescribedPower,amount:CardAmount){const definition=power.definition;return describeAmounts(defineEffect<CardUse,void>(b=>forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),target=>enqueue(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:target,definition,amount:b.read(v=>cardAmount(amount,v)),source:b.read(v=>v.input.owner),debuff:true,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))),[amount],value=>`对所有敌人施加${value}层${power.name}（可被人工制品抵消）。${power.text}`);}
  const upgradeZones=[{key:'hand',name:'手牌'},{key:'draw',name:'抽牌堆'},{key:'discard',name:'弃牌堆'},{key:'exhaust',name:'消耗堆'}] as const;
  const apotheosis=queue(describeProgram(defineEffect<CardUse,void>(b=>forEach(b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles);return upgradeZones.map(zone=>p[zone.key]);}),zone=>forEach(query(zones.exports.members,zone),card=>call(cardInstances.exports.upgrade,card)))),`升级${upgradeZones.map(zone=>zone.name).join('、')}中的所有牌。`));
  const enlightenmentCost=1,madnessCost=0;
  const enlightenment=queue(describeAmounts(defineEffect<CardUse,void>(b=>forEach(b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand)),card=>sequence(
    when(b.read(v=>v.query(cardInstances.exports.current,v.get(card)).costForTurn>enlightenmentCost),call(cardInstances.exports.setCostForTurn,{entity:card,amount:enlightenmentCost})),when(b.read(v=>v.input.state.upgraded&&v.query(cardInstances.exports.current,v.get(card)).cost>enlightenmentCost),sequence(call(cardInstances.exports.setCostForCombat,{entity:card,amount:enlightenmentCost}),call(cardInstances.exports.setCostForTurn,{entity:card,amount:enlightenmentCost}))),
  ))),[enlightenmentCost],cost=>`将手牌中本回合费用大于${cost}的牌本回合费用降至${cost}；升级后另将基础费用大于${cost}的手牌本场战斗及本回合费用降至${cost}。`));
  const madness=queue(describeAmounts(defineEffect<CardUse,void>(b=>{const hand=b.local<readonly number[]>(),turn=b.local<boolean>(),index=b.local<number>(),card=b.local<number>();return sequence(
    b.assign(hand,b.read(v=>v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand))),b.assign(turn,b.read(v=>v.get(hand).some(card=>v.query(cardInstances.exports.current,card).costForTurn>madnessCost))),when(b.read(v=>!v.get(turn)&&!v.get(hand).some(card=>v.query(cardInstances.exports.current,card).cost>madnessCost)),b.return(undefined)),
    whileDo(true,sequence(b.assign(index,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.get(hand).length-1)})),b.assign(card,b.read(v=>v.get(hand)[v.get(index)]!)),when(b.read(v=>{const c=v.query(cardInstances.exports.current,v.get(card));return v.get(turn)?c.costForTurn>madnessCost:c.cost>madnessCost;}),sequence(call(cardInstances.exports.setCostForCombat,{entity:card,amount:madnessCost}),call(cardInstances.exports.setCostForTurn,{entity:card,amount:madnessCost}),b.return(undefined))))),
  );}),[madnessCost],cost=>`随机选择1张本回合费用大于${cost}的手牌；若没有则从基础费用大于${cost}的手牌中选；将其本场战斗及本回合费用设为${cost}。`));
  const loseStrength=cardPower(basicPowers.exports.programs.Strength,[-9,-15],true,true),restoreStrength=cardPower(shackledPower.exports.programs.Shackled,[9,15],true,false);
  const loseStrengthText=programText(loseStrength),restoreStrengthText=programText(restoreStrength);
  const shackles=describeProgram(defineEffect<CardUse,void>(b=>sequence(call(loseStrength,b.input),when(b.read(v=>v.input.target!==null&&v.query(attributes.exports.artifact,v.input.target)===0),call(restoreStrength,b.input)))),loseStrengthText===undefined||restoreStrengthText===undefined?undefined:`${loseStrengthText}若当前目标没有人工制品：${restoreStrengthText}`);
  const impatienceCount:CardAmount=[2,3];
  const impatience=queue(describeAmounts(defineEffect<CardUse,void>(b=>when(b.read(v=>!v.query(zones.exports.members,v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).hand).some(card=>v.query(cardInstances.exports.metadata,card).type===0)),call(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count:b.read(v=>cardAmount(impatienceCount,v))}))),[impatienceCount],count=>`若手牌中没有攻击牌，抽${count}张牌。`));
  function debuff(power:DescribedPower,amount:CardAmount){const all=allPower(power,amount),target=cardPower(power,amount,true,true),allText=programText(all),targetText=programText(target);return describeProgram(defineEffect<CardUse,void>(b=>when(b.read(v=>v.input.state.upgraded),call(all,b.input),call(target,b.input))),allText===undefined||targetText===undefined?undefined:`未升级：${targetText}升级后：${allText}`);}
  return{exports:{DarkShackles:concreteCard('DARK_SHACKLES',shackles),
    Apotheosis:concreteCard('APOTHEOSIS',apotheosis),
    Apparition:concreteCard('APPARITION',cardPower(defensePowers.exports.programs.PlayerIntangible,1)),
    BandageUp:concreteCard('BANDAGE_UP',heal([4,6])),
    Blind:concreteCard('BLIND',debuff(basicPowers.exports.programs.EnemyWeak,2)),
    Enlightenment:concreteCard('ENLIGHTENMENT',enlightenment),
    GoodInstincts:concreteCard('GOOD_INSTINCTS',cardBlock([6,9])),
    Impatience:concreteCard('IMPATIENCE',impatience),
    Jax:concreteCard('JAX',composePrograms(hpLoss(3),cardPower(basicPowers.exports.programs.Strength,[2,3]))),
    Madness:concreteCard('MADNESS',madness),
    MasterOfStrategy:concreteCard('MASTER_OF_STRATEGY',cardDraw([3,4])),
    Panacea:concreteCard('PANACEA',cardPower(basicPowers.exports.programs.PlayerArtifact,[1,2])),
    PanicButton:concreteCard('PANIC_BUTTON',composePrograms(cardBlock([30,40]),cardPower(basicPowers.exports.programs.NoBlock,2,false,true))),
    Trip:concreteCard('TRIP',debuff(basicPowers.exports.programs.EnemyVulnerable,2))}};
}});
