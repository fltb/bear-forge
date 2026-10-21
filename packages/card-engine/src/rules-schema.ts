import { ZodError } from 'zod';
import * as core from 'zod/v4/core';
import type { Schema } from './rules-module.types.ts';
import { detachRuleValue, lowerRuleValue, ownLoweredRuleValue, ownRuleValue, ownPrivateRuleValue, isImmutableRuleValue } from './rules-values.ts';
import type {Borrowed} from './rules.types.ts';

type Run = (value: unknown, issues: core.$ZodRawIssue[]) => unknown;
type Node = { run: Run; identity: boolean; pure: boolean; checksIncluded?: true };
export type RuleSchemaPlan<T> = {
  readonly apply: (value: T) => T;
  readonly own: (value: T|Borrowed<T>, reference?: (value: object) => unknown) => Borrowed<T>;
};
const plans = new WeakMap<object, RuleSchemaPlan<unknown>>();
const nodes = new WeakMap<core.$ZodType, Node>();
const identity: Node = { run: value => value, identity: true, pure: true };
const context: core.ParseContextInternal = { async: false };

function prefix(issues: core.$ZodRawIssue[], start: number, key: PropertyKey): void {
  for (let index = start; index < issues.length; index++) {
    const issue = issues[index]!; issues[index] = {...issue,path:[key, ...(issue.path ?? [])]};
  }
}

/** Built-in predicate checks have no allocation on their successful path. */
function quickCheck(check: core.$ZodCheck): ((value: unknown) => boolean) | null {
  const definition = (check as core.$ZodChecks)._zod.def;
  if (definition.when) return null;
  switch (definition.check) {
    case 'less_than': {
      const limit = definition.value; if (typeof limit === 'object') return null;
      return value => definition.inclusive ? (value as number) <= limit : (value as number) < limit;
    }
    case 'greater_than': {
      const limit = definition.value; if (typeof limit === 'object') return null;
      return value => definition.inclusive ? (value as number) >= limit : (value as number) > limit;
    }
    case 'max_length': return value => (value as { length: number }).length <= definition.maximum;
    case 'min_length': return value => (value as { length: number }).length >= definition.minimum;
    case 'length_equals': return value => (value as { length: number }).length === definition.length;
    case 'number_format': {
      const [minimum, maximum] = core.util.NUMBER_FORMAT_RANGES[definition.format];
      const integer = definition.format.includes('int');
      return value => (!integer || Number.isSafeInteger(value)) && (value as number) >= minimum && (value as number) <= maximum;
    }
    default: return null;
  }
}

function checked(schema: core.$ZodType, base: Node): Node {
  // Formats (int32, email, etc.) are also checks themselves; they are not
  // necessarily present in def.checks. Erase only the schema's generic type.
  const checks = (schema._zod.traits.has('$ZodCheck')
    ? [schema, ...(schema._zod.def.checks ?? [])] : schema._zod.def.checks ?? []) as core.$ZodCheck<unknown>[];
  if (!checks.length) return base;
  const entries = checks.map(check => ({ check, quick: quickCheck(check) }));
  const pure = base.pure && entries.every(entry => entry.quick !== null);
  return { identity: false, pure, checksIncluded: true, run(value, issues) {
    // A refinement can retain or mutate nested unknown fields. Only semantic
    // callbacks need a detached input; builtin predicates borrow the version.
    const start = issues.length, output = base.run(pure ? value : detachRuleValue(value), issues);
    let payload: core.ParsePayload | undefined;
    for (const { check, quick } of entries) {
      if (!payload && issues.length === start && quick?.(output)) continue;
      payload ??= { value: output, issues: issues.slice(start) };
      if (check._zod.def.when ? core.util.explicitlyAborted(payload) || !check._zod.def.when(payload) : core.util.aborted(payload)) continue;
      const before = payload.issues.length, result = check._zod.check(payload);
      if (result instanceof Promise) throw new core.$ZodAsyncError();
      core.util.attachSchema(payload.issues, before, schema);
    }
    if (payload) { issues.length = start; issues.push(...payload.issues); return payload.value; }
    return output;
  } };
}

