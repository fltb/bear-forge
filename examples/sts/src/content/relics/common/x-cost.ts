import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {typedValue} from '../../../rules/value.schemas.ts';
import {relics} from '../../../rules/relics.ts';
import {xCost} from '../../../rules/x-cost.ts';
import type {CardUse} from '../../../rules/card-instances.types.ts';
import {registerRelicAbilities} from '../hooks.ts';

export const xCostRelics=rules.defineRules({requires:[relics,xCost],build(){
  function extraIterations(amount:number){return{
    ability:rules.modify(xCost.exports.iterations,{
      condition:rules.defineQuery({input:typedValue<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),base:(_r,c)=>c.input.owner===c.owner}),
      transform:(_r,c)=>c.value+amount,
    }),
    text:`自身使用X费牌时，X费效果的执行次数增加${amount}，不额外消耗能量。`,
  };}
  const bonus=extraIterations(2);
  const ChemicalX=rules.defineEntity(relics.exports.kind,{id:'CHEMICAL_X',install:registerRelicAbilities(bonus.ability)});
  return {exports:{ChemicalX,texts:Object.freeze({CHEMICAL_X:bonus.text})}};
}});
