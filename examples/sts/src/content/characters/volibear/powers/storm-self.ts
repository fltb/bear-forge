import {volibearCardDescriptions as descriptions} from '../cards/metadata.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {attachAbilities,counterPolicies} from '../../../powers/utils.ts';

export const volibearStormSelf=rules.defineRules({requires:[cardTargets,cardInstances,battles,powers],build(){
  const expand=rules.modify(cardTargets.exports.enemies,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number[]>>(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>{
      const type=r.query(cardInstances.exports.metadata,c.input.card).type;return c.input.owner===c.owner&&(type===0||type===1);
    }}),
    dependencies:[battles.exports.targets],transform:(r,c)=>[...r.query(battles.exports.targets,c.input.battle)],
  });
  return{exports:{StormIsMe:rules.defineEntity(powers.exports.kind,{display:{name:descriptions.R15.metadata.name,text:descriptions.R15.text},...counterPolicies({bits:32,flag:true}),attach:attachAbilities(expand)})}};
}});
