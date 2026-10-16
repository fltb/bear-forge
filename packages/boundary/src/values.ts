import { types } from 'node:util';
type Inspection = {
  getPrototypeOf: typeof Object.getPrototypeOf;
  // Internal storage adapters may fill scratch; copy saves each value before reuse.
  getOwnPropertyDescriptor(value: object, key: PropertyKey, scratch?: PropertyDescriptor): PropertyDescriptor | undefined;
  ownKeys: typeof Reflect.ownKeys;
};
const nativeInspection: Inspection = {getPrototypeOf:Object.getPrototypeOf,getOwnPropertyDescriptor:Object.getOwnPropertyDescriptor,ownKeys:Reflect.ownKeys};
function plainPrototype(value: object, inspection: typeof nativeInspection): void {
  const proto = inspection.getPrototypeOf(value);
  if (proto !== null && types.isProxy(proto)) throw new TypeError('Proxy cannot cross a boundary');
  if (proto !== null && inspection.getPrototypeOf(proto) !== null) throw new TypeError('Expected a plain object');
}
export function keys(value: unknown, inspection = nativeInspection): string[] {
  if (value === null || typeof value !== 'object') throw new TypeError('Expected a data table');
  if (types.isProxy(value)) throw new TypeError('Proxy cannot cross a boundary');
  if (Array.isArray(value)) throw new TypeError('Expected a data table');
  plainPrototype(value, inspection);
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
  // defineProperty consumes the descriptor synchronously. Keep one private
  // descriptor for this traversal; recursive visits finish before its value
  // is installed, and no caller-owned getter or setter can observe it.
  const inputDescriptor: PropertyDescriptor = {};
  const outputDescriptor: PropertyDescriptor = {value: undefined, enumerable: true, writable: true, configurable: true};
  function visit(x: unknown): unknown {
    if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'undefined' || typeof x === 'bigint') return x;
    if (typeof x !== 'object') throw new TypeError('Functions, symbols and resources cannot cross a boundary');
    if (types.isProxy(x)) throw new TypeError('Proxy cannot cross a boundary');
    if (seen.has(x)) return seen.get(x);
    const array = Array.isArray(x);
    if (!array) plainPrototype(x, inspection);else {
      const prototype = inspection.getPrototypeOf(x);
      if (types.isProxy(prototype)) throw new TypeError('Proxy cannot cross a boundary');
      if (!Array.isArray(prototype)) throw new TypeError('Expected a standard array');
      const base = inspection.getPrototypeOf(prototype);
      if (base === null) throw new TypeError('Expected a standard array');
      if (types.isProxy(base)) throw new TypeError('Proxy cannot cross a boundary');
      if (inspection.getPrototypeOf(base) !== null) throw new TypeError('Expected a standard array');
    }
    const names = inspection.ownKeys(x);
    let values: unknown[] | undefined;
    if (!array) {
      if (names.some(k => typeof k !== 'string')) throw new TypeError('Symbol keys are forbidden');
      values = names.map(k => {
        const descriptor = inspection.getOwnPropertyDescriptor(x, k, inputDescriptor)!;
        if (!('value' in descriptor) || !descriptor.enumerable) throw new TypeError('Expected enumerable data properties');
        return descriptor.value;
      });
    }
    const out: Record<string, unknown> | unknown[] = array ? new Array(inspection.getOwnPropertyDescriptor(x, 'length')!.value) : {};
    seen.set(x, out);
    for (let i = 0; i < names.length; i++) {
      const k = names[i]!;
      if (array && k === 'length') continue;
      if (typeof k !== 'string') throw new TypeError('Symbol keys are forbidden');
      let value: unknown;
      if (values) value = values[i];
      else {
        const d = inspection.getOwnPropertyDescriptor(x, k, inputDescriptor)!;
        if (!('value' in d) || !d.enumerable) throw new TypeError('Accessors and hidden fields cannot cross a boundary');
        value = d.value;
      }
      outputDescriptor.value = visit(value);
      Object.defineProperty(out, k, outputDescriptor);
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
  if (ak.length !== bk.length || ak.some(k => !Object.hasOwn(b, k))) return false;
  return ak.every(k => equal(Reflect.get(a, k), Reflect.get(b, k), seen, reverse));
}
// Host-runtime-only capability, deliberately absent from the public package
// exports. Such parsers copy input before invoking author code and return a fresh,
// already validated boundary copy. Neither side can retain host aliases.
const isolatedParsers = new WeakSet<Function>();
export function isolatedParser<T extends (value: any) => any>(parse: T): T {
  isolatedParsers.add(parse);
  return parse;
}
/** Compare boundary data without invoking accessors on caller-owned objects. */
export function sameData(a: unknown, b: unknown): boolean {
  return equal(copy(a), copy(b));
}
export function read<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  const original = copy(value);
  // The comparison baseline must never be handed to an author callback.
  const parse = schema.parse;
  const isolated = isolatedParsers.has(parse);
  const result = Reflect.apply(parse, schema, [isolated ? original : copy(original)]);
  const parsed = isolated ? result : copy(result);
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
