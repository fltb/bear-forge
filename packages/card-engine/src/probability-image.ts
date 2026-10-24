import {generateProbability,type ProbabilityConstraint,type ProbabilityEntropy,type ProbabilityOutcomes} from './probability.ts';

export type ProbabilityDeclaration={name:string;value:string|number|boolean};
export type ProbabilityImageRow={weight:number;publication?:ProbabilityDeclaration|null|undefined;constraints?:readonly ProbabilityConstraint[]|undefined};
export function isProbabilityConstraint(value:unknown):value is ProbabilityConstraint {
  return value!==null&&typeof value==='object'&&'name' in value&&typeof value.name==='string'&&'values' in value&&Array.isArray(value.values)&&value.values.every(item=>typeof item==='string'||typeof item==='number'||typeof item==='boolean');
}
const declaration=(value:unknown):value is ProbabilityDeclaration&{kind:'discrete-result'}=>value!==null&&typeof value==='object'&&'kind' in value&&value.kind==='discrete-result'&&'name' in value&&typeof value.name==='string'&&'value' in value&&['string','number','boolean'].includes(typeof value.value);
export function satisfiesProbabilityConstraints(conditions:readonly ProbabilityConstraint[],hint:readonly unknown[]):boolean {
  return conditions.every(condition=>hint.filter(declaration).filter(target=>target.name===condition.name).every(target=>condition.values.includes(target.value)));
}
/** Partition into the complete compatible set and its complement. Sampling
 * within either set retains its ORIGINAL mass; it never makes it exact. */
export function partitionProbabilityImage(image:readonly ProbabilityImageRow[],hint:unknown,maximum:number,source:ProbabilityEntropy):ProbabilityOutcomes|undefined {
  if(!Array.isArray(hint)||!hint.length||maximum<2)return undefined;
  const targets=hint.filter(declaration);
  const constrained=image.some(row=>row.constraints?.some(c=>targets.some(t=>t.name===c.name)));
  const published=image.some(row=>row.publication&&JSON.stringify({kind:'discrete-result',...row.publication})===JSON.stringify(hint[0]));
  if(!constrained&&!published)return undefined;
  const compatible=image.map(row=>(!constrained||satisfiesProbabilityConstraints(row.constraints??[],hint))&&(!published||!row.publication||JSON.stringify({kind:'discrete-result',...row.publication})===JSON.stringify(hint[0])));
  const mass=image.reduce((total,row,index)=>total+(compatible[index]?row.weight:0),0);
  if(!(mass>0)||mass>=1-1e-12)return undefined;
  const matching=generateProbability({kind:'weighted',weights:image.map((row,index)=>compatible[index]?row.weight/mass:0)},maximum-1,source);
  const other=generateProbability({kind:'weighted',weights:image.map((row,index)=>compatible[index]?0:row.weight/(1-mass))},1,source);
  return{representation:matching.representation==='particles'||other.representation==='particles'?'particles':'exact',outcomes:[...matching.outcomes.map(row=>({...row,probability:row.probability*mass})),...other.outcomes.map(row=>({...row,probability:row.probability*(1-mass)}))]};
}

/** Push a trusted nondecreasing finite-valued producer through an integer
 * grid. Every row is [previousEnd,end); binary search avoids enumerating the
 * float24 grid. The producer retains the ONLY definition of its rounding. */
export function monotoneProbabilityImage(size:number,project:(coordinate:number)=>number,maximum=1024):{end:number;value:number}[]{
  if(!Number.isSafeInteger(size)||size<1)throw Error('Invalid image grid');
  const result:{end:number;value:number}[]=[];let start=0;
  while(start<size){
    if(result.length>=maximum)throw Error('Probability image support budget');
    const value=project(start);if(!Number.isFinite(value)||result.length&&value<=result.at(-1)!.value)throw Error('Invalid monotone probability image');
    let low=start+1,high=size;
    while(low<high){const middle=Math.floor((low+high)/2),next=project(middle);if(!Number.isFinite(next)||next<value)throw Error('Nonmonotone probability image');if(next===value)low=middle+1;else high=middle;}
    result.push({end:low,value});start=low;
  }
  return result;
}
