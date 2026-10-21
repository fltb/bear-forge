import {volibearRepeat} from '../mechanics/repeat.ts';
import {volibearConduction} from '../powers/conduction.ts';
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
import {volibearLightningPowers} from '../powers/lightning.ts';
import {volibearStanding} from '../powers/standing.ts';
import {volibearStrength} from '../mechanics/strength.ts';
import {volibearPreparation} from '../mechanics/preparation.ts';
import {volibearPlayCounts} from '../mechanics/play-counts.ts';
import {volibearFury} from '../powers/fury.ts';
import {volibearPrey} from '../powers/prey.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {cardAmount,type CardAmount} from '../../../cards/shared/programs.ts';
import type {PowerDefinition} from '../../../../rules/powers.types.ts';

export const volibearUncommonCards=rules.defineRules({requires:[volibearRepeat,volibearConduction,volibearCardPrograms,basicPowers,volibearLightningPowers,volibearStanding,volibearStrength,volibearPreparation,volibearPlayCounts,volibearFury,volibearEngagePreparation,volibearPrey],build(){
  const mountainDiscount=rules.modify(battles.exports.cost,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),base:(_r,c)=>c.input.card===c.source&&c.value>=0}),
    dependencies:[volibearPlayCounts.exports.beforeTarget],
    transform:(r,c)=>Math.max(0,c.value-Math.min(2,r.query(volibearPlayCounts.exports.beforeTarget,c.input))),
  });
  const deploy=(definition:PowerDefinition,amount:CardAmount=[2,3])=>rules.defineEffect<CardUse,void>(b=>rules.call(powers.exports.apply,{
    definition,registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
    scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
    actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(amount,v)),debuff:false,
  }));
  const doubleStrength=rules.defineEffect<CardUse,void>(b=>rules.call(powers.exports.apply,{
    registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
    scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
    actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,
    amount:b.read(v=>Math.max(0,v.get(rules.query(attributes.exports.strength,v.input.owner)))),debuff:false,
  }));
  const weak=rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(battles.exports.targets,b.read(v=>v.input.battle)),target=>rules.call(powers.exports.apply,{
    registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
    scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),
    actor:target,source:b.read(v=>v.input.owner),definition:basicPowers.exports.EnemyWeak,
    amount:b.read(v=>v.input.state.upgraded?2:1),debuff:true,
  })));
  const unstoppable=rules.defineEffect<CardUse,void>(b=>{
    const ready=b.local<boolean>();
    return rules.sequence(
      b.assign(ready,b.read(v=>v.get(rules.query(volibearPlayCounts.exports.count,{
        battle:v.input.battle,turn:v.get(rules.query(battles.exports.current,v.input.battle)).turn,target:null,
      }))>=2)),
      rules.call(attack([10,14]),b.input),
      rules.when(ready,rules.call(queued(rules.defineEffect<CardUse,void>(b=>rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.input.owner),amount:2}))),b.input)),
    );
  });
  return {exports:{
    StormReturns:card(cards.U11,queued(volibearRepeat.exports.prepare)),
    StormConduction:card(cards.U02,compose(thunder(6),queued(deploy(volibearConduction.exports.StormConduction,1)))),
    Standing:card(cards.U03,queued(deploy(volibearStanding.exports.Standing,1))),
    MountainLift:card(cards.U05,attack(v=>v.get(rules.query(resources.exports.current,v.input.owner)).block,1,false,false)),
    SavageBite:card(cards.U06,attack([7,9],3)),
    MountainCollapse:card(cards.U07,attack([28,36]),{created:registerCardAbilities(mountainDiscount)}),
    PrimalStrength:card(cards.U12,queued(doubleStrength)),
    StrengthReclaimed:card(cards.U13,queued(volibearStrength.exports.reclaim)),
    EngagePreparation:card(cards.U14,compose(block([5,8]),queued(volibearEngagePreparation.exports.prepare))),
    Prepared:card(cards.U16,queued(volibearPreparation.exports.prepare)),
    Unstoppable:card(cards.U20,unstoppable),
    ThunderAftershock:card(cards.U21,queued(deploy(volibearLightningPowers.exports.ThunderAftershock))),
    WindRoar:card(cards.U23,compose(queued(weak),block([7,10]))),
    PreyStillStands:card(cards.U25,compose(queued(deploy(volibearPrey.exports.PreyStillStands,[1,2])),draw(1))),
    GrowingFury:card(cards.U26,compose(queued(deploy(volibearFury.exports.GrowingFury,[1,2])),queued(deploy(basicPowers.exports.Strength,1)))),
    GatheringThunder:card(cards.U29,queued(deploy(volibearLightningPowers.exports.GatheringThunder))),
  }};
}});
