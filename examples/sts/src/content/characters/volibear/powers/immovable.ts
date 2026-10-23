import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {damage} from '../../../../rules/damage.ts';
import {powers} from '../../../../rules/powers.ts';
import type {BlockConsumption} from '../../../../rules/damage.types.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,powerAbilities} from '../../../powers/utils.ts';
import {modifyProgram} from '../../../powers/reaction-programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';

export const volibearImmovable=rules.defineRules({requires:[damage,powers],build(){
  const consumption=0;
  const preserve=modifyProgram(damage.exports.blockConsumption,{
    condition:describeProgram(rules.defineQuery({
      input:z.custom<rules.ModifierContext<BlockConsumption,number>>(),output:z.boolean(),
      dependencies:[powers.exports.enabled],
      base:(r,c)=>c.input.request.attack&&c.input.request.target===c.owner&&r.query(powers.exports.enabled,c.source),
    }),'自身被攻击且能力启用'),
    transform:describeProgram(()=>consumption,`实际格挡消耗设为${consumption}。`),
  });
  const ImmovableBody=defineDescribedPower('不动神躯',counterPolicies({bits:32,flag:true}),{display:true},powerAbilities(preserve));
  return {exports:{ImmovableBody:ImmovableBody.definition,programs:{ImmovableBody},statusTexts:{ImmovableBody:ImmovableBody.text}}};
}});
