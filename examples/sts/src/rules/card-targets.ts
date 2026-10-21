import {z} from 'zod';
import {rules} from './execution.ts';
import {cardUseSchema} from './card-instances.schemas.ts';

/** Select targets for one enemy-directed instruction. The primary selection in
 * CardUse remains immutable for costs, conditions and per-target play counts. */
export const cardTargets=rules.defineRules({requires:[],build(){
  const enemies=rules.defineQuery({input:cardUseSchema,output:z.array(z.int32().nonnegative()),base:(_r,use)=>use.target===null?[]:[use.target]});
  return{exports:{enemies}};
}});
