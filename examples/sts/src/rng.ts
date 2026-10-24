/** Numeric semantics of sts_lightspeed 7476a819's Random.h; state is ordinary Context data. */
export type RandomState={counter:number;seed0:bigint;seed1:bigint};
const u64=(n:bigint)=>BigInt.asUintN(64,n);
const i64=(n:bigint)=>BigInt.asIntN(64,n);
export function parseSeed(seed:string):bigint {
  if(!/^\d+$/.test(seed))throw Error('Invalid unsigned seed');
  const value=BigInt(seed);if(value>0xffffffffffffffffn)throw Error('Seed exceeds uint64');return value;
}
export function murmurHash3(value:bigint):bigint {
  let x=u64(value);x^=x>>33n;x=u64(x*-49064778989728563n);x^=x>>33n;
  x=u64(x*-4265267296055464877n);return u64(x^(x>>33n));
}
export function randomState(seed:bigint):RandomState {
  const normalized=u64(seed),seed0=murmurHash3(normalized===0n?1n<<63n:normalized);
  return {counter:0,seed0,seed1:murmurHash3(seed0)};
}
export function nextLong(r:RandomState):bigint {
  let s1=r.seed0;const s0=r.seed1;r.seed0=s0;s1=u64(s1^(s1<<23n));
  r.seed1=u64(s1^s0^(s1>>17n)^(s0>>26n));return u64(r.seed1+s0);
}
export function nextBoundedLong(r:RandomState,bound:bigint):bigint {
  if(bound<=0n || bound>0xffffffffffffffffn)throw Error('Invalid unsigned RNG bound');
  for(;;){const bits=nextLong(r)>>1n,value=bits%bound;if(i64(bits-value+bound-1n)>=0n)return value;}
}
export function nextInt(r:RandomState,bound?:number):number {
  if(bound===undefined)return Number(BigInt.asIntN(32,nextLong(r)));
  if(!Number.isInteger(bound)||bound<1||bound>0x7fffffff)throw Error('Invalid int32 RNG bound');
  return Number(BigInt.asIntN(32,nextBoundedLong(r,BigInt(bound))));
}
export function nextDouble(r:RandomState):number {return Number(nextLong(r)>>11n)*1.1102230246251565e-16;}
export function nextFloat(r:RandomState):number {return Math.fround(Number(nextLong(r)>>40n)*5.9604644775390625e-8);}
export function randomInt(r:RandomState,first:number,last?:number):number {
  const start=last===undefined?0:first,end=last===undefined?first:last;
  if(!Number.isInteger(start)||!Number.isInteger(end)||end<start||end-start>=0x7fffffff)throw Error('Invalid int32 random range');
  r.counter++;return start+nextInt(r,end-start+1);
}
export function randomLong(r:RandomState):bigint {r.counter++;return i64(nextLong(r));}
export function randomLongRange(r:RandomState,first:bigint,last?:bigint):bigint {
  const start=last===undefined?0n:first,end=last===undefined?first:last;
  if(end<start||end-start>0x7fffffffffffffffn)throw Error('Invalid int64 random range');
  r.counter++;return start+BigInt(Math.trunc(nextDouble(r)*Number(end-start)));
}
export function randomFloat(r:RandomState,first?:number,last?:number):number {
  r.counter++;return floatAtUnit(nextFloat(r),first,last);
}
/** The original float scaling, shared by real RNG and finite image producers. */
export function floatAtUnit(f:number,first?:number,last?:number):number {
  if(first===undefined)return f;
  if(last===undefined)return Math.fround(f*Math.fround(first));
  return Math.fround(Math.fround(first)+Math.fround(f*Math.fround(Math.fround(last)-Math.fround(first))));
}
export function randomBoolean(r:RandomState,chance?:number):boolean {
  r.counter++;return chance===undefined?(nextLong(r)&1n)!==0n:nextFloat(r)<Math.fround(chance);
}
export function rngView(r:RandomState){return {counter:r.counter,seed0:r.seed0.toString(),seed1:r.seed1.toString()};}
export function setRandomCounter(r:RandomState,count:number):void {while(r.counter<count)randomBoolean(r);}

export type JavaRandomState={seed:bigint};
export function javaRandom(seed:bigint):JavaRandomState{return {seed:(seed^0x5deece66dn)&((1n<<48n)-1n)};}
export function javaNext(r:JavaRandomState,bits:number):number {
  r.seed=(r.seed*0x5deece66dn+11n)&((1n<<48n)-1n);
  const value=Number(r.seed>>BigInt(48-bits));return bits===32?value|0:value;
}
export function javaInt(r:JavaRandomState,bound:number):number {
  if(!Number.isInteger(bound)||bound<1||bound>0x7fffffff)throw Error('Invalid Java RNG bound');
  let result=javaNext(r,31);const m=bound-1;
  if((bound&m)===0)return Number((BigInt(bound)*BigInt(result))>>31n);
  for(let u=result;;u=javaNext(r,31)){result=u%bound;if(((u-result+m)|0)>=0)return result;}
}
export function javaShuffle<T>(items:T[],seed:bigint):void {
  const r=javaRandom(seed);for(let i=items.length;i>1;i--){const j=javaInt(r,i);[items[i-1],items[j]]=[items[j]!,items[i-1]!];}
}
