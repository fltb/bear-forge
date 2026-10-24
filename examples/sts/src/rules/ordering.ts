import {partitionProbabilityImage} from '../../../../packages/card-engine/src/probability-image.ts';
import {z} from 'zod';
import {rules} from './execution.ts';
import {withProbability} from '../../../../packages/card-engine/src/rules-probability.ts';

export const orderChoiceSchema=z.object({key:z.string(),value:z.int32(),weight:z.number().finite().nonnegative(),publication:z.object({name:z.string(),value:z.union([z.string(),z.number(),z.boolean()])}).nullable().optional()});
export type OrderChoice=z.infer<typeof orderChoiceSchema>;
/** Original selection data: ordered values, strict float24 cutoffs and the
 * current acceptance mask. The kernel contains no encounter-stage rules. */
export type Float24Selection={values:readonly number[];bounds:readonly number[];accepted:readonly boolean[]};
export function float24Index(selection:Float24Selection,roll:number):number {
  for(let i=0;i<selection.values.length-1;i++)if(roll<selection.bounds[i]!)return i;
  return selection.values.length-1;
}
/** Push the uniform float24 grid through the original threshold operation,
 * then condition on acceptance of the original rejection loop. */
export function float24Choices(selection:Float24Selection):OrderChoice[]{
  const {values,bounds,accepted}=selection;
  if(!values.length||bounds.length!==values.length-1||accepted.length!==values.length||bounds.some(n=>!Number.isFinite(n)))throw Error('Invalid float24 selection');
  const grid=2**24,mass=new Map<number,number>();let previous=0,total=0;
  for(let i=0;i<values.length;i++){
    const end=i===values.length-1?grid:Math.max(previous,Math.min(grid,Math.ceil(bounds[i]!*grid))),weight=end-previous;
    previous=end;
    if(accepted[i]&&weight>0){mass.set(values[i]!,weight+(mass.get(values[i]!)??0));total+=weight;}
  }
  if(!total)throw Error('Empty accepted float24 selection');
  return [...mass].map(([value,weight])=>({key:String(value),value,weight:weight/total}));
}
/** Push a finite equiprobable source through its original value mapping. */
export function uniformMappedChoices(values:readonly number[]):OrderChoice[]{
  if(!values.length)throw Error('Empty original random map');
  const counts=new Map<number,number>();
  for(const value of values)counts.set(value,(counts.get(value)??0)+1);
  return [...counts].map(([value,count])=>({key:String(value),value,weight:count/values.length}));
}
/** A uniform permutation conditioned on an already exposed prefix. */
export function permutationNextChoices(values:readonly number[],prefix:readonly number[]):OrderChoice[]{
  if(new Set(values).size!==values.length||new Set(prefix).size!==prefix.length||prefix.some(value=>!values.includes(value)))throw Error('Invalid permutation prefix');
  const remaining=values.filter(value=>!prefix.includes(value));
  if(!remaining.length)throw Error('Exhausted permutation');
  return remaining.map(value=>({key:String(value),value,weight:1/remaining.length}));
}
/** A future value already cached by normal execution. The original operation
 * supplies its current legal probability space; this kernel knows no content. */
export const ordering=rules.defineRules({requires:[],build(m){
  const input=z.object({actual:z.int32(),choices:z.array(orderChoiceSchema)});
  const canonical=(choices:rules.Borrowed<OrderChoice[]>)=>{
    if(new Set(choices.map(c=>c.key)).size!==choices.length)throw Error('Ambiguous future choice identity');
    return [...choices].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  };
  const select=withProbability(m.atom({input,output:z.int32(),reads:[],writes:[],emits:[],run:(_r,i)=>({writes:[],events:[],result:i.actual})}),{
    space:i=>({kind:'weighted',weights:canonical(i.choices).map(c=>c.weight)}),
    run:(_r,i,coordinate)=>({writes:[],events:[],result:canonical(i.choices)[Number(coordinate)]!.value}),
    publication:(_r,i,result)=>{const value=canonical(i.choices).find(row=>row.value===result)?.publication;return value?{kind:'discrete-result',...value}:undefined;},
    partition:(i,hint,maximum,source)=>partitionProbabilityImage(canonical(i.choices),hint,maximum,source),
  });
  return{exports:{select}};
}});