function semanticNode(schema: core.$ZodType): Node {
  // Opaque transforms/custom schemas are computations, not TS shape checks.
  return { identity: false, pure: false, checksIncluded: true, run(value, issues) {
    const result = schema._zod.run({ value: detachRuleValue(value), issues: [] }, context);
    if (result instanceof Promise) throw new core.$ZodAsyncError();
    issues.push(...result.issues); return result.value;
  } };
}

/** Pure plans depend only on immutable values and their linked schema. Cache
 * those pairs, including normalized outputs, never a mutable author object. */
function sharePure(node: Node): Node {
  if (!node.pure || node.identity) return node;
  const results = new WeakMap<object, unknown>();
  return {...node, run(value, issues) {
    const owned = value !== null && typeof value === 'object' && isImmutableRuleValue(value);
    if (owned && results.has(value)) return results.get(value);
    const start = issues.length;
    const output = node.run(value, issues);
    if (owned && issues.length === start) {
      // Cache only an owned output: a caller of apply may write a newly built
      // mutable result. own will freeze that result at its publication point.
      if (output === null || typeof output !== 'object' || isImmutableRuleValue(output)) results.set(value, output);
    }
    return output;
  }};
}

function compileNode(schema: core.$ZodType): Node {
  const known = nodes.get(schema); if (known) return known;
  // The recursive thunk is resolved at assembly, never by rescanning schema.
  let implementation: Node = identity;
  const pending: Node = { identity: false, pure: false, run: (value, issues) => implementation.run(value, issues) };
  nodes.set(schema, pending);
  const definition = (schema as core.$ZodTypes)._zod.def;
  let base: Node;
  if ('coerce' in definition && definition.coerce) base = semanticNode(schema);
  else switch (definition.type) {
    case 'string': case 'boolean': case 'bigint': case 'null': case 'undefined': case 'void':
    case 'literal': case 'enum': case 'unknown': case 'any': base = identity; break;
    case 'number': base = { identity: false, pure: true, run(value, issues) {
      if (!Number.isFinite(value)) issues.push({ code: 'invalid_type', expected: 'number', input: value, inst: schema,
        ...(typeof value === 'number' ? { received: Number.isNaN(value) ? 'NaN' : String(value) } : {}) });
      return value;
    } }; break;
    case 'optional': case 'nullable': {
      const inner = compileNode(definition.innerType);
      base = { identity: inner.identity, pure: inner.pure, run: definition.type === 'optional'
        ? (value, issues) => value === undefined ? undefined : inner.run(value, issues)
        : (value, issues) => value === null ? null : inner.run(value, issues) };
      break;
    }
    case 'object': {
      const fields = Object.entries(definition.shape).map(([key, child]) => ({ key, node: compileNode(child) }));
      const names = new Set(fields.map(field => field.key));
      const strict = definition.catchall?._zod.def.type === 'never';
      const extra = definition.catchall && !strict ? compileNode(definition.catchall) : null;
      base = { identity: false, pure: fields.every(field => field.node.pure) && (!extra || extra.pure), run(value, issues) {
        const input = value as Record<string, unknown>, keys = Object.keys(input);
        // Borrow until normalization actually changes a field or its order.
        // The copied prefix is known to match both input values and schema order.
        let output: Record<string, unknown> | undefined = isImmutableRuleValue(input) ? undefined : {};
        let position = 0;
        const write = (target: Record<string, unknown>, key: string, item: unknown): void => {
          if (key in Object.prototype) Object.defineProperty(target, key, { value: item, enumerable: true, writable: true, configurable: true });
          else target[key] = item;
        };
        const separate = (): Record<string, unknown> => {
          if (!output) { output = {}; for (let index = 0; index < position; index++) { const key = keys[index]!; write(output, key, input[key]); } }
          return output;
        };
        const put = (key: string, next: unknown): void => {
          if (!output && (key !== keys[position] || !Object.is(next, input[key]))) separate();
          if (output) write(output, key, next);
          position++;
        };
        for (const { key, node } of fields) {
          const start = issues.length, next = node.run(input[key], issues);
          prefix(issues, start, key);
          if (next !== undefined || Object.hasOwn(input, key)) put(key, next);
        }
        // Extra keys are not excluded by TS structural assignability. Stripping
        // or strict rejection is normalization semantics, not a typeof loop.
        if (strict || extra) {
          const unknown: string[] = [];
          for (const key of keys) if (!names.has(key)) {
            if (strict) unknown.push(key);
            else { const start = issues.length, next = extra!.run(input[key], issues); prefix(issues, start, key); put(key, next); }
          }
          if (unknown.length) issues.push({ code: 'unrecognized_keys', keys: unknown, input, inst: schema });
        }
        if (position !== keys.length) separate();
        return output ?? input;
      } };
      break;
    }
    case 'array': {
      const element = compileNode(definition.element);
      base = { identity: false, pure: element.pure, run(value, issues) {
        const input = value as unknown[];
        let output: unknown[] | undefined = isImmutableRuleValue(input) && Object.keys(input).length === input.length ? undefined : new Array<unknown>(input.length);
        for (let index = 0; index < input.length; index++) {
          const start = issues.length, next = element.run(input[index], issues); prefix(issues, start, index);
          if (!output && (!Object.hasOwn(input, index) || !Object.is(next, input[index]))) {
            output = new Array<unknown>(input.length); for (let previous = 0; previous < index; previous++) output[previous] = input[previous];
          }
          if (output) output[index] = next;
        }
        return output ?? input;
      } };
      break;
    }
    case 'union': {
      const alternatives = definition.options.map(compileNode);
      // A union of type-only alternatives needs no runtime discriminator.
      // General unions still perform their actual selection/normalization.
      base = alternatives.every(node => node.identity) ? identity : semanticNode(schema);
      break;
    }
    default: base = semanticNode(schema);
  }
  // Opaque nodes already execute their complete checks exactly once.
  implementation = sharePure(base.checksIncluded ? base : checked(schema, base));
  nodes.set(schema, implementation);
  return implementation;
}

