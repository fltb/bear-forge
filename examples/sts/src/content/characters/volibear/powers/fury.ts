import {volibearCardDescriptions as descriptions} from '../cards/metadata.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {counterPolicies,attachAbilities} from '../../../powers/utils.ts';
import {volibearPlayCounts,type CountedAttack} from '../mechanics/play-counts.ts';

export const volibearFury=rules.defineRules({requires:[battles,powers,basicPowers,volibearPlayCounts],build(){
  const secondAttack=rules.on(volibearPlayCounts.exports.counted,{
    condition:rules.defineQuery({
      input:z.custom<rules.ReactionContext<CountedAttack>>(),output:z.boolean(),dependencies:[powers.exports.enabled],
      base:(r,c)=>c.event.use.owner===c.owner&&c.event.ordinal===2&&r.query(powers.exports.enabled,c.source),
    }),
    effect:rules.defineEffect<rules.ReactionContext<CountedAttack>,void>(b=>rules.enqueue(powers.exports.apply,{
      definition:basicPowers.exports.Strength,actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),debuff:false,
      registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.use.battle)).registry),
      scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.use.battle)).scope),
      amount:b.read(v=>v.get(rules.query(powers.exports.level,v.input.source))),
    },{
      queue:actionQueue,source:b.read(v=>v.input.source),eligible:'captured',
      lifetime:b.read(v=>v.get(rules.query(battles.exports.current,v.input.event.use.battle)).actionScope),
    })),
  });
  const GrowingFury=rules.defineEntity(powers.exports.kind,{display:{name:descriptions.U26.metadata.name,text:descriptions.U26.text},
    ...counterPolicies({bits:32,zeroIsNoop:true}),attach:attachAbilities(secondAttack),
  });
  return {exports:{GrowingFury}};
}});
