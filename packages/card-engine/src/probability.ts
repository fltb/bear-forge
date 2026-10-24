import type {CardScope,CardStorage,CardRoot} from './card.types.ts';

/** Data describing elementary outcomes, never rule code or an RNG snapshot. */
export type ProbabilitySpace =
  | {kind: 'uniform'; size: bigint}
  | {kind: 'weighted'; weights: readonly number[]}
  | {kind: 'sampled'}
  | {kind: 'boundary'; name: string};
export type ProbabilityCoordinate = bigint | {kind:'sample'; value:unknown};
export type ProbabilityStop = {kind: 'chance'; space: ProbabilitySpace};
export type ForwardRandom = {state:number;position:number};
export type ForwardProbabilityResult = {
  representation:'exact'|'particles';basis:unknown;outcomes:{probability:number;value:unknown}[];
  random:ForwardRandom;reason:string|null;
  cost:{milliseconds:number;nodes:number;advances:number;words:number};
};
export type ForwardProbabilityAccount={random:ForwardRandom;milliseconds:number;nodes:number;advances:number;words:number;captures:number};
export const initialForwardAccount=():ForwardProbabilityAccount=>({random:{state:1592594996,position:0},milliseconds:0,nodes:0,advances:0,words:0,captures:0});
export type ForwardProbability<S=any> = {
  plan(scope:CardScope<S>):{until:string;maximum:number;random:ForwardRandom;milliseconds:number}|null;
  word(cursor:ForwardRandom):{value:number;random:ForwardRandom};
  project(scope:CardScope<S>):unknown;
};
// The storage owns forking; the execution kernel never imports a runtime or
// manufactures frames. Registration does not add fields to the public storage.
const probabilityForks=new WeakMap<object,{fork:()=>CardStorage<CardRoot<any>>;residentBytes:()=>number}>();
export function registerProbabilityFork(storage:object,fork:()=>CardStorage<CardRoot<any>>,residentBytes:()=>number):void {probabilityForks.set(storage,{fork,residentBytes});}
export function forkProbabilityStorage<S>(storage:CardStorage<CardRoot<S>>):CardStorage<CardRoot<S>>|undefined{return probabilityForks.get(storage)?.fork();}
export function probabilityResidentBytes(storage:object):number{return probabilityForks.get(storage)?.residentBytes()??0;}

/** A synchronous handoff of the original generation's live current leaves.
 * Storages are borrowed only for this callback and closed immediately after it.
 * A receiver must fork/continue them now, never retain an old scope checkpoint. */
export type ForwardProbabilityDelivery<S>={
  representation:'exact'|'particles';
  maximum:number;
  outcomes:readonly {storage:CardStorage<CardRoot<S>>;probability:number}[];
  entropy:ProbabilityEntropy;
  execute:<T>(phase:'fork'|'advance'|'cleanup',operation:()=>T)=>T;
};
export type ForwardProbabilityLimit=(cost:ForwardProbabilityResult['cost'])=>string|null;
type ForwardReceiver={receive:(delivery:ForwardProbabilityDelivery<any>)=>void;enabled?:()=>boolean;limit?:ForwardProbabilityLimit;charge?:(milliseconds:number)=>void;complete?:(result:ForwardProbabilityResult)=>void};
const forwardReceivers=new WeakMap<object,ForwardReceiver>();
export function receiveForwardProbability<S>(storage:CardStorage<CardRoot<S>>,receive:(delivery:ForwardProbabilityDelivery<S>)=>void,options:{enabled?:()=>boolean;limit?:ForwardProbabilityLimit;charge?:(milliseconds:number)=>void;complete?:(result:ForwardProbabilityResult)=>void}={}):()=>void {
  if(forwardReceivers.has(storage))throw Error('Forward probability receiver already installed');
  const receiver={receive,...options};forwardReceivers.set(storage,receiver);
  return()=>{if(forwardReceivers.get(storage)===receiver)forwardReceivers.delete(storage);};
}
export function forwardProbabilityReceiver<S>(storage:CardStorage<CardRoot<S>>):ForwardReceiver|undefined{return forwardReceivers.get(storage);}

