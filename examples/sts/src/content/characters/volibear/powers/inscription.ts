import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,powerAbilities} from '../../../powers/utils.ts';
import {onProgram} from '../../../powers/reaction-programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {volibearPlayCounts} from '../mechanics/play-counts.ts';
import {volibearTraining} from '../mechanics/training.ts';

export const volibearInscription=rules.defineRules({requires:[battles,powers,volibearPlayCounts,volibearTraining],build(){
  const inscribe=onProgram(battles.exports.using,{
    condition:describeProgram(rules.defineQuery({
      input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),
      dependencies:[powers.exports.enabled,volibearTraining.exports.eligible,volibearPlayCounts.exports.fixedCount,battles.exports.current],
      base:(r,c)=>c.event.owner===c.owner&&c.event.triggerOnUse&&!c.event.purgeOnUse&&r.query(powers.exports.enabled,c.source)&&
        r.query(volibearTraining.exports.eligible,c.event.card)&&r.query(volibearPlayCounts.exports.fixedCount,{battle:c.event.battle,turn:r.query(battles.exports.current,c.event.battle).turn})===0,
    }),'自身实际打出的非清除牌具有固定攻击执行能力，且本回合尚未实际打出固定攻击牌，并且能力启用'),
    effect:describeProgram(rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.call(volibearTraining.exports.add,{
      battle:b.read(v=>v.input.event.battle),card:b.read(v=>v.input.event.card),amount:b.read(v=>v.get(rules.query(powers.exports.level,v.input.source))),
    })),'按本能力层数增加该牌本战每段固定攻击伤害。'),
  });
  const ThunderInscription=defineDescribedPower('雷霆铭身',counterPolicies({bits:32,zeroIsNoop:true}),{display:true},powerAbilities(inscribe));
  return {exports:{ThunderInscription:ThunderInscription.definition,programs:{ThunderInscription},statusTexts:{ThunderInscription:ThunderInscription.text}}};
}});
