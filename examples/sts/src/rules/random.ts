import {monotoneProbabilityImage} from '@bear-forge/card-engine/probability-image';
import type {ProbabilityConstraint} from '@bear-forge/card-engine/probability';
import {probabilityMass} from '@bear-forge/card-engine/probability-mass';
import {groupOrder,orderSize,orderAt} from './order-space.ts';
import {withProbability,registerCoordinateIndependentResult} from '@bear-forge/card-engine/rules-probability';
import {permutationAt,permutationCount,type ProbabilitySpace} from '@bear-forge/card-engine/probability';
import {z} from 'zod';
import {rules} from './execution.ts';
import {floatAtUnit,randomState,randomInt,randomFloat,randomLong,nextLong,randomLongRange,randomBoolean,setRandomCounter,javaShuffle,rngView} from '../rng.ts';
import type {RandomState} from '../rng.ts';
import {entityId} from './resources.schemas.ts';
import {unsigned64,signed64,randomStateSchema,randomViewSchema} from './random.schemas.ts';
const {defineRules,defineComponent,defineEffect,defineQuery,call}=rules;

/** The source's checked numeric algorithms are reused; every mutable stream is owned Context data. */
export const random=defineRules({requires:[],build(m){
  const state=m.own(defineComponent({schema:randomStateSchema,initial:()=>randomState(0n)}));
  const seed=m.atom({input:z.object({stream:entityId,seed:unsigned64}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,input){return{writes:[{entity:input.stream,component:state,value:randomState(input.seed)}],events:[],result:undefined};}});
  const stream=m.kind({config:z.undefined(),setup:unsigned64,components:[state],initialize:defineEffect<rules.EntityLifecycle<bigint>,void>(b=>call(seed,{stream:b.read(v=>v.input.entity),seed:b.read(v=>v.input.setup)}))});
  type Distribution<I,O>={space:(input:rules.Borrowed<I>)=>ProbabilitySpace;value:(input:rules.Borrowed<I>,coordinate:bigint)=>O;count?:(input:rules.Borrowed<I>)=>number;publication?:(input:rules.Borrowed<I>,result:rules.Borrowed<O>)=>unknown;constraints?:(input:rules.Borrowed<I>,result:rules.Borrowed<O>)=>readonly ProbabilityConstraint[]};
  function sample<I extends {stream:number},O>(input:rules.Schema<I>,output:rules.Schema<O>,draw:(state:RandomState,input:rules.Borrowed<I>)=>O,distribution?:Distribution<I,O>):rules.Effect<I,O>{
    const effect=m.atom({input,output,reads:[state],writes:[state],emits:[],run(r,input){
      const next={...r.component(input.stream,state)},result=draw(next,input);
      return{writes:[{entity:input.stream,component:state,value:next}],events:[],result};
    }});
    if(!distribution)return effect;
    return withProbability(effect,{space:distribution.space,...(distribution.publication?{publication:(_r:unknown,input:rules.Borrowed<I>,result:rules.Borrowed<O>)=>distribution.publication!(input,result)}:{}),...(distribution.constraints?{constraints:(_r:unknown,input:rules.Borrowed<I>,result:rules.Borrowed<O>)=>distribution.constraints!(input,result)}:{}),run(r,input,coordinate){
      // The probability kernel never uses stream seeds to choose a future.
      // Retain the rest of the current Context and the public call counter.
      const before=r.component(input.stream,state),next={...before,counter:before.counter+(distribution.count?.(input)??1)};
      return{writes:[{entity:input.stream,component:state,value:next}],events:[],result:distribution.value(input,coordinate)};
    }});
  }
  // Scope markers let the probability kernel collect a joint result after an
  // original effect (including its component writes and nested random calls).
  // Normal execution crosses the marker without touching any random stream.
  const boundary=withProbability(m.atom({input:z.string().min(1),output:z.undefined(),reads:[],writes:[],emits:[],run:()=>({writes:[],events:[],result:undefined})}),{
    space:name=>({kind:'boundary',name}),run:()=>({writes:[],events:[],result:undefined}),
  });
  const uniform=(size:bigint):ProbabilitySpace=>({kind:'uniform',size});
  const int=sample(z.object({stream:entityId,start:z.int32(),end:z.int32()}),z.int32(),(r,i)=>randomInt(r,i.start,i.end),{
    space:i=>uniform(BigInt(i.end-i.start+1)),value:(i,c)=>i.start+Number(c),
  });
  // Proof for this specific original kernel: sample.run writes only
  // before.counter + 1, emits nothing, and publishes no coordinate. Its sole
  // coordinate use is start + Number(c), total on the original int32 range.
  // The linker additionally requires that the caller discards this return.
  registerCoordinateIndependentResult(int);
  // Push a uniform integer through the producer's ORIGINAL value map. Equal
  // results coalesce; content eligibility and thresholds remain at the caller.
  const declaration=z.object({name:z.string(),value:z.union([z.string(),z.number(),z.boolean()])});
  const constraint=z.object({name:z.string(),values:z.array(z.union([z.string(),z.number(),z.boolean()])).readonly()});
  // A producer may already know a necessary condition on a later PUBLIC
  // result. This unit edge changes no game data or RNG; only probability
  // execution emits the condition, and only already-received evidence can
  // reject it. An unconditional future expansion cannot use it as evidence.
  const constrain=withProbability(m.atom({input:constraint,output:z.undefined(),reads:[],writes:[],emits:[],run:()=>({writes:[],events:[],result:undefined})}),{
    space:()=>({kind:'boundary',name:'public-constraint'}),run:()=>({writes:[],events:[],result:undefined}),constraints:(_r,input)=>[input],
  });
  const mappedInput=z.object({stream:entityId,values:z.array(z.int32()).nonempty().readonly(),declarations:z.array(declaration.nullable()).readonly().optional(),constraints:z.array(z.array(constraint).readonly()).readonly().optional()});
  type MappedInput=z.infer<typeof mappedInput>;
  function mappedImage(input:rules.Borrowed<MappedInput>){
    const image:{value:number;weight:number;publication:z.infer<typeof declaration>|null;constraints:readonly ProbabilityConstraint[]}[]=[];
    for(let index=0;index<input.values.length;index++){
      const value=input.values[index]!,publication=input.declarations?.[index]??null,constraints=input.constraints?.[index]??[],prior=image.find(row=>row.value===value);
      if(prior)prior.weight++;
      else image.push({value,weight:1,publication,constraints});
    }
    return image.map(row=>({...row,mass:probabilityMass(BigInt(row.weight),BigInt(input.values.length))}));
  }
  const mappedInt=sample(mappedInput,z.int32(),(r,i)=>i.values[randomInt(r,0,i.values.length-1)]!,{
    space:i=>({kind:'rational',weights:mappedImage(i).map(row=>row.mass)}),value:(i,c)=>mappedImage(i)[Number(c)]!.value,
    publication:(i,result)=>{const value=mappedImage(i).find(row=>row.value===result)!.publication;return value?{kind:'discrete-result',...value}:undefined;},
    constraints:(i,result)=>i.constraints?mappedImage(i).find(row=>row.value===result)!.constraints:[],
  });
  const imageInput=z.object({stream:entityId,image:z.array(z.object({end:z.int32().positive(),value:z.number().finite(),publication:declaration.optional(),constraints:z.array(constraint).readonly().optional()})).nonempty().readonly()});
  type ImageInput=z.infer<typeof imageInput>;
  const imageRows=(input:rules.Borrowed<ImageInput>)=>{let previous=0;return input.image.map(row=>{const count=row.end-previous;previous=row.end;return{...row,mass:probabilityMass(BigInt(count),1n<<24n)};});};
  const mappedFloat=sample(imageInput,z.number(),(r,i)=>{const coordinate=randomFloat(r)*2**24;return imageRows(i).find(row=>coordinate<row.end)!.value;},{
    space:i=>({kind:'rational',weights:imageRows(i).map(row=>row.mass)}),value:(i,c)=>i.image[Number(c)]!.value,
    constraints:(i,result)=>i.image.find(row=>row.value===result)!.constraints??[],
    publication:(i,result)=>{const value=i.image.find(row=>row.value===result)!.publication;return value?{kind:'discrete-result',...value}:undefined;},
  });
  const declare=withProbability(m.atom({input:declaration,output:z.undefined(),reads:[],writes:[],emits:[],run:()=>({writes:[],events:[],result:undefined})}),{
    space:()=>({kind:'boundary',name:'public-result'}),run:()=>({writes:[],events:[],result:undefined}),publication:(_r,i)=>({kind:'discrete-result',...i}),
  });
  const float=sample(z.object({stream:entityId}),z.number(),r=>randomFloat(r),{space:()=>uniform(1n<<24n),value:(_i,c)=>Number(c)/2**24});
  const floatRange=sample(z.object({stream:entityId,start:z.number().finite(),end:z.number().finite()}),z.number(),(r,i)=>randomFloat(r,i.start,i.end),{
    space:()=>uniform(1n<<24n),value:(i,c)=>floatAtUnit(Number(c)/2**24,i.start,i.end),
  });
  const long=sample(z.object({stream:entityId}),signed64,r=>randomLong(r),{space:()=>uniform(1n<<64n),value:(_i,c)=>BigInt.asIntN(64,c)});
  const longRange=sample(z.object({stream:entityId,start:signed64,end:signed64}),signed64,(r,i)=>randomLongRange(r,i.start,i.end),{
    space:i=>uniform(i.end===i.start?1n:1n<<53n),
    value:(i,c)=>i.start+BigInt(Math.trunc(Number(c)/2**53*Number(i.end-i.start))),
  });
  const boolean=sample(z.object({stream:entityId}),z.boolean(),r=>randomBoolean(r),{space:()=>uniform(2n),value:(_i,c)=>c===1n});
  const chance=sample(z.object({stream:entityId,chance:z.number().finite()}),z.boolean(),(r,i)=>randomBoolean(r,i.chance),{
    space:i=>{const size=1n<<24n,count=BigInt(Math.max(0,Math.min(2**24,Math.ceil(Math.fround(i.chance)*2**24))));return{kind:'rational',weights:[probabilityMass(size-count,size),probabilityMass(count,size)]};},value:(_i,c)=>c===1n,
  });
  const shuffleElements=sample(z.object({stream:entityId,items:z.array(z.unknown()).readonly(),counted:z.boolean()}),z.array(z.unknown()).readonly(),(r,i)=>{const items=[...i.items];javaShuffle(items,i.counted?randomLong(r):nextLong(r));return items;},{
    space:i=>uniform(permutationCount(i.items.length)),value:(i,c)=>permutationAt(i.items,c),count:i=>Number(i.counted),
  });
  function shuffle<T>(input:{stream:rules.Input<number>;items:rules.Input<readonly T[]>;counted?:rules.Input<boolean>}):rules.Command<readonly T[]>{
    // The atom only permutes its input. This wrapper retains the element type at the author boundary.
    return call(shuffleElements as rules.Effect<{stream:number;items:readonly T[];counted:boolean},readonly T[]>,{...input,counted:input.counted??true});
  }
  // Uniform permutation followed by the producer's original stable groups.
  // Equal interleavings have the same multiplicity, so the image is uniform
  // over the product of group permutations. No card rule lives in this atom.
  const shuffleGrouped=sample(z.object({stream:entityId,items:z.array(z.int32()).readonly(),groups:z.array(z.array(z.int32()).readonly()).readonly()}),z.array(z.int32()).readonly(),(r,i)=>{
    const order=[...i.items];javaShuffle(order,randomLong(r));return groupOrder(order,i.groups);
  },{
    space:i=>uniform(orderSize(i.groups)),value:(i,c)=>orderAt(i.groups,c),
  });
  const advanceCounter=sample(z.object({stream:entityId,count:z.int32().nonnegative()}),z.undefined(),(r,i)=>setRandomCounter(r,i.count));
  const copyFrom=m.atom({input:z.object({target:entityId,source:entityId}),output:z.undefined(),reads:[state],writes:[state],emits:[],run(r,i){return{writes:[{entity:i.target,component:state,value:{...r.component(i.source,state)}}],events:[],result:undefined};}});
  const current=defineQuery({input:entityId,output:randomViewSchema,reads:[state],base:(r,stream)=>rngView(r.component(stream,state))});
  return{exports:{boundary,constrain,stream,current,int,mappedInt,mappedFloat,declare,float,floatRange,long,longRange,boolean,chance,shuffle,shuffleGrouped,advanceCounter,reseed:seed,copyFrom}};
}});

/** Content supplies its one original monotone value function, never a second
 * price/rule table. The returned boundaries are plain current Context data. */
export function float24Image(start:number,end:number,project:(value:number)=>number){return monotoneProbabilityImage(2**24,coordinate=>project(floatAtUnit(coordinate/2**24,start,end)));}
