import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,describedAbility} from '../../../powers/utils.ts';
import {volibearPlayCounts,type CountedAttack} from '../mechanics/play-counts.ts';
import {volibearNextPlayDiscount} from '../mechanics/next-play-discount.ts';

export const volibearPrey=rules.defineRules({requires:[battles,powers,cardPiles,cardInstances,volibearPlayCounts,volibearNextPlayDiscount],build(){
  const ordinal=2;
  const triggeredTurn=rules.defineComponent({schema:z.int32().nonnegative(),initial:()=>0});
  const observer=rules.defineEntity(cardPiles.exports.drawObserverKind,{
    observed:rules.defineEffect<{observer:number;piles:number;card:number},void>(b=>rules.when(
      b.read(v=>v.query(cardInstances.exports.metadata,v.input.card).type===0),
      rules.call(volibearNextPlayDiscount.exports.grant,{battle:b.read(v=>v.query(cardPiles.exports.bindings,v.input.piles).battle),card:b.read(v=>v.input.card)}),
    )),
  });
  const reward=rules.defineEffect<{battle:number;count:number},void>(b=>{const observation=b.local<number>();return rules.sequence(
    b.assign(observation,rules.spawnEntity({definition:observer,owner:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),
    ruleModules.runTaskGroup(actionQueue,cardPiles.exports.drawObserved,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),count:b.read(v=>v.input.count),observer:observation}),
    rules.despawnEntity({entity:observation,reason:{drawCompleted:true}}),
  );});
  const second=rules.on(volibearPlayCounts.exports.counted,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CountedAttack>>(),output:z.boolean(),reads:[triggeredTurn],dependencies:[powers.exports.enabled,battles.exports.status],base:(r,c)=>
      c.event.use.owner===c.owner&&c.event.targetOrdinal===ordinal&&r.query(powers.exports.enabled,c.source)&&r.component(c.source,triggeredTurn)!==r.query(battles.exports.status,c.event.use.battle).turn}),
    effect:rules.defineEffect<rules.ReactionContext<CountedAttack>,void>(b=>rules.sequence(
      rules.updateLocalComponent(b.read(v=>v.input.source),triggeredTurn,b.read(v=>v.query(battles.exports.status,v.input.event.use.battle).turn)),
      rules.enqueue(reward,{battle:b.read(v=>v.input.event.use.battle),count:b.read(v=>v.query(powers.exports.level,v.input.source))},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.use.battle).actionScope),eligible:'captured'}),
    )),
  });
  const PreyStillStands=defineDescribedPower('猎物未倒',counterPolicies({bits:32,zeroIsNoop:true}),{display:true,components:[triggeredTurn]},describedAbility(`每回合首次对同一敌人实际打出第${ordinal}张指定单体攻击后，按层数抽牌；由此抽到的攻击获得：${volibearNextPlayDiscount.exports.text}`,second));
  return {exports:{PreyStillStands:PreyStillStands.definition,programs:{PreyStillStands},statusTexts:{PreyStillStands:PreyStillStands.text}}};
}});
