import { types } from 'node:util';
const nativeInspection = {getPrototypeOf:Object.getPrototypeOf,getOwnPropertyDescriptor:Object.getOwnPropertyDescriptor,ownKeys:Reflect.ownKeys};
export function keys(value: unknown, inspection = nativeInspection): string[] {
  if (value === null || typeof value !== 'object') throw new TypeError('Expected a data table');
  if (types.isProxy(value)) throw new TypeError('Proxy cannot cross a boundary');
  if (Array.isArray(value)) throw new TypeError('Expected a data table');
  const proto = inspection.getPrototypeOf(value);
  if (proto !== null && types.isProxy(proto)) throw new TypeError('Proxy cannot cross a boundary');
  if (proto !== null && inspection.getPrototypeOf(proto) !== null) throw new TypeError('Expected a plain object');
  const names = inspection.ownKeys(value);
  if (names.some(k => typeof k !== 'string')) throw new TypeError('Symbol keys are forbidden');
  for (const k of names) {
    const d = inspection.getOwnPropertyDescriptor(value, k)!;
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
export function copy<T>(value: T, inspection = nativeInspection): T {
  const seen = new Map<object, unknown>();
  function visit(x: unknown): unknown {
    if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'undefined' || typeof x === 'bigint') return x;
    if (typeof x !== 'object') throw new TypeError('Functions, symbols and resources cannot cross a boundary');
    if (types.isProxy(x)) throw new TypeError('Proxy cannot cross a boundary');
    if (seen.has(x)) return seen.get(x);
    const array = Array.isArray(x);
    if (!array) keys(x, inspection);else {
      const prototype = inspection.getPrototypeOf(x);
      if (types.isProxy(prototype)) throw new TypeError('Proxy cannot cross a boundary');
      if (!Array.isArray(prototype)) throw new TypeError('Expected a standard array');
      const base = inspection.getPrototypeOf(prototype);
      if (base === null) throw new TypeError('Expected a standard array');
      if (types.isProxy(base)) throw new TypeError('Proxy cannot cross a boundary');
      if (inspection.getPrototypeOf(base) !== null) throw new TypeError('Expected a standard array');
    }
    const out: Record<string, unknown> | unknown[] = array ? new Array(inspection.getOwnPropertyDescriptor(x, 'length')!.value) : {};
    seen.set(x, out);
    for (const k of inspection.ownKeys(x)) {
      if (array && k === 'length') continue;
      if (typeof k !== 'string') throw new TypeError('Symbol keys are forbidden');
      const d = inspection.getOwnPropertyDescriptor(x, k)!;
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
/** Compare boundary data without invoking accessors on caller-owned objects. */
export function sameData(a: unknown, b: unknown): boolean {
  return equal(copy(a), copy(b));
}
export function read<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  const original = copy(value);
  // The comparison baseline must never be handed to an author callback.
  const parsed = copy(schema.parse(copy(original)));
  if (!equal(original, parsed)) throw new TypeError('Boundary schema changed its input');
  return parsed;
}
export function matchTables(a: unknown, b: unknown) {
  const x = keys(a).sort(),
    y = keys(b).sort();
  if (x.length !== y.length || x.some((k, i) => k !== y[i])) throw new TypeError('Declaration tables differ');
}
const nativeSchemaInspection = {
  get:(value: any,key: PropertyKey): any => value[key],
  has:(value: object,key: PropertyKey): boolean => key in value,
  values:(value: object): unknown[] => Object.values(value),
  iterate:(value: any): Iterable<unknown> => value,
  invoke:(fn: Function,receiver: unknown): unknown => Reflect.apply(fn,receiver,[])
};
export function admitSchema(schema: unknown, seen = new Set<unknown>(), inspection = nativeSchemaInspection): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const read = inspection.get;
  if (!schema || typeof schema !== 'object' || !inspection.has(schema,'_zod')) throw new TypeError('Expected Zod schema');
  const def = read(read(schema,'_zod'),'def');
  if (!def || ['transform', 'pipe', 'default', 'prefault', 'catch', 'readonly'].includes(read(def,'type')) || read(def,'coerce')) throw new TypeError('Value-changing schema is forbidden');
  const allowed = new Set(['string', 'number', 'boolean', 'bigint', 'null', 'undefined', 'literal', 'enum', 'object', 'array', 'tuple', 'union', 'optional', 'nullable', 'record', 'lazy', 'never', 'unknown', 'any']);
  if (!allowed.has(read(def,'type'))) throw new TypeError('Unsupported schema ' + read(def,'type'));
  for (const k of ['element', 'innerType', 'keyType', 'valueType', 'catchall']) if (read(def,k)) admitSchema(read(def,k), seen, inspection);
  for (const s of inspection.values(read(def,'shape') ?? {})) admitSchema(s, seen, inspection);
  for (const s of inspection.iterate(read(def,'options') ?? read(def,'items') ?? [])) admitSchema(s, seen, inspection);
  if (read(def,'rest')) admitSchema(read(def,'rest'), seen, inspection);
  if (read(def,'type') === 'lazy') admitSchema(inspection.invoke(read(def,'getter'),def), seen, inspection);
  // Pure user refinements are vetted by the source compiler; read also verifies
  // value preservation. Native callers explicitly trust their local schemas.
}
