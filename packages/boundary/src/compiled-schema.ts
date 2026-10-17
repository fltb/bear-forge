import type { z } from 'zod';
import { compileFn, withParser, INVALID } from 'zod/v4/core';
import { copyOwned, isOwned, isolatedParser, retainOwned } from './values.ts';

function hasDetachedOutput(schema: z.ZodType, refinements: readonly z.ZodType[]): boolean {
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
      case 'object': if (Object.getOwnPropertySymbols(def.shape).length) return false; children = [...Object.values(def.shape), ...(def.catchall ? [def.catchall] : [])]; break;
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
  try { return detached(schema); }
  catch { return false; }
}

/** Private host capability for audited, finite data schemas only. Every output
 * node must be freshly constructed; named checks must neither mutate nor retain
 * it. Unknown/any/lazy/transforms and unreviewed checks use the original schema.
 * This is deliberately absent from the public package exports. */
export function isolatedDataSchema<T extends z.ZodType>(schema: T, refinements: readonly z.ZodType[] = []): T {
  if (!hasDetachedOutput(schema, refinements)) return schema;
  let parse: ReturnType<typeof compileFn<T>>;
  try { parse = compileFn(schema); }
  catch { return schema; }
  const compiled = withParser(schema, parse);
  const fallback = schema.parse;
  compiled.parse = isolatedParser((value: unknown, params?: Parameters<T['parse']>[1]) => {
    const privateInput = isOwned(value), result = parse(value);
    if (result === INVALID) {
      const parsed = fallback(privateInput ? copyOwned(value) : value, params) as z.output<T>;
      return privateInput ? copyOwned(parsed) : parsed;
    }
    // Public parse/read outputs stay unbranded. Only the framework can supply
    // a private input, and the audited parser cannot retain its fresh result.
    return privateInput ? retainOwned(result, true, true) : result;
  });
  return compiled;
}
