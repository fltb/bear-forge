import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {defineDescribedPowerWithLifecycle as defineDescribedPower,powerAbilities,counterPolicies} from '../../../powers/utils.ts';
import {modifyProgram} from '../../../powers/reaction-programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';

export const volibearStormSelf=rules.defineRules({requires:[cardTargets,cardInstances,battles,powers],build(){
  const expand=modifyProgram(cardTargets.exports.enemies,{
    condition:describeProgram(rules.defineQuery({input:z.custom<rules.ModifierContext<CardUse,number[]>>(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>{
      const type=r.query(cardInstances.exports.metadata,c.input.card).type;return c.input.owner===c.owner&&(type===0||type===1);
    }}),'自身打出的攻击或技能'),
    dependencies:[battles.exports.targets],transform:describeProgram((r:rules.QueryRead,c:rules.Borrowed<rules.ModifierContext<CardUse,number[]>>)=>[...r.query(battles.exports.targets,c.input.battle)],'目标集合替换为本战全部存活敌人。'),
  });
  const StormIsMe=defineDescribedPower('风暴即我',counterPolicies({bits:32,flag:true}),{display:true},powerAbilities(expand));
  return{exports:{StormIsMe:StormIsMe.definition,programs:{StormIsMe},statusTexts:{StormIsMe:StormIsMe.text}}};
}});