export type ProbabilityConstraint={name:string;values:readonly (string|number|boolean)[]};
export type ProbabilityOperation<S = any> = {
  space(scope: CardScope<S>): ProbabilitySpace;
  publication?(scope:CardScope<S>,result:unknown):unknown;
  /** Necessary conditions on future PUBLIC outputs, evaluated only on a
   * candidate branch. These never reveal the actual branch's hidden draws. */
  constraints?(scope:CardScope<S>,result:unknown):readonly ProbabilityConstraint[];
  forward?:ForwardProbability<S>;
  resolveForward?(scope:CardScope<S>,result:ForwardProbabilityResult):unknown;
  /** Partition the original chance law using public proposal data. The result
   * must still cover total mass one, including the complement of the hint. */
  partition?(scope:CardScope<S>,hint:unknown,maximum:number,source:ProbabilityEntropy):ProbabilityOutcomes|undefined;
  resolve(scope: CardScope<S>, coordinate: bigint): unknown;
  sample?(scope: CardScope<S>, source: ProbabilityEntropy): unknown;
  resolveSample?(scope: CardScope<S>, value: unknown): unknown;
};
// Static Program metadata. No functions are stored in a Context or checkpoint.
const operations = new WeakMap<object, ProbabilityOperation>();
export function probabilityOperation<S>(operation: object, kernel: ProbabilityOperation<S>): void {
  if (operations.has(operation)) throw Error('Probability operation already bound');
  operations.set(operation, Object.freeze({...kernel}));
}
export function probabilityOperationFor(operation: object): ProbabilityOperation | undefined {return operations.get(operation);}

export function validateProbabilitySpace(space: ProbabilitySpace): void {
  if (space.kind === 'uniform') {
    if (typeof space.size !== 'bigint' || space.size < 1n) throw Error('Empty probability space');
  } else if (space.kind === 'weighted') {
    const total = space.weights.reduce((a,b) => a+b,0);
    if (!space.weights.length || space.weights.some(p => !Number.isFinite(p) || p < 0) || Math.abs(total-1)>1e-12) throw Error('Invalid probability weights');
  } else if(space.kind === 'boundary') {
    if(typeof space.name!=='string'||!space.name.length)throw Error('Invalid probability boundary');
  } else if(space.kind !== 'sampled') throw Error('Unknown probability space');
}
export function validateCoordinate(space: ProbabilitySpace, coordinate: unknown): asserts coordinate is ProbabilityCoordinate {
  validateProbabilitySpace(space);
  if(space.kind==='sampled') {
    if(!coordinate||typeof coordinate!=='object'||!('kind' in coordinate)||coordinate.kind!=='sample'||!('value' in coordinate))throw Error('Invalid sampled probability coordinate');
    return;
  }
  if (typeof coordinate !== 'bigint' || coordinate < 0n ||
      coordinate >= (space.kind === 'boundary' ? 1n : space.kind === 'uniform' ? space.size : BigInt(space.weights.length)) ||
      space.kind === 'weighted' && space.weights[Number(coordinate)] === 0) throw Error('Invalid probability coordinate');
}

/** Search entropy only. The caller owns its cursor and cancellation/budget. */
export type ProbabilityEntropy = {word(): number; check(): void};
export type ProbabilityOutcomes = {
  representation: 'exact' | 'particles';
  outcomes: {coordinate: ProbabilityCoordinate; probability: number}[];
};
function word(source: ProbabilityEntropy): bigint {
  source.check(); const value = source.word();
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw Error('Invalid probability entropy word');
  return BigInt(value);
}
export function sampleUniformCoordinate(size: bigint, source: ProbabilityEntropy): bigint {
  if(size<1n)throw Error('Empty probability space');
  if (size === 1n) return 0n;
  const bits = (size-1n).toString(2).length, words = Math.ceil(bits/32), mask = (1n<<BigInt(bits))-1n;
  for (;;) {
    let value = 0n;
    for (let i=0;i<words;i++) value=(value<<32n)|word(source);
    value &= mask;
    if (value<size) return value;
  }
}
/** Exact small support, otherwise a labelled empirical distribution. Never
 * keep the first N outcomes or renormalize an interrupted enumeration. */
