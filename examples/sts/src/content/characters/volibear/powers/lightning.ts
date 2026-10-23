import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {powers} from '../../../../rules/powers.ts';
import {resources} from '../../../../rules/resources.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,powerAbilities} from '../../../powers/utils.ts';
import {onProgram,modifyProgram} from '../../../powers/reaction-programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {lightning,type Lightning,type LightningReceipt} from '../mechanics/lightning.ts';

export const volibearLightningPowers=rules.defineRules({requires:[lightning,powers,resources,attributes],build(){
  const surge=modifyProgram(lightning.exports.amount,{
    condition:describeProgram(rules.defineQuery({input:z.custom<rules.ModifierContext<Lightning,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],
      base:(r,c)=>c.input.owner===c.owner&&r.query(powers.exports.enabled,c.source)}),'雷伤属于自身且能力启用'),
    dependencies:[powers.exports.level],transform:describeProgram((r:rules.QueryRead,c:rules.Borrowed<rules.ModifierContext<Lightning,number>>)=>c.value+r.query(powers.exports.level,c.source),'增加本能力层数。'),
  });
  const aftershock=onProgram(lightning.exports.settled,{
    condition:describeProgram(rules.defineQuery({input:z.custom<rules.ReactionContext<LightningReceipt>>(),output:z.boolean(),dependencies:[powers.exports.enabled],
      base:(r,c)=>c.event.owner===c.owner&&r.query(powers.exports.enabled,c.source)}),'雷伤属于自身且能力启用'),
    effect:describeProgram(rules.defineEffect<rules.ReactionContext<LightningReceipt>,void>(b=>rules.call(resources.exports.gainBlock,{
      entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.max(0,v.get(rules.query(attributes.exports.blockAmount,{
        actor:v.input.owner,base:v.get(rules.query(powers.exports.level,v.input.source)),
      })))),
    })),'自身获得以本能力层数为基础值、经过格挡量查询修正且最低为0的格挡。'),
  });
  const GatheringThunder=defineDescribedPower('雷霆渐盛',counterPolicies({bits:32,zeroIsNoop:true}),{display:true},powerAbilities(surge));
  const ThunderAftershock=defineDescribedPower('雷霆余威',counterPolicies({bits:32,zeroIsNoop:true}),{display:true},powerAbilities(aftershock));
  return {exports:{GatheringThunder:GatheringThunder.definition,ThunderAftershock:ThunderAftershock.definition,programs:{GatheringThunder,ThunderAftershock},statusTexts:{GatheringThunder:GatheringThunder.text,ThunderAftershock:ThunderAftershock.text}}};
}});
