import {volibearCardDescriptions as descriptions} from '../cards/metadata.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {counterPolicies,attachAbilities} from '../../../powers/utils.ts';
import {volibearPlayCounts} from '../mechanics/play-counts.ts';
import {volibearTraining} from '../mechanics/training.ts';

export const volibearInscription=rules.defineRules({requires:[battles,powers,volibearPlayCounts,volibearTraining],build(){
  const inscribe=rules.on(battles.exports.using,{
    condition:rules.defineQuery({
      input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),
      dependencies:[powers.exports.enabled,volibearTraining.exports.eligible,volibearPlayCounts.exports.fixedCount,battles.exports.current],
      base:(r,c)=>c.event.owner===c.owner&&c.event.triggerOnUse&&!c.event.purgeOnUse&&r.query(powers.exports.enabled,c.source)&&
        r.query(volibearTraining.exports.eligible,c.event.card)&&r.query(volibearPlayCounts.exports.fixedCount,{battle:c.event.battle,turn:r.query(battles.exports.current,c.event.battle).turn})===0,
    }),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.call(volibearTraining.exports.add,{
      battle:b.read(v=>v.input.event.battle),card:b.read(v=>v.input.event.card),amount:b.read(v=>v.get(rules.query(powers.exports.level,v.input.source))),
    })),
  });
  const ThunderInscription=rules.defineEntity(powers.exports.kind,{display:{name:descriptions.R04.metadata.name,text:descriptions.R04.text},
    ...counterPolicies({bits:32,zeroIsNoop:true}),attach:attachAbilities(inscribe),
  });
  return {exports:{ThunderInscription}};
}});
