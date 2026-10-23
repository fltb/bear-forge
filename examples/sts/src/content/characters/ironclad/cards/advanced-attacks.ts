import {attackProgram,inheritPrograms,describeProgram,describeAmount,programText} from '../../../cards/shared/program-facts.ts';
import {xCost} from '../../../../rules/x-cost.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {rules} from '../../../../rules/execution.ts';
import {battles} from "../../../../rules/battles.ts";
import {cardInstances} from "../../../../rules/card-instances.ts";
import {cardPiles} from "../../../../rules/card-piles.ts";
import {zones} from "../../../../rules/zones.ts";
import {resources} from "../../../../rules/resources.ts";
import {attributes} from "../../../../rules/attributes.ts";
import {damage} from "../../../../rules/damage.ts";
import {powers} from "../../../../rules/powers.ts";
import {random} from "../../../../rules/random.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {concreteCard,composePrograms,targetAttack,additiveAmount,cardAmount,describeAmounts,type CardAmount} from "../../../cards/shared/programs.ts";
import type {CardUse,CardState} from "../../../../rules/card-instances.types.ts";
import type {HitRequest} from "../../../../rules/damage.types.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query,enqueue}=rules;
export const advancedAttacks=defineRules({requires:[xCost,cardTargets,cardEffects,battles,basicPowers],build(){
  const queue=(effect:rules.Effect<CardUse,void>)=>inheritPrograms(defineEffect<CardUse,void>(b=>enqueue(effect,b.input,{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),effect);
  const hand=(v:rules.ReadView<CardUse>)=>v.query(zones.exports.members,v.query(cardPiles.exports.current,v.query(battles.exports.current,v.input.battle).piles).hand);
  const addSpecial=defineEffect<{use:CardUse;amount:number;permanent:boolean},void>(b=>{const next=b.local<CardState>();return sequence(
    b.assign(next,b.read(v=>{const c=v.query(battles.exports.context,{battle:v.input.use.battle,play:v.input.use.play}).state;return{...c,specialData:((c.specialData+v.input.amount)<<16)>>16};})),
    call(battles.exports.setPlayState,{battle:b.read(v=>v.input.use.battle),play:b.read(v=>v.input.use.play),state:next}),
    when(b.read(v=>v.input.use.purgeOnUse),when(b.read(v=>v.query(zones.exports.location,v.input.use.card)!==null),call(cardInstances.exports.setSpecialData,{entity:b.read(v=>v.input.use.card),value:b.read(v=>{const c=v.query(cardInstances.exports.current,v.input.use.card);return((c.specialData+v.input.amount)<<16)>>16;})}))),

  );});
  const dropkickAmount=[5,8] as const,fiendAmount=[7,10] as const,whirlwindAmount=[5,8] as const;
  const rampageGrowth=[5,8] as const,dropkickDraw=1,dropkickEnergy=1,feedGrowth=[3,4] as const;
  const rampageAttack=targetAttack(additiveAmount(8,describeAmount(v=>v.input.state.specialData,'本战累计伤害增量')));
  const rampage=describeAmounts(inheritPrograms(defineEffect<CardUse,void>(b=>sequence(call(rampageAttack,b.input),call(addSpecial,{use:b.input,amount:b.read(v=>cardAmount(rampageGrowth,v)),permanent:false}))),rampageAttack),[rampageGrowth],growth=>`${programText(rampageAttack)}本战伤害增量增加${growth}。`);
  const dropkick=queue(defineEffect<CardUse,void>(b=>{const vulnerable=b.local<number|null>();return sequence(
    b.assign(vulnerable,query(powers.exports.find,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.target!),definition:basicPowers.exports.EnemyVulnerable})),
    when(b.read(v=>v.input.target!==null&&v.query(battles.exports.targetable,v.input.target)&&v.get(vulnerable)!==null&&v.query(powers.exports.enabled,v.get(vulnerable)!)),sequence(
      enqueue(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count:dropkickDraw},{queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),
      enqueue(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:dropkickEnergy},{queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),
    )),enqueue(battles.exports.hit,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),amount:query(attributes.exports.attackAmount,{source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),card:b.read(v=>v.input.card),base:b.read(v=>cardAmount(dropkickAmount,v))}),attack:true,selfDamage:false},{queue:actionQueue,position:'front',source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),
  );}));
  function lethal(amount:CardAmount,reward:rules.Effect<CardUse,void>,attack=true){const act=defineEffect<{use:CardUse;amount:number},void>(b=>sequence(
    when(b.read(v=>v.input.use.target===null||!v.query(battles.exports.targetable,v.input.use.target)),b.return(undefined)),
    call(damage.exports.hit,{battle:b.read(v=>v.input.use.battle),source:b.read(v=>v.input.use.owner),target:b.read(v=>v.input.use.target!),amount:b.read(v=>v.input.amount),attack,selfDamage:false}),
    when(b.read(v=>v.query(resources.exports.vitality,v.input.use.target!).hp===0&&v.query(battles.exports.rewardEligible,{battle:v.input.use.battle,target:v.input.use.target!})),call(reward,b.read(v=>v.input.use))),call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle)),
  ));const effect=attackProgram(defineEffect<CardUse,void>(b=>enqueue(act,{use:b.input,amount:query(attributes.exports.attackAmount,{source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),card:b.read(v=>v.input.card),base:b.read(v=>cardAmount(amount,v))})},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})),amount);return programText(reward)===undefined?effect:describeAmounts(effect,[amount],damage=>`对目标造成${damage}伤害。击杀符合奖励条件的敌人时：${programText(reward)}`);}
  const feed=lethal([10,12],describeAmounts(defineEffect<CardUse,void>(b=>call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(feedGrowth,v))})),[feedGrowth],growth=>`永久增加${growth}最大生命。`));
  const sever=describeProgram(queue(defineEffect<CardUse,void>(b=>forEach(b.read(v=>[...hand(v)].reverse().filter(card=>v.query(cardInstances.exports.metadata,card).type!==0)),card=>enqueue(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'})))),`消耗手牌中所有非攻击牌。`);
  const fiend=defineEffect<CardUse,void>(b=>{const amount=b.local<number>();return sequence(b.assign(amount,query(attributes.exports.attackAmount,{source:b.read(v=>v.input.owner),target:b.read(v=>v.input.target!),card:b.read(v=>v.input.card),base:b.read(v=>cardAmount(fiendAmount,v))})),enqueue(defineEffect<{use:CardUse;amount:number},void>(b=>{const count=b.local<number>();return sequence(b.assign(count,b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.use.battle).piles);return v.query(zones.exports.members,p.hand).length;})),forEach(b.read(v=>Array.from({length:v.get(count)},(_,index)=>index)),()=>enqueue(battles.exports.hit,{battle:b.read(v=>v.input.use.battle),source:b.read(v=>v.input.use.owner),target:b.read(v=>v.input.use.target!),amount:b.read(v=>v.input.amount),attack:true,selfDamage:false},{queue:actionQueue,position:'front',source:b.read(v=>v.input.use.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.use.battle).actionScope),eligible:'captured'})),forEach(b.read(v=>Array.from({length:v.get(count)},(_,index)=>index)),()=>enqueue(defineEffect<CardUse,void>(b=>{const list=b.local<readonly number[]>(),at=b.local<number>();return sequence(b.assign(list,b.read(hand)),when(b.read(v=>v.get(list).length===0),b.return(undefined)),b.assign(at,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.get(list).length-1)})),call(cardPiles.exports.exhaust,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),card:b.read(v=>v.get(list)[v.get(at)]!)}));}),b.read(v=>v.input.use),{queue:actionQueue,position:'front',source:b.read(v=>v.input.use.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.use.battle).actionScope),eligible:'captured'})));}),{use:b.input,amount},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));});
  const whirlwind=defineEffect<CardUse,void>(b=>{const energy=b.local<number>();return sequence(b.assign(energy,b.read(v=>v.input.ignoreEnergyTotal?v.input.energyOnUse:Math.min(v.input.energyOnUse,v.query(resources.exports.stamina,v.input.owner).energy))),call(battles.exports.setEnergyOnUse,{battle:b.read(v=>v.input.battle),play:b.read(v=>v.input.play),value:energy}),enqueue(defineEffect<{use:CardUse;energy:number},void>(b=>{const matrix=b.local<HitRequest[]>(),count=b.local<number>();return sequence(
    when(b.read(v=>!(v.input.use.freeToPlay||v.input.use.state.freeToPlayOnce)),call(resources.exports.useEnergy,{entity:b.read(v=>v.input.use.owner),amount:b.read(v=>v.query(resources.exports.stamina,v.input.use.owner).energy)})),
    b.assign(matrix,b.read(v=>v.query(battles.exports.targets,v.input.use.battle).map(target=>({battle:v.input.use.battle,source:v.input.use.owner,target,amount:Math.min(65535,v.query(attributes.exports.attackAmount,{source:v.input.use.owner,target,base:whirlwindAmount[v.input.use.state.upgraded?1:0],card:v.input.use.card})),attack:true,selfDamage:false})))),
    b.assign(count,b.read(v=>v.query(xCost.exports.iterations,{...v.input.use,energyOnUse:v.input.energy}))),
    forEach(b.read(v=>Array.from({length:v.get(count)},(_,index)=>index)),()=>sequence(forEach(matrix,hit=>call(damage.exports.hit,hit)),call(battles.exports.checkOutcome,b.read(v=>v.input.use.battle)),when(b.read(v=>v.query(battles.exports.status,v.input.use.battle).outcome!==0),b.return(undefined)))),
  );}),{use:b.input,energy},{queue:actionQueue,source:b.read(v=>v.input.card),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));});
  const strikeBonus=[2,3] as const;
  const perfectedBonus=describeAmount((v:rules.ReadView<CardUse>)=>{const p=v.query(cardPiles.exports.current,v.query(battles.exports.current,v.input.battle).piles),count=p.registered.filter(card=>v.query(cardInstances.exports.metadata,card).strike).length;return count*cardAmount(strikeBonus,v);},`登记牌组中每张打击牌增加${strikeBonus[0]}（${strikeBonus[1]}）`);
  return{exports:{Dropkick:concreteCard('DROPKICK',describeAmounts(attackProgram(dropkick,dropkickAmount),[dropkickAmount],damage=>`对目标造成${damage}伤害。目标可被攻击且有生效的易伤时，获得${dropkickEnergy}能量并抽${dropkickDraw}张牌。`)),
    Feed:concreteCard('FEED',feed),
    FiendFire:concreteCard('FIEND_FIRE',describeAmounts(attackProgram(fiend,fiendAmount),[fiendAmount],damage=>`记录当前手牌张数，随机消耗等量手牌，再对目标造成${damage}伤害相同次数。`)),
    PerfectedStrike:concreteCard('PERFECTED_STRIKE',targetAttack(additiveAmount(6,perfectedBonus))),
    Rampage:concreteCard('RAMPAGE',rampage),
    SeverSoul:concreteCard('SEVER_SOUL',composePrograms(sever,targetAttack([16,22]))),
    Whirlwind:concreteCard('WHIRLWIND',describeAmounts(attackProgram(whirlwind,whirlwindAmount),[whirlwindAmount],damage=>`对全体敌人造成${damage}伤害，按本次X费用效果次数重复。非免费打出时消耗当前全部能量。`))}};
}});
