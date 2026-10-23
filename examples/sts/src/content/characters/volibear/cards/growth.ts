import {amountFormula} from './operations.ts';
import {describeProgram,amountText} from '../../../cards/shared/program-facts.ts';
import {volibearEngage,type EngageReceipt} from '../mechanics/engage.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {zones} from '../../../../rules/zones.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {volibearCopying,type CombatCopy} from '../mechanics/copying.ts';
import {volibearTraining} from '../mechanics/training.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,cardConfig,attack,block,compose,queued} from './programs.ts';

export const volibearGrowthCards=rules.defineRules({requires:[battles,cardPiles,zones,volibearEngage,volibearCardPrograms,cardInstances,volibearCopying,volibearTraining],build(){
  // Each combat copy starts at zero; no return hook writes this value back to
  // its permanent master. Keep block growth separate from fixed attack growth.
  const attackIncrement=[5,8] as const,blockIncrement=2;
  const blockGrowth=rules.defineComponent({schema:z.number().int().nonnegative(),initial:()=>0});
  const attackGrowth=rules.defineComponent({schema:z.number().int().nonnegative(),initial:()=>0});
  const growthAmount=rules.defineQuery({input:z.int32(),output:z.number().int(),reads:[attackGrowth],base:(r,entity)=>r.component(entity,attackGrowth)});
  const ownGrowth=rules.modify(volibearTraining.exports.permanentBonus,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),
    dependencies:[growthAmount],transform:(r,c)=>c.value+r.query(growthAmount,c.source),
  });
  const growAttack=rules.on(volibearEngage.exports.completed,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<EngageReceipt>>(),output:z.boolean(),dependencies:[battles.exports.status,cardPiles.exports.bindings,zones.exports.location],base:(r,c)=>{const piles=r.query(cardPiles.exports.bindings,r.query(battles.exports.status,c.event.use.battle).piles);return c.event.use.owner===c.owner&&c.event.action.performed&&[piles.hand,piles.draw,piles.discard].some(zone=>zone===r.query(zones.exports.location,c.source));}}),
    effect:rules.defineEffect<rules.ReactionContext<EngageReceipt>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),attackGrowth,b.read(v=>v.get(rules.readComponent(v.input.source,attackGrowth))+attackIncrement[v.query(cardInstances.exports.current,v.input.source).upgraded?1:0]))),
  });
  const growBlock=rules.defineEffect<CardUse,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.card),blockGrowth,n=>n+blockIncrement));
  const copyGrowth=rules.on(volibearCopying.exports.copied,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CombatCopy>>(),output:z.boolean(),base:(_r,c)=>c.event.copy===c.source}),
    effect:rules.defineEffect<rules.ReactionContext<CombatCopy>,void>(b=>rules.updateLocalComponent(
      b.read(v=>v.input.event.copy),blockGrowth,rules.readComponent(b.read(v=>v.input.event.source),blockGrowth),
    )),
  });
  const copyAttackGrowth=rules.on(volibearCopying.exports.copied,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CombatCopy>>(),output:z.boolean(),base:(_r,c)=>c.event.copy===c.source}),
    effect:rules.defineEffect<rules.ReactionContext<CombatCopy>,void>(b=>rules.updateLocalComponent(
      b.read(v=>v.input.event.copy),attackGrowth,rules.readComponent(b.read(v=>v.input.event.source),attackGrowth),
    )),
  });
  describeProgram(growBlock,`本牌本战基础格挡增加${blockIncrement}；复制继承，不写回永久牌组。`);
  const NeverLetGo=rules.defineEntity(cardInstances.exports.kind,cardConfig(cards.U08,attack([8,10]),{
    created:describeProgram(registerCardAbilities(growAttack,copyAttackGrowth,ownGrowth),`每次实际完成迎战，本牌位于手牌、抽牌堆或弃牌堆时，本战固定攻击伤害增加${amountText(attackIncrement)}；复制继承，不写回永久牌组。`),
  }),{components:[attackGrowth]});
  const TemperingClaw=rules.defineEntity(cardInstances.exports.kind,cardConfig(cards.U27,compose(
    attack([8,11]),
    block(amountFormula([6,8],(base,v)=>base+v.get(rules.readComponent(v.input.card,blockGrowth)),base=>`${base}+本牌本战格挡成长`)),
    queued(growBlock),
  ),{created:describeProgram(registerCardAbilities(copyGrowth),'')}),{components:[blockGrowth]});
  return {exports:{TemperingClaw,NeverLetGo,blockGrowth,attackGrowth}};
}});
