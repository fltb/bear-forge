import {z} from 'zod';
import {rules} from './execution.ts';
import {withProbability} from '../../../../packages/card-engine/src/rules-probability.ts';
import {probabilityMass} from '../../../../packages/card-engine/src/probability-mass.ts';

export const orderChoiceSchema=z.object({key:z.string(),value:z.int32(),weight:z.object({numerator:z.bigint().nonnegative(),denominator:z.bigint().positive()}),publication:z.object({name:z.string(),value:z.union([z.string(),z.number(),z.boolean()])}).nullable().optional()});
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
  const grid=2**24,mass=new Map<number,number>();let previous=0,total=0;
  for(let i=0;i<values.length;i++){
    const end=i===values.length-1?grid:Math.max(previous,Math.min(grid,Math.ceil(bounds[i]!*grid))),weight=end-previous;
    previous=end;
    if(accepted[i]&&weight>0){mass.set(values[i]!,weight+(mass.get(values[i]!)??0));total+=weight;}
  }
  return [...mass].map(([value,weight])=>({key:String(value),value,weight:probabilityMass(BigInt(weight),BigInt(total))}));
}
/** Push a finite equiprobable source through its original value mapping. */
export function uniformMappedChoices(values:readonly number[]):OrderChoice[]{
  const counts=new Map<number,number>();
  for(const value of values)counts.set(value,(counts.get(value)??0)+1);
  return [...counts].map(([value,count])=>({key:String(value),value,weight:probabilityMass(BigInt(count),BigInt(values.length))}));
}
/** A uniform permutation conditioned on an already exposed prefix. */
export function permutationNextChoices(values:readonly number[],prefix:readonly number[]):OrderChoice[]{
  const remaining=values.filter(value=>!prefix.includes(value));
  return remaining.map(value=>({key:String(value),value,weight:probabilityMass(1n,BigInt(remaining.length))}));
}
/** A future value already cached by normal execution. The original operation
 * supplies its current legal probability space; this kernel knows no content. */
export const ordering=rules.defineRules({requires:[],build(m){
  const input=z.object({actual:z.int32(),choices:z.array(orderChoiceSchema)});
  const canonical=(choices:rules.Borrowed<OrderChoice[]>)=>{
    return [...choices].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  };
  const select=withProbability(m.atom({input,output:z.int32(),reads:[],writes:[],emits:[],run:(_r,i)=>({writes:[],events:[],result:i.actual})}),{
    space:i=>({kind:'rational',weights:canonical(i.choices).map(c=>c.weight)}),
    run:(_r,i,coordinate)=>({writes:[],events:[],result:canonical(i.choices)[Number(coordinate)]!.value}),
    publication:(_r,i,result)=>{const value=canonical(i.choices).find(row=>row.value===result)?.publication;return value?{kind:'discrete-result',...value}:undefined;},
  });
  return{exports:{select}};
}});
