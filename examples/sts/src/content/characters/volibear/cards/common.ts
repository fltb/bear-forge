import {volibearPlayCounts} from '../mechanics/play-counts.ts';
import {gainCharge,openDomain,amountFormula,conditional} from './operations.ts';
import {describeProgram,programText} from '../../../cards/shared/program-facts.ts';
import {cardAmount,describeAmounts} from '../../../cards/shared/programs.ts';
import {inheritPrograms} from '../../../cards/shared/program-facts.ts';
import {volibearDomain} from '../mechanics/domain.ts';
import {volibearThunderGuard} from '../mechanics/thunder-guard.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {rules} from '../../../../rules/execution.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {zones} from '../../../../rules/zones.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,thunder,compose,queued,draw} from './programs.ts';
import {volibearOpportunities} from '../mechanics/opportunities.ts';
import {volibearStrength} from '../mechanics/strength.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';

export const volibearCommonCards=rules.defineRules({requires:[volibearPlayCounts,volibearDomain,volibearThunderGuard,stormCharge,volibearCardPrograms,basicPowers,volibearOpportunities,volibearStrength],build(){
  const pressAttack=attack([8,11]),pressBlock=block([6,8]),pressDraw=draw(1);
  const awaitingAttack=describeProgram((v:rules.ReadView<CardUse>)=>v.query(volibearOpportunities.exports.awaitingAttack,v.input),volibearOpportunities.exports.awaitingAttackText);
  const press=conditional(awaitingAttack,pressBlock,pressDraw,pressAttack);
  const vulnerableAmount=[1,2] as const;
  const vulnerable=rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(volibearCardPrograms.exports.singleTargets,b.input),target=>
    rules.when(rules.query(attributes.exports.damageable,target),rules.call(powers.exports.apply,{
      definition:basicPowers.exports.EnemyVulnerable,
      registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
      scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
      actor:target,source:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(vulnerableAmount,v)),debuff:true,
    })),
  ));
  describeAmounts(vulnerable,[vulnerableAmount],n=>`对目标施加${n}易伤。`);
  const wave=compose(attack([5,7],1,true),thunder([2,3]));
  return {exports:{
    Approach:card(cards.C01,attack([6,9])),
    TwinClaws:card(cards.C02,attack([5,7],2)),
    ThunderSmash:card(cards.C03,compose(attack([20,26]),thunder([5,7]))),
    LightningClaw:card(cards.C05,compose(queued(openDomain(1)),attack([6,9]))),
    PressForward:card(cards.C06,press),
    TearWound:card(cards.C08,compose(attack([8,10]),queued(vulnerable))),
    ThunderSweep:card(cards.C09,compose(attack([6,8],1,true),thunder([3,4]))),
    ThickFur:card(cards.C12,block(amountFormula([10,13],(base,v)=>base+Math.max(0,v.get(rules.query(attributes.exports.strength,v.input.owner))),base=>`${base}+正力量`))),
    ThunderGuard:card(cards.C14,compose(block([8,11]),queued(openDomain(1)),queued(volibearThunderGuard.exports.apply))),
    Charge:card(cards.C17,queued(volibearStrength.exports.charge)),
    Pursuit:card(cards.C20,conditional(describeProgram((v:rules.ReadView<CardUse>)=>v.query(volibearPlayCounts.exports.before,v.input).attacks>0,'本次出牌前打出过攻击，'),draw(2),undefined,attack([10,14]))),
    HoldGround:card(cards.C21,compose(block([5,8]),queued(openDomain(1)),draw(2))),
    ThunderShock:card(cards.C22,compose(wave,wave)),
  }};
}});
