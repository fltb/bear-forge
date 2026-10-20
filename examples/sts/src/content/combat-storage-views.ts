import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
/** Read model hook for content-owned card storage; it never moves or executes cards. */
export const combatStorageViews=rules.defineRules({requires:[],build(){
  const slots=rules.defineQuery({input:z.number(),output:z.array(z.object({index:z.int32().nonnegative(),zone:z.number()})),base:()=>[]});
  return{exports:{slots}};
}});
