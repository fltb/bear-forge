import { isStaticHandle } from './rules-internal.ts';
/** Copy only data; a module callback never receives a writable view of the live graph. */
export function dataCopy<T>(input: T, freeze = false, staticValue?:(value:object)=>unknown): T {
  const seen = new Map<object, any>();
  const visit = (value: any): any => {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') throw Error('Rule atom values must be data');
      return value;
    }
    const old = seen.get(value); if (old) return old;
    if(isStaticHandle(value)){
      if(!staticValue)throw Error('Static rule handle cannot enter runtime data');
      const replacement=staticValue(value);if(replacement===value)throw Error('Static rule handle was not lowered');
      const out=visit(replacement);seen.set(value,out);return out;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null && !Array.isArray(value)) throw Error('Rule atom values must be plain data');
    const out: any = Array.isArray(value) ? new Array(value.length) : {}; seen.set(value, out);
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value,key)!;
      if (!Object.hasOwn(descriptor,'value')) throw Error('Rule atom values cannot contain accessors');
      Object.defineProperty(out,key,{value:visit(descriptor.value),enumerable:true,writable:true,configurable:true});
    }
    return freeze ? Object.freeze(out) : out;
  };
  return visit(input);
}

/** Equality for rule data, including alias relationships and array holes. */
export function sameRuleData(left:unknown,right:unknown):boolean{
  const forward=new Map<object,object>(),reverse=new Map<object,object>();
  const compare=(a:any,b:any):boolean=>{
    if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return Object.is(a,b);
    if(Array.isArray(a)!==Array.isArray(b)||Array.isArray(a)&&a.length!==b.length)return false;
    if(forward.has(a))return forward.get(a)===b;
    if(reverse.has(b))return false;
    forward.set(a,b);reverse.set(b,a);
    const ak=Object.keys(a),bk=Object.keys(b);
    if(ak.length!==bk.length)return false;
    for(let i=0;i<ak.length;i++)if(ak[i]!==bk[i]||!compare(a[ak[i]!],b[bk[i]!]))return false;
    return true;
  };
  return compare(left,right);
}
