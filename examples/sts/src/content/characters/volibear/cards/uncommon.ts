import {volibearS2Powers} from '../powers/s2.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {deployPower,openDomain,conditional,gainCharge} from './operations.ts';
import {describeProgram,describeAmount,programText} from '../../../cards/shared/program-facts.ts';
import {describeAmounts} from '../../../cards/shared/programs.ts';
import {inheritPrograms} from '../../../cards/shared/program-facts.ts';
import {volibearStormPowers} from '../powers/storm.ts';
import {attributes as stormAttributes} from '../../../../rules/attributes.ts';
import {volibearRepeat} from '../mechanics/repeat.ts';
import {rules} from '../../../../rules/execution.ts';
import {z} from 'zod';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {powers} from '../../../../rules/powers.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,compose,queued,draw,thunder} from './programs.ts';
import {volibearStanding} from '../powers/standing.ts';
import {volibearStrength} from '../mechanics/strength.ts';
import {volibearDomain} from '../mechanics/domain.ts';
import {volibearPlayCounts} from '../mechanics/play-counts.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {cardAmount,type CardAmount} from '../../../cards/shared/programs.ts';
import type {PowerDefinition} from '../../../../rules/powers.types.ts';

export const volibearUncommonCards=rules.defineRules({requires:[volibearS2Powers,stormCharge,volibearStormPowers,volibearRepeat,volibearCardPrograms,basicPowers,volibearStanding,volibearStrength,volibearDomain,volibearPlayCounts,volibearEngagePreparation],build(){

  const mountainDiscount=rules.modify(battles.exports.cost,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),base:(_r,c)=>c.input.card===c.source&&c.value>=0}),
    dependencies:[volibearPlayCounts.exports.beforeTarget],
    transform:(r,c)=>Math.max(0,c.value-r.query(volibearPlayCounts.exports.beforeTarget,c.input)),
  });
  const primal=deployPower(volibearStormPowers.exports.programs.PrimalThunder,describeAmount((v:rules.ReadView<CardUse>)=>Math.max(0,v.query(stormAttributes.exports.strength,v.input.owner)),'当前正力量'));
  const weakAmount=[1,2] as const;
  const weak=rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(battles.exports.targets,b.read(v=>v.input.battle)),target=>rules.call(powers.exports.apply,{
    registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
    scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
    actor:target,source:b.read(v=>v.input.owner),definition:basicPowers.exports.EnemyWeak,
    amount:b.read(v=>cardAmount(weakAmount,v)),debuff:true,
  })));
  describeAmounts(weak,[weakAmount],n=>`对全体敌人施加${n}虚弱。`);
  const priorAttacks=2,energyGain=2;
  const unstoppableAttack=attack([10,14]);
  const enoughAttacks=describeProgram((v:rules.ReadView<CardUse>)=>v.query(volibearPlayCounts.exports.before,v.input).previousAttack,'上一张实际打出的是攻击牌，');
  const energyReward=describeProgram(rules.defineEffect<CardUse,void>(b=>rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount([2,3],v))})),'获得2（3）能量。');
  const unstoppable=conditional(enoughAttacks,queued(energyReward),undefined,unstoppableAttack);
  return {exports:{
    StormReturns:card(cards.U11,queued(volibearRepeat.exports.prepare)),
    StormConduction:card(cards.U02,compose(thunder([6,9]),queued(volibearS2Powers.exports.deployConduction))),
    Standing:card(cards.U03,compose(block([8,12]),queued(deployPower(volibearStanding.exports.programs.Standing,[12,8])))),
    MountainLift:card(cards.U05,attack(describeAmount((v:rules.ReadView<CardUse>)=>v.get(rules.query(resources.exports.current,v.input.owner)).block,'当前格挡（不消耗格挡）'),1,false,false)),
    SavageBite:card(cards.U06,attack([8,11],3)),
    MountainCollapse:card(cards.U07,attack([28,36]),{created:describeProgram(registerCardAbilities(mountainDiscount),'本回合此前对该目标每打出一张攻击减费1，最终费用不低于0。')}),
    PrimalStrength:card(cards.U12,compose(queued(primal),draw([1,2]))),
    StrengthReclaimed:card(cards.U13,queued(volibearStrength.exports.reclaim)),
    EngagePreparation:card(cards.U14,compose(block([5,8]),queued(volibearEngagePreparation.exports.prepare))),
    Unstoppable:card(cards.U20,unstoppable),
    ThunderAftershock:card(cards.U21,queued(volibearS2Powers.exports.deployAftershock)),
    WindRoar:card(cards.U23,compose(queued(weak),block([9,12]))),
    PreyStillStands:card(cards.U25,compose(draw(1),queued(volibearS2Powers.exports.deployPrey))),
    GrowingFury:card(cards.U26,compose(queued(volibearS2Powers.exports.deployFury),queued(deployPower(basicPowers.exports.programs.Strength,1)))),
    GatheringThunder:card(cards.U29,queued(gainCharge([2,3]))),
  }};
}});