function isolateIssue<T extends core.$ZodRawIssue>(issue:T):T {
  return {...issue,input:detachRuleValue(issue.input)};
}

/** Called while linking. apply only performs value-dependent work. */
export function bindRuleSchema<T>(schema: Schema<T>): RuleSchemaPlan<T> {
  const known = plans.get(schema); if (known) return known as RuleSchemaPlan<T>;
  const internal = (schema as Schema<T> & { _zod?: core.$ZodType['_zod'] })._zod;
  const node = internal ? compileNode(schema as unknown as core.$ZodType) : null;
  const apply: RuleSchemaPlan<T>['apply'] = node ? value => {
    if (node.identity) return value;
    const issues: core.$ZodRawIssue[] = [], output = node.run(value, issues);
    if (issues.length) throw new ZodError(issues.map(issue => core.util.finalizeIssue(isolateIssue(issue), context, core.config())));
    return output as T;
  } : value => schema.parse(detachRuleValue(value));
  const plan: RuleSchemaPlan<T> = { apply, own(value, reference) {
    // Lowering owns new containers and borrows already-owned children. The
    // callback-free result therefore needs no second deep copy before publish.
    const result = apply((node?.pure ? ownLoweredRuleValue(value, reference) : lowerRuleValue(value, reference)) as T);
    return (node?.pure ? ownPrivateRuleValue(result) : ownRuleValue(result)) as Borrowed<T>;
  } };
  plans.set(schema, plan as RuleSchemaPlan<unknown>);
  return plan;
}
