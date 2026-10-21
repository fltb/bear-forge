import {z} from 'zod';
import {rules} from './execution.ts';
import {cardUseSchema} from './card-instances.schemas.ts';

/** Effect magnitude only. The caller captures and pays X separately. */
export const xCost=rules.defineRules({requires:[],build(){
  const iterations=rules.defineQuery({input:cardUseSchema,output:z.number().int().nonnegative(),base:(_r,use)=>use.energyOnUse});
  return {exports:{iterations}};
}});
