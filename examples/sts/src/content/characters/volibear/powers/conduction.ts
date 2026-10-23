import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardEffects,type CardHitReceipt} from '../../../../rules/card-effects.ts';
import {powers} from '../../../../rules/powers.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,powerAbilities} from '../../../powers/utils.ts';
import {onProgram} from '../../../powers/reaction-programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {lightning} from '../mechanics/lightning.ts';

export const volibearConduction=rules.defineRules({requires:[cardEffects,powers,lightning],build(){
  const conduct=onProgram(cardEffects.exports.hitResolved,{
    condition:describeProgram(rules.defineQuery({input:z.custom<rules.ReactionContext<CardHitReceipt>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>
      c.event.use.owner===c.owner&&c.event.targeted&&c.event.request.attack&&c.event.request.target===c.event.use.target&&r.query(powers.exports.enabled,c.source)}),'自身指定目标的攻击段命中原目标，且能力启用'),
    effect:describeProgram(rules.defineEffect<rules.ReactionContext<CardHitReceipt>,void>(b=>rules.call(lightning.exports.resolve,{
      battle:b.read(v=>v.input.event.use.battle),owner:b.read(v=>v.input.owner),exclude:b.read(v=>v.input.event.use.target),
      // unblocked includes overkill; lost is capped by remaining HP.
      base:b.read(v=>v.input.event.result.unblocked*v.query(powers.exports.level,v.input.source)),
    })),'以穿过格挡的伤害（含过量伤害）乘本能力层数为基础，对原目标外敌人结算一批雷伤。'),
  });
  const StormConduction=defineDescribedPower('风暴传导',counterPolicies({bits:32,zeroIsNoop:true}),{display:true},powerAbilities(conduct));
  return{exports:{StormConduction:StormConduction.definition,programs:{StormConduction},statusTexts:{StormConduction:StormConduction.text}}};
}});
