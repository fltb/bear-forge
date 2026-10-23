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
import {stormCharge,type ChargeSpent} from '../mechanics/storm-charge.ts';
import {lightning,type Lightning} from '../mechanics/lightning.ts';
import {volibearEngage,type EngageReceipt} from '../mechanics/engage.ts';
import {volibearDamageTraining} from '../mechanics/damage-training.ts';


export const volibearStormPowers=rules.defineRules({requires:[powers,battles,resources,attributes,cardPiles,cardInstances,turns,stormCharge,lightning,volibearEngage,volibearDamageTraining],build(){
  const face=rules.on(volibearEngage.exports.completed,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<EngageReceipt>>(),output:z.boolean(),base:(_r,c)=>c.event.use.owner===c.owner&&c.event.action.performed}),
    effect:rules.defineEffect<rules.ReactionContext<EngageReceipt>,void>(b=>rules.call(stormCharge.exports.gain,{battle:b.read(v=>v.input.event.use.battle),owner:b.read(v=>v.input.owner),amount:b.read(v=>v.query(powers.exports.level,v.input.source))})),
  });
  const exhaust=rules.on(cardPiles.exports.exhausted,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<{piles:number;card:number}>>(),output:z.boolean(),dependencies:[cardPiles.exports.bindings],base:(r,c)=>r.query(cardPiles.exports.bindings,c.event.piles).actor===c.owner}),
    effect:rules.defineEffect<rules.ReactionContext<{piles:number;card:number}>,void>(b=>rules.call(stormCharge.exports.gain,{battle:b.read(v=>v.query(cardPiles.exports.bindings,v.input.event.piles).battle),owner:b.read(v=>v.input.owner),amount:b.read(v=>v.query(powers.exports.level,v.input.source))})),
  });
  const ownSpend=rules.defineQuery({input:z.custom<rules.ReactionContext<ChargeSpent>>(),output:z.boolean(),base:(_r,c)=>c.event.owner===c.owner});
  const armor=rules.on(stormCharge.exports.spent,{condition:ownSpend,effect:rules.defineEffect<rules.ReactionContext<ChargeSpent>,void>(b=>rules.call(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.max(0,v.query(attributes.exports.blockAmount,{actor:v.input.owner,base:v.input.event.amount*v.query(powers.exports.level,v.input.source)})))}))});
  const flow=rules.on(stormCharge.exports.spent,{condition:ownSpend,effect:rules.defineEffect<rules.ReactionContext<ChargeSpent>,void>(b=>rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.input.event.battle).piles),count:b.read(v=>v.query(powers.exports.level,v.input.source))}))});
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
  const WelcomeThunder=make('迎雷',describedAbility('每次实际完成迎战，按层数获得蓄雷。',face));
  const Embers=make('余烬生雷',describedAbility('每当自身消耗一张牌，按层数获得蓄雷。',exhaust));
  const ThunderArmor=make('雷甲',describedAbility('每次实际消耗蓄雷，以消耗量乘层数为基础值获得格挡，受敏捷、脆弱修正。',armor));
  const UnendingStorm=make('不息风暴',describedAbility('每次实际消耗蓄雷事件，按层数抽牌；与本次消耗数量无关。',flow));
  const NextTraining=make('磨砺爪牙',describedAbility('下一张实际打出的攻击结算前，按层数增加该牌本战每次伤害（含动态攻击和雷伤），随后此状态失效。',train));
  const PrimalThunder=make('原始力量',describedAbility('自身每批雷伤增加层数数值。',boost),describedAbility('玩家回合结束时失效。',expire));
  return{exports:{WelcomeThunder:WelcomeThunder.definition,Embers:Embers.definition,ThunderArmor:ThunderArmor.definition,UnendingStorm:UnendingStorm.definition,NextTraining:NextTraining.definition,PrimalThunder:PrimalThunder.definition,programs:{WelcomeThunder,Embers,ThunderArmor,UnendingStorm,NextTraining,PrimalThunder},statusTexts:{WelcomeThunder:WelcomeThunder.text,Embers:Embers.text,ThunderArmor:ThunderArmor.text,UnendingStorm:UnendingStorm.text,NextTraining:NextTraining.text,PrimalThunder:PrimalThunder.text}}};
}});
