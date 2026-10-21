import {volibearCardDescriptions as descriptions} from '../cards/metadata.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {powers} from '../../../../rules/powers.ts';
import {resources} from '../../../../rules/resources.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {counterPolicies,attachAbilities} from '../../../powers/utils.ts';
import {lightning,type Lightning,type LightningReceipt} from '../mechanics/lightning.ts';

export const volibearLightningPowers=rules.defineRules({requires:[lightning,powers,resources,attributes],build(){
  const surge=rules.modify(lightning.exports.amount,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<Lightning,number>>(),output:z.boolean(),dependencies:[powers.exports.enabled],
      base:(r,c)=>c.input.owner===c.owner&&r.query(powers.exports.enabled,c.source)}),
    dependencies:[powers.exports.level],transform:(r,c)=>c.value+r.query(powers.exports.level,c.source),
  });
  const aftershock=rules.on(lightning.exports.settled,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<LightningReceipt>>(),output:z.boolean(),dependencies:[powers.exports.enabled],
      base:(r,c)=>c.event.owner===c.owner&&r.query(powers.exports.enabled,c.source)}),
    effect:rules.defineEffect<rules.ReactionContext<LightningReceipt>,void>(b=>rules.call(resources.exports.gainBlock,{
      entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.max(0,v.get(rules.query(attributes.exports.blockAmount,{
        actor:v.input.owner,base:v.get(rules.query(powers.exports.level,v.input.source)),
      })))),
    })),
  });
  return {exports:{
    GatheringThunder:rules.defineEntity(powers.exports.kind,{display:{name:descriptions.U29.metadata.name,text:descriptions.U29.text},...counterPolicies({bits:32,zeroIsNoop:true}),attach:attachAbilities(surge)}),
    ThunderAftershock:rules.defineEntity(powers.exports.kind,{display:{name:descriptions.U21.metadata.name,text:descriptions.U21.text},...counterPolicies({bits:32,zeroIsNoop:true}),attach:attachAbilities(aftershock)}),
  }};
}});
