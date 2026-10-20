import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {resources} from '../rules/resources.ts';
import {battles} from '../rules/battles.ts';
import {turns} from '../rules/turns.ts';
import {relics} from '../rules/relics.ts';
import type {ResourceAmount,HpLoss,ResourceChange} from '../rules/resources.types.ts';
import {registerRelicAbilities as register} from './relic-utils.ts';
const {defineRules,defineEffect,defineQuery,defineEntity,replace,restrict,on,call}=rules;

export const resourceRelics=defineRules({requires:[resources,relics,battles,turns],build(){
  const ownsAmount=defineQuery({input:z.custom<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),base:(_r,c)=>c.value.entity===c.owner});
  const ownsLoss=defineQuery({input:z.custom<rules.ReplacementContext<HpLoss>>(),output:z.boolean(),base:(_r,c)=>c.value.entity===c.owner&&c.value.amount>0});
  const ownsGold=defineQuery({input:z.custom<rules.ReactionContext<ResourceChange>>(),output:z.boolean(),base:(_r,c)=>c.event.entity===c.owner});
  const battleHeal=defineQuery({input:z.custom<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),dependencies:[battles.exports.presentForActor],base:(r,c)=>c.value.entity===c.owner&&r.query(battles.exports.presentForActor,c.owner)!==null});
  const flower=replace(resources.exports.beforeHeal,{condition:battleHeal,order:resources.exports.stages.transform,
    effect:defineEffect<rules.ReplacementContext<ResourceAmount>,rules.ReplacementResult<ResourceAmount>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:Math.trunc(v.input.value.amount*3/2)}))})),
  });
  const bloom=restrict(resources.exports.beforeHeal,{when:ownsAmount,reason:{relic:'MARK_OF_THE_BLOOM'},order:resources.exports.stages.restriction});
  const ectoplasm=restrict(resources.exports.beforeGoldGain,{when:ownsAmount,reason:{relic:'ECTOPLASM'},order:resources.exports.stages.restriction});
  const idol=on(resources.exports.goldGained,{condition:ownsGold,effect:defineEffect<rules.ReactionContext<ResourceChange>,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:5}))});
  const rod=replace(resources.exports.beforeHpLoss,{condition:ownsLoss,order:resources.exports.stages.transform,
    effect:defineEffect<rules.ReplacementContext<HpLoss>,rules.ReplacementResult<HpLoss>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:v.input.value.amount-1}))})),
  });
  const energy=rules.modify(turns.exports.rechargeAmount,{condition:defineQuery({input:z.custom<rules.ModifierContext<number,number>>(),output:z.boolean(),dependencies:[turns.exports.actor],base:(r,c)=>r.query(turns.exports.actor,c.input).actor===c.owner}),transform:(_r,c)=>c.value+1});
  return{exports:{
    MagicFlower:defineEntity(relics.exports.kind,{id:'MAGIC_FLOWER' as const,install:register(flower)}),
    MarkOfTheBloom:defineEntity(relics.exports.kind,{id:'MARK_OF_THE_BLOOM' as const,install:register(bloom)}),
    Ectoplasm:defineEntity(relics.exports.kind,{id:'ECTOPLASM' as const,install:register(ectoplasm,energy)}),
    BloodyIdol:defineEntity(relics.exports.kind,{id:'BLOODY_IDOL' as const,install:register(idol)}),
    TungstenRod:defineEntity(relics.exports.kind,{id:'TUNGSTEN_ROD' as const,install:register(rod)}),
  }};
}});
