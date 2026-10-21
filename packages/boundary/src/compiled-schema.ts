import type { z } from 'zod';
import { compileFn, withParser, INVALID } from 'zod/v4/core';
import { copyOwned, isOwned, isDenseTree, isolatedParser, retainOwned,faithfulParser } from './values.ts';

type Order = (value: any) => any;
const unchanged: Order = value => value;
/** Output order is observable even for value-preserving schemas. Bind its
 * normalization separately from Zod's compiled predicate; do not build a
 * complete parser twin just to discover that the private tree is unchanged. */
function bindBorrowedOrder(schema: z.ZodType): Order | null {
  const def = schema._zod.def as any;
  if (def.coerce || (def.checks ?? []).some((check: any) => ['custom','overwrite'].includes(check._zod.def.check) || check._zod.def.when)) return null;
  switch (def.type) {
    case 'string': case 'number': case 'boolean': case 'bigint': case 'null': case 'undefined': case 'never': case 'literal': case 'enum': return unchanged;
    case 'optional': case 'nullable': {
      const inner = bindBorrowedOrder(def.innerType); if (!inner) return null;
      return value => value === (def.type === 'optional' ? undefined : null) ? value : inner(value);
    }
    case 'array': {
      const element = bindBorrowedOrder(def.element); if (!element) return null;
      if (element === unchanged) return unchanged;
      return value => {
        let output: any[] | undefined;
        for (let index = 0; index < value.length; index++) {
          const next = element(value[index]);
          if (!output && next !== value[index]) {
            output = new Array(value.length);
            for (let previous = 0; previous < index; previous++) Object.defineProperty(output, previous, {value:value[previous],writable:true,enumerable:true,configurable:true});
          }
          if (output) Object.defineProperty(output, index, {value:next,writable:true,enumerable:true,configurable:true});
        }
        return output ?? value;
      };
    }
    case 'object': {
      if (def.catchall?._zod.def.type !== 'never') return null;
      const fields: {key:string;order:Order}[] = [];
      for (const [key, child] of Object.entries(def.shape)) { const order = bindBorrowedOrder(child as z.ZodType); if (!order) return null; fields.push({key,order}); }
      return value => {
        const keys = Object.keys(value); let position = 0, output: Record<string,unknown> | undefined;
        for (const {key,order} of fields) {
          if (!Object.hasOwn(value,key)) continue;
          const next = order(value[key]);
          if (!output && (key !== keys[position] || next !== value[key])) {
            output = {};
            for (let previous = 0; previous < position; previous++) { const name = keys[previous]!; Object.defineProperty(output,name,{value:value[name],writable:true,enumerable:true,configurable:true}); }
          }
          if (output) Object.defineProperty(output,key,{value:next,writable:true,enumerable:true,configurable:true});
          position++;
        }
        return output ?? value;
      };
    }
    default: return null;
  }
}

function inspectOutput(schema: z.ZodType, refinements: readonly z.ZodType[]): {detached:boolean;faithful:boolean} {
  let faithful=true;
  const approved = new Set<Function>();
  const checkFunction = (check: any): Function | undefined => check._zod.def.fn ?? check._zod.check;
  for (const refinement of refinements) for (const check of refinement._zod.def.checks ?? []) {
    if (check._zod.def.check === 'custom') { const fn = checkFunction(check); if (fn) approved.add(fn); }
  }
  const done = new Set<object>(), active = new Set<object>();
  const detached = (node: any): boolean => {
    if (done.has(node)) return true;
    if (active.has(node)) return false;
    active.add(node);
    const def = node._zod.def;
    if (def.coerce) return false;
    for (const check of def.checks ?? []) {
      if (check._zod.def.check === 'overwrite' || check._zod.def.check === 'custom' && !approved.has(checkFunction(check)!)) return false;
    }
    let children: any[];
    switch (def.type) {
      case 'string': case 'number': case 'boolean': case 'bigint': case 'null': case 'undefined': case 'never': children = []; break;
      case 'enum': if (Object.values(def.entries).some(value => value !== null && ['object', 'function', 'symbol'].includes(typeof value))) return false; children = []; break;
      case 'literal': if (def.values.some((value: unknown) => value !== null && ['object', 'function', 'symbol'].includes(typeof value))) return false; children = []; break;
      case 'object': if(!def.catchall)faithful=false; if (Object.getOwnPropertySymbols(def.shape).length) return false; children = [...Object.values(def.shape), ...(def.catchall ? [def.catchall] : [])]; break;
      case 'array': children = [def.element]; break;
      case 'tuple': children = [...def.items, ...(def.rest ? [def.rest] : [])]; break;
      case 'record': if (def.mode === 'loose') return false; children = [def.keyType, def.valueType]; break;
      case 'union': children = def.options; break;
      case 'optional': case 'nullable': children = [def.innerType]; break;
      default: return false;
    }
    if (!children.every(detached)) return false;
    active.delete(node); done.add(node);
    return true;
  };
  try { return {detached:detached(schema),faithful}; }
  catch { return {detached:false,faithful:false}; }
}

/** Private host capability for audited, finite data schemas only. Public parse
 * outputs and values passed to approved checks are freshly constructed. Pure
 * predicates may borrow admitted private trees and normalize only their order.
 * Unknown/any/lazy/transforms and unreviewed checks use the original schema.
 * This is deliberately absent from the public package exports. */
export function isolatedDataSchema<T extends z.ZodType>(schema: T, refinements: readonly z.ZodType[] = []): T {
  const proof=inspectOutput(schema,refinements);if(!proof.detached)return schema;
  let parse: ReturnType<typeof compileFn<T>>;
  try { parse = compileFn(schema); }
  catch { return schema; }
  const compiled = withParser(schema, parse);
  const fallback = schema.parse;
  const order = proof.faithful ? bindBorrowedOrder(schema) : null;
  let validate: ReturnType<typeof compileFn<T>> | undefined;
  if (order) try { validate = compileFn(schema, {assertOnly:true}); } catch { /* the existing parser retains unsupported semantics */ }
  compiled.parse = isolatedParser((value: unknown, params?: Parameters<T['parse']>[1]) => {
    const privateInput = isOwned(value), borrowed = privateInput && isDenseTree(value) && validate && order;
    const result = borrowed ? validate!(value) : parse(value);
    if (result === INVALID) {
      const parsed = fallback(privateInput ? copyOwned(value) : value, params) as z.output<T>;
      return privateInput ? copyOwned(parsed) : parsed;
    }
    // Public parse/read outputs stay unbranded. Only the framework can supply
    // a private input, and the audited parser cannot retain its fresh result.
    return privateInput ? retainOwned(borrowed ? order!(value) : result,true,true) : result;
  });
  if(proof.faithful)faithfulParser(compiled.parse);
  return compiled;
}