export function generateProbability(space: ProbabilitySpace, maximum: number, source: ProbabilityEntropy, sample?: (source:ProbabilityEntropy)=>unknown): ProbabilityOutcomes {
  validateProbabilitySpace(space);
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw Error('Invalid probability support budget');
  source.check();
  if(space.kind==='sampled') {
    if(!sample)throw Error('Missing probability sampler');
    const outcomes:ProbabilityOutcomes['outcomes']=[];
    for(let i=0;i<maximum;i++){
      source.check();const value=sample(source);source.check();
      outcomes.push({coordinate:{kind:'sample',value},probability:1/maximum});
    }
    return{representation:'particles',outcomes};
  }
  // A named scope boundary carries unit mass and consumes no entropy. It is
  // internal to probability execution, never a new game IO or a saved prefix.
  if(space.kind==='boundary')return{representation:'exact',outcomes:[{coordinate:0n,probability:1}]};
  if (space.kind === 'uniform' && space.size <= BigInt(maximum)) {
    const size = Number(space.size), probability = 1/size;
    return {representation:'exact',outcomes:Array.from({length:size},(_,i)=>({coordinate:BigInt(i),probability}))};
  }
  if (space.kind === 'weighted' && space.weights.filter(p=>p>0).length <= maximum) {
    return {representation:'exact',outcomes:space.weights.flatMap((probability,i)=>probability>0?[{coordinate:BigInt(i),probability}]:[])};
  }
  const counts = new Map<bigint,number>();
  for (let draw=0;draw<maximum;draw++) {
    let coordinate: bigint;
    if (space.kind === 'uniform') coordinate=sampleUniformCoordinate(space.size,source);
    else {
      const unit = Number((word(source)<<21n)|(word(source)&0x1fffffn))/2**53;
      let cumulative=0, selected=-1;
      for (let i=0;i<space.weights.length;i++) {
        const p=space.weights[i]!;
        if (p>0) {selected=i; cumulative+=p; if (unit<cumulative) break;}
      }
      if (selected<0) throw Error('Empty weighted support');
      coordinate=BigInt(selected);
    }
    counts.set(coordinate,(counts.get(coordinate)??0)+1);
  }
  source.check();
  return {representation:'particles',outcomes:[...counts].map(([coordinate,count])=>({coordinate,probability:count/maximum}))};
}

export function permutationCount(length: number): bigint {
  if (!Number.isSafeInteger(length) || length<0) throw Error('Invalid permutation length');
  let count=1n; for (let i=2;i<=length;i++) count*=BigInt(i); return count;
}
/** A coordinate selects one permutation of positions. Equal values keep their
 * positional multiplicity; the kernel never inspects card identity or rules. */
export function permutationAt<T>(items: readonly T[], coordinate: bigint): T[] {
  const size=permutationCount(items.length);
  validateCoordinate({kind:'uniform',size},coordinate);
  const remaining=[...items], result:T[]=[];
  let divisor=size;
  for (let length=items.length;length>0;length--) {
    divisor/=BigInt(length);
    const index=Number(coordinate/divisor); coordinate%=divisor;
    result.push(remaining.splice(index,1)[0]!);
  }
  return result;
}

/** Inverse coordinate for a permutation of distinct stable member keys. */
export function permutationCoordinate<T>(items:readonly T[],order:readonly T[]):bigint{
  if(new Set(items).size!==items.length||order.length!==items.length)throw Error('Invalid permutation members');
  const remaining=[...items];let coordinate=0n,divisor=permutationCount(items.length);
  for(const item of order){
    divisor/=BigInt(remaining.length);const index=remaining.indexOf(item);
    if(index<0)throw Error('Invalid permutation member');
    coordinate+=BigInt(index)*divisor;remaining.splice(index,1);
  }
  return coordinate;
}
