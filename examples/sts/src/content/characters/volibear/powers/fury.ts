import {onProgram} from '../../../powers/reaction-programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,powerAbilities} from '../../../powers/utils.ts';
import {volibearPlayCounts,type CountedAttack} from '../mechanics/play-counts.ts';

export const volibearFury=rules.defineRules({requires:[battles,powers,basicPowers,volibearPlayCounts],build(){
  const ordinal=2;
  const secondAttack=onProgram(volibearPlayCounts.exports.counted,{
    condition:describeProgram(rules.defineQuery({
      input:z.custom<rules.ReactionContext<CountedAttack>>(),output:z.boolean(),dependencies:[powers.exports.enabled],
      base:(r,c)=>c.event.use.owner===c.owner&&c.event.ordinal===ordinal&&r.query(powers.exports.enabled,c.source),
    }),`由自身打出且为本回合第${ordinal}张攻击，并且能力启用`),
    effect:describeProgram(rules.defineEffect<rules.ReactionContext<CountedAttack>,void>(b=>rules.enqueue(powers.exports.apply,{
      definition:basicPowers.exports.Strength,actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),debuff:false,
      registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.use.battle)).registry),
      scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.use.battle)).scope),
      amount:b.read(v=>v.get(rules.query(powers.exports.level,v.input.source))),
    },{
      queue:actionQueue,source:b.read(v=>v.input.source),eligible:'captured',
      lifetime:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.use.battle)).actionScope),
    })),'向战斗行动队列加入：自身获得等于本能力层数的力量；使用捕获资格和本战行动作用域。'),
  });
  const GrowingFury=defineDescribedPower('愈战愈烈',counterPolicies({bits:32,zeroIsNoop:true}),{display:true},
    powerAbilities(secondAttack));
  return {exports:{GrowingFury:GrowingFury.definition,programs:{GrowingFury},statusTexts:{GrowingFury:GrowingFury.text}}};
}});
