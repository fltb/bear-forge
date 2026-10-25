import {type ProbabilitySpace} from './probability.ts';

import {addMass,compareMass,numericMass,probabilityMass,subtractMass,unitMass,zeroMass,type ProbabilityMass} from './probability-mass.ts';
export * from './probability-mass.ts';

export type ExactProbabilitySpace={kind:'uniform';size:bigint}|{kind:'weighted';weights:ProbabilityMass[]};
/** No generator closure or history is needed to resume the next coordinate. */
export type ProbabilityCursor={space:ExactProbabilitySpace;next:bigint;remaining:ProbabilityMass;offset?:bigint};
export type WeightedProbabilityCursor={mass:ProbabilityMass;cursor:ProbabilityCursor};
export class ExactProbabilityUnavailable extends Error{
  readonly reason:string;
  constructor(reason='The current operation has no complete probability space'){super(reason);this.reason=reason;}
}
export function probabilityCursor(space:ProbabilitySpace):ProbabilityCursor{
  if(space.kind==='unavailable')throw new ExactProbabilityUnavailable(space.reason);
  if(space.kind==='boundary')return{space:{kind:'uniform',size:1n},next:0n,remaining:unitMass()};
  if(space.kind==='uniform')return{space:{kind:'uniform',size:space.size},next:0n,remaining:unitMass()};
  const weights=space.kind==='rational'?space.weights.map(weight=>probabilityMass(weight.numerator,weight.denominator)):space.weights.map(numericMass),total=weights.reduce(addMass,zeroMass());
  return{space:{kind:'weighted',weights:weights.map(weight=>probabilityMass(weight.numerator*total.denominator,weight.denominator*total.numerator))},next:0n,remaining:unitMass()};
}
export function nextProbabilityCoordinate(cursor:ProbabilityCursor):{coordinate:bigint;probability:ProbabilityMass;cursor:ProbabilityCursor}|null{
  const {space}=cursor;let next=cursor.next;
  const size=space.kind==='uniform'?space.size:BigInt(space.weights.length);
  const offset=cursor.offset??0n,coordinateAt=(index:bigint)=>(offset+index)%size;
  if(space.kind==='weighted')while(next<size&&space.weights[Number(coordinateAt(next))]!.numerator===0n)next++;
  if(next>=size)return null;
  const coordinate=coordinateAt(next);
  const probability=space.kind==='uniform'?probabilityMass(1n,space.size):space.weights[Number(coordinate)]!;
  return{coordinate,probability,cursor:{space,next:next+1n,remaining:subtractMass(cursor.remaining,probability),...(cursor.offset===undefined?{}:{offset})}};
}

/** Exact disjoint partition of two remaining coordinate sets. Each cursor is
 * a cyclic interval; cutting at its endpoints needs at most six endpoints,
 * independent of a uniform space's cardinality. Weights retain their original
 * denominators: these are submeasures, not renormalized conditional samples.
 * A new cursor's excluded prefix is represented elsewhere or already consumed;
 * constructing this partition never executes a coordinate. */
export function partitionRemainingCursors(left:ProbabilityCursor,right:ProbabilityCursor):{cursor:ProbabilityCursor;left:boolean;right:boolean}[]{
  const space=left.space;
  const size=space.kind==='uniform'?space.size:BigInt(space.weights.length);
  const intervals=(cursor:ProbabilityCursor):[bigint,bigint][]=>{
    const length=size-cursor.next;if(length===0n)return[];
    const start=((cursor.offset??0n)+cursor.next)%size,end=start+length;
    return end<=size?[[start,end]]:[[start,size],[0n,end-size]];
  };
  const a=intervals(left),b=intervals(right),cuts=[...new Set([0n,size,...a.flat(),...b.flat()])].sort((x,y)=>x<y?-1:x>y?1:0);
  const segments:{start:bigint;end:bigint;left:boolean;right:boolean}[]=[];
  for(let i=0;i<cuts.length-1;i++){
    const start=cuts[i]!,end=cuts[i+1]!,inLeft=a.some(([lo,hi])=>lo<=start&&start<hi),inRight=b.some(([lo,hi])=>lo<=start&&start<hi);
    if(!inLeft&&!inRight)continue;
    const prior=segments.at(-1);
    if(prior&&prior.end===start&&prior.left===inLeft&&prior.right===inRight)prior.end=end;
    else segments.push({start,end,left:inLeft,right:inRight});
  }
  const result:{cursor:ProbabilityCursor;left:boolean;right:boolean}[]=[];
  for(const segment of segments){
    let remaining=space.kind==='uniform'?probabilityMass(segment.end-segment.start,size):zeroMass();
    if(space.kind==='weighted')for(let i=Number(segment.start);i<Number(segment.end);i++)remaining=addMass(remaining,space.weights[i]!);
    if(remaining.numerator===0n)continue;
    const offset=segment.end%size;
    result.push({cursor:{space,next:size-(segment.end-segment.start),remaining,...(offset===0n?{}:{offset})},left:segment.left,right:segment.right});
  }
  return result;
}

/** Compact sum of remaining submeasures over one original coordinate law.
 * Disjoint weighted intervals share a single original execution Context. */
export function sumRemainingCursors(pieces:readonly WeightedProbabilityCursor[]):WeightedProbabilityCursor[]{
  if(!pieces.length)return[];
  const space=pieces[0]!.cursor.space,size=space.kind==='uniform'?space.size:BigInt(space.weights.length);
  const events=new Map<bigint,{start:ProbabilityMass;end:ProbabilityMass}>();
  const event=(point:bigint)=>{let row=events.get(point);if(!row){row={start:zeroMass(),end:zeroMass()};events.set(point,row);}return row;};
  for(const {cursor,mass} of pieces){
    const length=size-cursor.next;if(length===0n||mass.numerator===0n)continue;
    const start=((cursor.offset??0n)+cursor.next)%size,end=start+length;
    for(const [lo,hi] of end<=size?[[start,end]]:[[start,size],[0n,end-size]]){const first=event(lo!),last=event(hi!);first.start=addMass(first.start,mass);last.end=addMass(last.end,mass);}
  }
  const cuts=[...events.keys()].sort((a,b)=>a<b?-1:a>b?1:0),segments:{start:bigint;end:bigint;mass:ProbabilityMass}[]=[];let incoming=zeroMass();
  for(let i=0;i<cuts.length;i++){
    const start=cuts[i]!,change=events.get(start)!;incoming=subtractMass(addMass(incoming,change.start),change.end);
    const end=cuts[i+1];if(end===undefined||incoming.numerator===0n)continue;
    const prior=segments.at(-1);if(prior&&prior.end===start&&compareMass(prior.mass,incoming)===0)prior.end=end;else segments.push({start,end,mass:incoming});
  }
  const result:WeightedProbabilityCursor[]=[];
  for(const {start,end,mass} of segments){
    let remaining=space.kind==='uniform'?probabilityMass(end-start,size):zeroMass();
    if(space.kind==='weighted')for(let i=Number(start);i<Number(end);i++)remaining=addMass(remaining,space.weights[i]!);
    if(remaining.numerator===0n)continue;const offset=end%size;
    result.push({mass,cursor:{space,next:size-(end-start),remaining,...(offset===0n?{}:{offset})}});
  }
  return result;
}
