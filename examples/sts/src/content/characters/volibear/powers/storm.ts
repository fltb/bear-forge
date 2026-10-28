import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {powers} from '../../../../rules/powers.ts';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {turns} from '../../../../rules/turns.ts';
import type {TurnActor} from '../../../../rules/turns.types.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,describedAbility} from '../../../powers/utils.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {lightning,type Lightning} from '../mechanics/lightning.ts';
import {volibearEngage,type EngageReceipt} from '../mechanics/engage.ts';
import {volibearDamageTraining} from '../mechanics/damage-training.ts';


export const volibearStormPowers=rules.defineRules({requires:[powers,battles,resources,attributes,cardPiles,cardInstances,turns,stormCharge,lightning,volibearEngage,volibearDamageTraining],build(){
  const train=rules.on(battles.exports.using,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[cardInstances.exports.metadata],base:(r,c)=>c.event.owner===c.owner&&c.event.triggerOnUse&&!c.event.purgeOnUse&&r.query(cardInstances.exports.metadata,c.event.card).type===0}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>rules.sequence(
      rules.call(volibearDamageTraining.exports.add,{battle:b.read(v=>v.input.event.battle),card:b.read(v=>v.input.event.card),amount:b.read(v=>v.query(powers.exports.level,v.input.source))}),
      rules.call(powers.exports.deactivate,b.read(v=>v.input.source)),
    )),
  });
  const boost=rules.modify(lightning.exports.amount,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<Lightning,number>>(),output:z.boolean(),base:(_r,c)=>c.input.owner===c.owner}),
    dependencies:[powers.exports.level],transform:(r,c)=>c.value+r.query(powers.exports.level,c.source),
  });
  const expire=rules.on(turns.exports.playerRoundEnd,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<TurnActor>>(),output:z.boolean(),base:(_r,c)=>c.event.actor===c.owner}),
    effect:rules.defineEffect<rules.ReactionContext<TurnActor>,void>(b=>rules.call(powers.exports.deactivate,b.read(v=>v.input.source))),
  });
  const make=(name:string,...parts:ReturnType<typeof describedAbility>[])=>defineDescribedPower(name,counterPolicies({bits:32,zeroIsNoop:true,resetWhenInactive:true}),{display:true},...parts);
  const NextTraining=make('磨砺爪牙',describedAbility('下一张实际打出的攻击结算前，按层数增加该牌本战每次伤害（含动态攻击和雷伤），随后此状态失效。',train));
  const PrimalThunder=make('原始力量',describedAbility('自身每批雷伤增加层数数值。',boost),describedAbility('敌方阶段结束后失效。',expire));
  return{exports:{NextTraining:NextTraining.definition,PrimalThunder:PrimalThunder.definition,programs:{NextTraining,PrimalThunder},statusTexts:{NextTraining:NextTraining.text,PrimalThunder:PrimalThunder.text}}};
}});
