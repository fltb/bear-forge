import {volibearCardDescriptions as descriptions} from '../cards/metadata.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {damage} from '../../../../rules/damage.ts';
import {powers} from '../../../../rules/powers.ts';
import type {BlockConsumption} from '../../../../rules/damage.types.ts';
import {counterPolicies,attachAbilities} from '../../../powers/utils.ts';

export const volibearImmovable=rules.defineRules({requires:[damage,powers],build(){
  const preserve=rules.modify(damage.exports.blockConsumption,{
    condition:rules.defineQuery({
      input:z.custom<rules.ModifierContext<BlockConsumption,number>>(),output:z.boolean(),
      dependencies:[powers.exports.enabled],
      base:(r,c)=>c.input.request.attack&&c.input.request.target===c.owner&&r.query(powers.exports.enabled,c.source),
    }),
    transform:()=>0,
  });
  const ImmovableBody=rules.defineEntity(powers.exports.kind,{display:{name:descriptions.R02.metadata.name,text:descriptions.R02.text},
    ...counterPolicies({bits:32,flag:true}),attach:attachAbilities(preserve),
  });
  return {exports:{ImmovableBody}};
}});
