import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {cardInstances} from '../../../../rules/card-instances.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {standardUpgrade,upgradeOnce,registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {volibearCopying,type CombatCopy} from '../mechanics/copying.ts';
import {volibearTraining} from '../mechanics/training.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,attack,block,compose,queued,type CardHitReceipt} from './programs.ts';

export const volibearGrowthCards=rules.defineRules({requires:[volibearCardPrograms,cardInstances,volibearCopying,volibearTraining],build(){
  // Each combat copy starts at zero; no return hook writes this value back to
  // its permanent master. Keep block growth separate from fixed attack growth.
  const blockGrowth=rules.defineComponent({schema:z.number().int().nonnegative(),initial:()=>0});
  const attackGrowth=rules.defineComponent({schema:z.number().int().nonnegative(),initial:()=>0});
  const attacked=rules.defineComponent({schema:z.boolean(),initial:()=>false});
  const growthAmount=rules.defineQuery({input:z.int32(),output:z.number().int(),reads:[attackGrowth],base:(r,entity)=>r.component(entity,attackGrowth)});
  const ownGrowth=rules.modify(volibearTraining.exports.permanentBonus,{
    condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,number>>(),output:z.boolean(),base:(_r,c)=>c.input===c.source}),
    dependencies:[growthAmount],transform:(r,c)=>c.value+r.query(growthAmount,c.source),
  });
  const resetAttack=rules.defineEffect<CardUse,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.card),attacked,false));
  const recordAttack=rules.defineEffect<CardHitReceipt,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.use.card),attacked,true));
  const growAttack=rules.defineEffect<CardUse,void>(b=>rules.when(rules.readComponent(b.read(v=>v.input.card),attacked),
    rules.updateLocalComponent(b.read(v=>v.input.card),attackGrowth,b.read(v=>v.get(rules.readComponent(v.input.card,attackGrowth))+(v.input.state.upgraded?6:4))),
  ));
  const growBlock=rules.defineEffect<CardUse,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.card),blockGrowth,n=>n+2));
  const copyGrowth=rules.on(volibearCopying.exports.copied,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CombatCopy>>(),output:z.boolean(),base:(_r,c)=>c.event.source===c.source}),
    effect:rules.defineEffect<rules.ReactionContext<CombatCopy>,void>(b=>rules.updateLocalComponent(
      b.read(v=>v.input.event.copy),blockGrowth,rules.readComponent(b.read(v=>v.input.source),blockGrowth),
    )),
  });
  const copyAttackGrowth=rules.on(volibearCopying.exports.copied,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CombatCopy>>(),output:z.boolean(),base:(_r,c)=>c.event.source===c.source}),
    effect:rules.defineEffect<rules.ReactionContext<CombatCopy>,void>(b=>rules.updateLocalComponent(
      b.read(v=>v.input.event.copy),attackGrowth,rules.readComponent(b.read(v=>v.input.source),attackGrowth),
    )),
  });
  const NeverLetGo=rules.defineEntity(cardInstances.exports.kind,{
    id:cards.U08.id,metadata:cards.U08.metadata,
    use:compose(
      queued(resetAttack),
      attack(10,1,false,true,recordAttack),
      queued(growAttack),
    ),
    canUpgrade:upgradeOnce(cards.U08.metadata),upgrade:standardUpgrade(cards.U08.metadata),
    created:registerCardAbilities(copyAttackGrowth,ownGrowth,volibearTraining.exports.fixedAttack),
  },{components:[attackGrowth,attacked]});
  const TemperingClaw=rules.defineEntity(cardInstances.exports.kind,{
    id:cards.U27.id,metadata:cards.U27.metadata,
    use:compose(
      attack([8,11]),
      block(v=>(v.input.state.upgraded?8:6)+v.get(rules.readComponent(v.input.card,blockGrowth))),
      queued(growBlock),
    ),
    canUpgrade:upgradeOnce(cards.U27.metadata),upgrade:standardUpgrade(cards.U27.metadata),
    created:registerCardAbilities(copyGrowth,volibearTraining.exports.fixedAttack),
  },{components:[blockGrowth]});
  return {exports:{TemperingClaw,NeverLetGo,blockGrowth,attackGrowth}};
}});
