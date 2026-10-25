/** Exact nonnegative mass. Bigint data survives storage without rounding tiny
 * branches to zero. Numeric weights are interpreted as the supplied finite
 * binary numbers and normalized by their exact sum, preserving their ratios. */
export type ProbabilityMass={numerator:bigint;denominator:bigint};
const gcd=(a:bigint,b:bigint):bigint=>{while(b){const next=a%b;a=b;b=next;}return a;};
export function probabilityMass(numerator:bigint,denominator=1n):ProbabilityMass{
  const divisor=gcd(numerator,denominator);return{numerator:numerator/divisor,denominator:denominator/divisor};
}
export const unitMass=():ProbabilityMass=>probabilityMass(1n);
export const zeroMass=():ProbabilityMass=>probabilityMass(0n);
export function addMass(a:ProbabilityMass,b:ProbabilityMass):ProbabilityMass{
  const divisor=gcd(a.denominator,b.denominator);
  return probabilityMass(a.numerator*(b.denominator/divisor)+b.numerator*(a.denominator/divisor),a.denominator*(b.denominator/divisor));
}
export function subtractMass(a:ProbabilityMass,b:ProbabilityMass):ProbabilityMass{
  return probabilityMass(a.numerator*b.denominator-b.numerator*a.denominator,a.denominator*b.denominator);
}
export function multiplyMass(a:ProbabilityMass,b:ProbabilityMass):ProbabilityMass{
  const left=gcd(a.numerator,b.denominator),right=gcd(b.numerator,a.denominator);
  return probabilityMass((a.numerator/left)*(b.numerator/right),(a.denominator/right)*(b.denominator/left));
}
export function compareMass(a:ProbabilityMass,b:ProbabilityMass):number{
  const difference=a.numerator*b.denominator-b.numerator*a.denominator;return difference<0n?-1:difference>0n?1:0;
}
export function numericMass(value:number):ProbabilityMass{
  if(value===0)return zeroMass();
  const bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,value);
  const bits=bytes.getBigUint64(0),exponent=Number((bits>>52n)&0x7ffn),fraction=bits&((1n<<52n)-1n);
  const significand=exponent===0?fraction:(1n<<52n)|fraction,shift=(exponent===0?-1022:exponent-1023)-52;
  return shift>=0?probabilityMass(significand<<BigInt(shift)):probabilityMass(significand,1n<<BigInt(-shift));
}

export function divideMass(a:ProbabilityMass,b:ProbabilityMass):ProbabilityMass{
  return multiplyMass(a,probabilityMass(b.denominator,b.numerator));
}
/** Display/legacy numeric adapter only; exact search never uses this value. */
export function massNumber(value:ProbabilityMass):number{
  if(value.numerator===0n)return 0;
  const bits=(n:bigint)=>n.toString(2).length;
  const left=Math.max(0,bits(value.numerator)-53),right=Math.max(0,bits(value.denominator)-53);
  return Number(value.numerator>>BigInt(left))/Number(value.denominator>>BigInt(right))*2**(left-right);
}
