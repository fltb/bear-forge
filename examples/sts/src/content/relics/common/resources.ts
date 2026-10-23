import { typedValue } from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {resources} from '../../../rules/resources.ts';
import {battles} from '../../../rules/battles.ts';
import {turns} from '../../../rules/turns.ts';
import {relics} from '../../../rules/relics.ts';
import type {ResourceAmount,HpLoss,ResourceChange} from '../../../rules/resources.types.ts';
import {registerRelicAbilities as register} from '../hooks.ts';
const {defineRules,defineEffect,defineQuery,defineEntity,replace,restrict,on,call}=rules;

export const resourceRelics=defineRules({requires:[resources,relics,battles,turns],build(){
  const ownsAmount=defineQuery({input:typedValue<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),base:(_r,c)=>c.value.entity===c.owner});
  function battleHealing(multiplier:number){
    const condition=defineQuery({input:typedValue<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),dependencies:[battles.exports.presentForActor],base:(r,c)=>c.value.entity===c.owner&&r.query(battles.exports.presentForActor,c.owner)!==null});
    return{
      ability:replace(resources.exports.beforeHeal,{condition,order:resources.exports.stages.transform,
        effect:defineEffect<rules.ReplacementContext<ResourceAmount>,rules.ReplacementResult<ResourceAmount>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:Math.trunc(v.input.value.amount*multiplier)}))})),
      }),
      text:`战斗内自身回复生命量乘以${multiplier}，向下取整。`,
    };
  }
  function preventHealing(){return{
    ability:restrict(resources.exports.beforeHeal,{when:ownsAmount,reason:{relic:'MARK_OF_THE_BLOOM'},order:resources.exports.stages.restriction}),
    text:'自身不能回复生命。',
  };}
  function preventGold(){return{
    ability:restrict(resources.exports.beforeGoldGain,{when:ownsAmount,reason:{relic:'ECTOPLASM'},order:resources.exports.stages.restriction}),
    text:'自身不能获得金币。',
  };}
  function healAfterGold(amount:number){return{
    ability:on(resources.exports.goldGained,{condition:defineQuery({input:typedValue<rules.ReactionContext<ResourceChange>>(),output:z.boolean(),base:(_r,c)=>c.event.entity===c.owner}),effect:defineEffect<rules.ReactionContext<ResourceChange>,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount}))}),
    text:`自身获得金币时，回复${amount}生命。`,
  };}
  function reduceHpLoss(amount:number){return{
    ability:replace(resources.exports.beforeHpLoss,{condition:defineQuery({input:typedValue<rules.ReplacementContext<HpLoss>>(),output:z.boolean(),base:(_r,c)=>c.value.entity===c.owner&&c.value.amount>0}),order:resources.exports.stages.transform,
      effect:defineEffect<rules.ReplacementContext<HpLoss>,rules.ReplacementResult<HpLoss>>(b=>b.return({kind:'change',value:b.read(v=>({...v.input.value,amount:v.input.value.amount-amount}))})),
    }),
    text:`自身每次大于0的生命损失减少${amount}。`,
  };}
  function extraRecharge(amount:number){return{
    ability:rules.modify(turns.exports.rechargeAmount,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),dependencies:[turns.exports.actor],base:(r,c)=>r.query(turns.exports.actor,c.input).actor===c.owner}),transform:(_r,c)=>c.value+amount}),
    text:`自身每回合补充能量时额外获得${amount}能量。`,
  };}
  const flower=battleHealing(3/2),bloom=preventHealing(),ectoplasm=preventGold(),idol=healAfterGold(5),rod=reduceHpLoss(1),energy=extraRecharge(1);
  return{exports:{
    MagicFlower:defineEntity(relics.exports.kind,{id:'MAGIC_FLOWER' as const,install:register(flower.ability)}),
    MarkOfTheBloom:defineEntity(relics.exports.kind,{id:'MARK_OF_THE_BLOOM' as const,install:register(bloom.ability)}),
    Ectoplasm:defineEntity(relics.exports.kind,{id:'ECTOPLASM' as const,install:register(ectoplasm.ability,energy.ability)}),
    BloodyIdol:defineEntity(relics.exports.kind,{id:'BLOODY_IDOL' as const,install:register(idol.ability)}),
    TungstenRod:defineEntity(relics.exports.kind,{id:'TUNGSTEN_ROD' as const,install:register(rod.ability)}),
    texts:Object.freeze({MAGIC_FLOWER:flower.text,MARK_OF_THE_BLOOM:bloom.text,ECTOPLASM:energy.text+ectoplasm.text,BLOODY_IDOL:idol.text,TUNGSTEN_ROD:rod.text}),
  }};
}});
