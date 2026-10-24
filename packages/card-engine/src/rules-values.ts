import { isStaticHandle } from './rules-internal.ts';
import type {Borrowed} from './rules.types.ts';

const immutableValues = new WeakMap<object,number>();
let immutableEpoch=0;
const markImmutable=(value:object)=>{if(!immutableValues.has(value))immutableValues.set(value,++immutableEpoch);};
/** Private identity anchors for sibling-current equality, never game data or
 * entropy. Existing Program/parent objects keep their physical identity. */
export const immutableRuleEpoch=():number=>immutableEpoch;
export const immutableRuleBirth=(value:object):number|undefined=>immutableValues.get(value);
/** Private ownership evidence, not a claim inferred from Object.freeze. */
export function isImmutableRuleValue(value: object): boolean { return immutableValues.has(value); }

/** Real snapshot ingress: recover the serialized immutable block identities
 * in place so aliases to those blocks elsewhere in the snapshot stay intact. */
export function admitImmutableRuleBlock(root: object, admitted: (value: object) => void): void {
  const seen=new Set<object>(),pending:object[]=[root],nodes:object[]=[];
  while(pending.length){
    const value=pending.pop()!;if(seen.has(value))continue;seen.add(value);nodes.push(value);
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(prototype!==(array?Array.prototype:Object.prototype))throw Error('Invalid immutable snapshot block');
    for(const key of Reflect.ownKeys(value)){
      if(array&&key==='length')continue;
      if(typeof key!=='string')throw Error('Invalid immutable snapshot property');
      const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
      if(!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)throw Error('Invalid immutable snapshot field');
      const child:unknown=descriptor.value;
      if(typeof child==='function'||typeof child==='symbol')throw Error('Invalid immutable snapshot data');
      if(child!==null&&typeof child==='object')pending.push(child);
    }
  }
  for(let index=nodes.length-1;index>=0;index--){const node=nodes[index]!;Object.freeze(node);markImmutable(node);admitted(node);}
}

function materialize<T>(input: T, freeze: boolean, reference?: (value: object) => unknown, share=false): T {
  if (typeof input === 'function' || typeof input === 'symbol') throw Error('Rule values must be data');
  if (input === null || typeof input !== 'object') return input;
  const seen = new Map<object, object>(), pending: { source: object; target: Record<string, unknown>; trusted:boolean }[] = [];
  const nodes: object[] = [];
  const allocate = (value: unknown): unknown => {
    if (typeof value === 'function' || typeof value === 'symbol') throw Error('Rule values must be data');
    if (value === null || typeof value !== 'object') return value;
    const previous = seen.get(value);
    if (previous) return previous;
    const trusted=immutableValues.has(value);
    if(share&&trusted)return value;
    if (!trusted && isStaticHandle(value)) {
      if (!reference) throw Error('Static rule handle cannot enter runtime data');
      const lowered = reference(value);
      if (lowered === value) throw Error('Static rule handle was not lowered');
      const result = allocate(lowered);
      if (result !== null && typeof result === 'object') seen.set(value, result);
      return result;
    }
    const array = Array.isArray(value);
    if (!trusted && !array) {const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)throw Error('Rule values must be plain data');}
    const target = (array ? new Array(value.length) : {}) as Record<string, unknown>;
    seen.set(value, target); pending.push({ source: value, target, trusted }); nodes.push(target);
    return target;
  };
  const result = allocate(input) as T;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const { source, target, trusted } = pending[cursor]!;
    for (const key of Object.keys(source)) {
      let input:unknown;
      if(trusted)input=(source as Record<string,unknown>)[key];
      else {const descriptor=Object.getOwnPropertyDescriptor(source,key)!;if(!Object.hasOwn(descriptor,'value'))throw Error('Rule values cannot contain accessors');input=descriptor.value;}
      const value = allocate(input);
      // Own __proto__/constructor and array prototype names must stay data.
      if (key in target) Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
      else target[key] = value;
    }
  }
  if (freeze) for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!; Object.freeze(node); markImmutable(node);
  }
  return result;
}

/** A real mutable transfer/snapshot, not an internal argument-forwarding step. */
export function detachRuleValue<T>(value: T|Borrowed<T>): T { return materialize(value, false) as T; }
/** Commit a value with no author-writable alias; already-owned blocks can share. */
export function ownRuleValue<T>(value: T): T {
  return value !== null && typeof value === 'object' && immutableValues.has(value) ? value : materialize(value, true,undefined,true);
}
/** A component read borrows its owned immutable version. Only an actual
 * transfer from an unowned source needs to establish a detached version. */
export function readRuleValue<T>(value: T): Borrowed<T> { return ownRuleValue(value) as Borrowed<T>; }
export function lowerRuleValue<T>(value: T, reference?: (value: object) => unknown): T {
  if(value!==null&&typeof value==='object'&&immutableValues.has(value))return value;
  return materialize(value, false, reference, true);
}

/** Admit an unowned argument once. Pure schema plans can subsequently borrow
 * this version, including every unchanged child, without building a twin. */
export function ownLoweredRuleValue<T>(value: T, reference?: (value: object) => unknown): T {
  return value !== null && typeof value === 'object' && immutableValues.has(value)
    ? value : materialize(value, true, reference, true);
}

/** Only a private graph constructed by lowering plus a callback-free schema
 * plan may enter here. No author or parser can retain a writable alias. */
export function ownPrivateRuleValue<T>(value:T):T{
  if(value===null||typeof value!=='object')return value;
  const seen=new Set<object>(),pending:object[]=[value];
  while(pending.length){const node=pending.pop()!;if(seen.has(node)||immutableValues.has(node))continue;seen.add(node);
    for(const key of Object.keys(node)){const child=(node as Record<string,unknown>)[key];if(child!==null&&typeof child==='object')pending.push(child);}
    Object.freeze(node);markImmutable(node);
  }
  return value;
}

/** Checkpoint keep compares values and alias topology, not physical COW layout. */
export function sameRuleValue(left: unknown, right: unknown): boolean {
  const forward = new Map<object, object>(), reverse = new Map<object, object>();
  const compare = (a: unknown, b: unknown): boolean => {
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b);
    if (Array.isArray(a) !== Array.isArray(b) || Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
    if (forward.has(a)) return forward.get(a) === b;
    if (reverse.has(b)) return false;
    forward.set(a, b); reverse.set(b, a);
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    const av = a as Record<string, unknown>, bv = b as Record<string, unknown>;
    for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i] || !compare(av[ak[i]!], bv[bk[i]!])) return false;
    return true;
  };
  return compare(left, right);
}
