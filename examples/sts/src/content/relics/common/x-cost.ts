import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {typedValue} from '../../../rules/value.schemas.ts';
import {relics} from '../../../rules/relics.ts';
import {xCost} from '../../../rules/x-cost.ts';
import type {CardUse} from '../../../rules/card-instances.types.ts';
import {registerRelicAbilities} from '../hooks.ts';

export const xCostRelics=rules.defineRules({requires:[relics,xCost],build(){
  const bonus=rules.modify(xCost.exports.iterations,{
    condition:rules.defineQuery({input:typedValue<rules.ModifierContext<CardUse,number>>(),output:z.boolean(),base:(_r,c)=>c.input.owner===c.owner}),
    transform:(_r,c)=>c.value+2,
  });
  const ChemicalX=rules.defineEntity(relics.exports.kind,{id:'CHEMICAL_X',install:registerRelicAbilities(bonus)});
  return {exports:{ChemicalX}};
}});
