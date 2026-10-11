import type { z } from 'zod';
export function keys(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a data table');
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && Object.getPrototypeOf(proto) !== null) throw new TypeError('Expected a plain object');
  const names = Reflect.ownKeys(value);
  if (names.some(k => typeof k !== 'string')) throw new TypeError('Symbol keys are forbidden');
  for (const k of names) {
    const d = Object.getOwnPropertyDescriptor(value, k)!;
    if (!('value' in d) || !d.enumerable) throw new TypeError('Expected enumerable data properties');
  }
  return names as string[];
}
export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): boolean {
  try {
    const names = keys(value);
    return required.every(k => names.includes(k)) && names.every(k => required.includes(k) || optional.includes(k));
  } catch {
    return false;
  }
}
export function copy<T>(value: T): T {
  const seen = new Map<object, unknown>();
  function visit(x: unknown): unknown {
    if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'undefined' || typeof x === 'bigint') return x;
    if (typeof x !== 'object') throw new TypeError('Functions, symbols and resources cannot cross a boundary');
    if (seen.has(x)) return seen.get(x);
    const array = Array.isArray(x);
    if (!array) keys(x);else {
      const prototype = Object.getPrototypeOf(x);
      if (!Array.isArray(prototype) || Object.getPrototypeOf(Object.getPrototypeOf(prototype)) !== null) throw new TypeError('Expected a standard array');
    }
    const out: Record<string, unknown> | unknown[] = array ? new Array(x.length) : {};
    seen.set(x, out);
    for (const k of Reflect.ownKeys(x)) {
      if (array && k === 'length') continue;
      if (typeof k !== 'string') throw new TypeError('Symbol keys are forbidden');
      const d = Object.getOwnPropertyDescriptor(x, k)!;
      if (!('value' in d) || !d.enumerable) throw new TypeError('Accessors and hidden fields cannot cross a boundary');
      Object.defineProperty(out, k, {
        value: visit(d.value),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return out;
  }
  return visit(value) as T;
}
function equal(a: unknown, b: unknown, seen = new Map<object, object>(), reverse = new Map<object, object>()): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (seen.has(a)) return seen.get(a) === b;
  if (reverse.has(b)) return false;
  seen.set(a, b);
  reverse.set(b, a);
  const ak = Reflect.ownKeys(a),
    bk = Reflect.ownKeys(b);
  if (ak.length !== bk.length || ak.some(k => !bk.includes(k))) return false;
  return ak.every(k => equal(Reflect.get(a, k), Reflect.get(b, k), seen, reverse));
}
export function read<T>(schema: z.ZodType<T>, value: unknown): T {
  const original = copy(value);
  const parsed = copy(schema.parse(original));
  if (!equal(original, parsed)) throw new TypeError('Boundary schema changed its input');
  return parsed;
}
export function matchTables(a: unknown, b: unknown) {
  const x = keys(a).sort(),
    y = keys(b).sort();
  if (x.length !== y.length || x.some((k, i) => k !== y[i])) throw new TypeError('Declaration tables differ');
}
export function admitSchema(schema: unknown, seen = new Set<unknown>()): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  if (!schema || typeof schema !== 'object' || !('_zod' in schema)) throw new TypeError('Expected Zod schema');
  const def = (schema as any)._zod.def;
  if (!def || ['transform', 'pipe', 'default', 'prefault', 'catch', 'readonly'].includes(def.type) || def.coerce) throw new TypeError('Value-changing schema is forbidden');
  const allowed = new Set(['string', 'number', 'boolean', 'bigint', 'null', 'undefined', 'literal', 'enum', 'object', 'array', 'tuple', 'union', 'optional', 'nullable', 'record', 'lazy', 'never', 'unknown', 'any']);
  if (!allowed.has(def.type)) throw new TypeError('Unsupported schema ' + def.type);
  for (const k of ['element', 'innerType', 'keyType', 'valueType', 'catchall']) if (def[k]) admitSchema(def[k], seen);
  for (const s of Object.values(def.shape ?? {})) admitSchema(s, seen);
  for (const s of def.options ?? def.items ?? []) admitSchema(s, seen);
  if (def.rest) admitSchema(def.rest, seen);
  if (def.type === 'lazy') admitSchema(def.getter(), seen);
  // Pure user refinements are vetted by the source compiler; read also verifies
  // value preservation. Native callers explicitly trust their local schemas.
}
