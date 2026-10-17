import { types } from 'node:util';
type Inspection = {
  getPrototypeOf: typeof Object.getPrototypeOf;
  // Internal storage adapters may fill scratch; copy saves each value before reuse.
  getOwnPropertyDescriptor(value: object, key: PropertyKey, scratch?: PropertyDescriptor): PropertyDescriptor | undefined;
  ownKeys: typeof Reflect.ownKeys;
};
const nativeInspection: Inspection = {getPrototypeOf:Object.getPrototypeOf,getOwnPropertyDescriptor:Object.getOwnPropertyDescriptor,ownKeys:Reflect.ownKeys};
const nativeObjectKeys = Object.keys;
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
    if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Expected enumerable data properties');
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
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'undefined' || typeof value === 'bigint') return value;
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
      // Scratch values are runtime storage, never delivered to a callback.
      // A null prototype keeps indexed writes independent of inherited setters
      // without consulting Array species through map().
      values = new Array(names.length);
      Object.setPrototypeOf(values, null);
      for (let i = 0; i < names.length; i++) {
        const k = names[i]!;
        const descriptor = inspection.getOwnPropertyDescriptor(x, k, inputDescriptor)!;
        if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new TypeError('Expected enumerable data properties');
        values[i] = descriptor.value;
      }
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
        if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Accessors and hidden fields cannot cross a boundary');
        value = d.value;
      }
      outputDescriptor.value = visit(value);
      Object.defineProperty(out, k, outputDescriptor);
    }
    return out;
  }
  return visit(value) as T;
}
function equal(a: unknown, b: unknown, seen = new Map<object, object>(), reverse = new Map<object, object>(), order?: { same: boolean }): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (seen.has(a)) return seen.get(a) === b;
  if (reverse.has(b)) return false;
  seen.set(a, b);
  reverse.set(b, a);
  const ak = Reflect.ownKeys(a),
    bk = Reflect.ownKeys(b);
  if (ak.length !== bk.length || ak.some(k => !Object.hasOwn(b, k))) return false;
  if (order && ak.some((key, i) => key !== bk[i])) order.same = false;
  return ak.every(k => equal(Reflect.get(a, k), Reflect.get(b, k), seen, reverse, order));
}
/** Both graphs are private, admitted trees. Compare every value and key while
 * avoiding per-primitive recursive calls and generic reflection. */
function equalOwnedTrees(a: any, b: any, order: { same: boolean }, dense: boolean): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const array = Array.isArray(a);
  if (array !== Array.isArray(b)) return false;
  if (array) {
    if (a.length !== b.length) return false;
    if (dense) {
      for (let i = 0; i < a.length; i++) {
        const first = a[i], second = b[i];
        if (second !== null && typeof second === 'object') { if (!equalOwnedTrees(first, second, order, dense)) return false; }
        else if (!Object.is(first, second)) return false;
      }
      return true;
    }
  }
  const firstKeys = nativeObjectKeys(a), secondKeys = nativeObjectKeys(b);
  if (firstKeys.length !== secondKeys.length) return false;
  let sameOrder = true;
  for (let i = 0; i < firstKeys.length; i++) if (firstKeys[i] !== secondKeys[i]) order.same = sameOrder = false;
  for (let i = 0; i < firstKeys.length; i++) {
    const key = firstKeys[i]!;
    if (!sameOrder && !Object.hasOwn(b, key)) return false;
    const first = a[key], second = b[key];
    if (second !== null && typeof second === 'object') { if (!equalOwnedTrees(first, second, order, dense)) return false; }
    else if (!Object.is(first, second)) return false;
  }
  return true;
}
// Host-runtime-only capability, deliberately absent from the public package
// exports. Such parsers copy input before invoking author code and return a fresh,
// already validated boundary copy. Neither side can retain host aliases.
const isolatedParsers = new WeakSet<Function>();
const isolatedSchemas = new WeakSet<object>();
export function isolatedParser<T extends (value: any) => any>(parse: T): T {
  isolatedParsers.add(parse);
  return parse;
}
// Private host capability. The host only replaces this isolated graph. Pure
// GameContract adapters may read it; parsers and public consumers receive copies.
// Do not re-export these helpers from the public package entry.
const ownedRoots = new WeakSet<object>();
const treeRoots = new WeakSet<object>();
const denseTreeRoots = new WeakSet<object>();
export function isOwned(value: unknown): boolean {
  return value !== null && typeof value === 'object' && ownedRoots.has(value);
}
export function isOwnedTree(value: unknown): boolean {
  return value === null || typeof value !== 'object' ? typeof value !== 'function' && typeof value !== 'symbol' : treeRoots.has(value);
}
export function isDenseTree(value: unknown): boolean {
  return value === null || typeof value !== 'object' ? isOwnedTree(value) : denseTreeRoots.has(value);
}
/** This only inspects a builtin prototype; exotic array bases use data writes. */
export function arrayPrototypeIsPlain(): boolean {
  return nativeInspection.getPrototypeOf(Array.prototype) === Object.prototype;
}
/** Copies admitted graphs with inherited-write protection for actual keys. */
function cloneData<T>(value: T, tree = isOwnedTree(value), dense = isDenseTree(value)): T {
  if (value === null || typeof value !== 'object') return value;
  const plainArrayBase = arrayPrototypeIsPlain();
  const seen = tree ? null : new Map<object, any>();
  function visit(x: any): any {
    if (x === null || typeof x !== 'object') return x;
    if (seen?.has(x)) return seen.get(x);
    const array = Array.isArray(x), out: any = array ? new Array(x.length) : {};
    seen?.set(x, out);
    if (array && dense) {
      for (let i = 0; i < x.length; i++) {
        const field = x[i], item = field === null || typeof field !== 'object' ? field : visit(field);
        if (plainArrayBase && !(i in Array.prototype)) out[i] = item;
        else Object.defineProperty(out, i, { value: item, writable: true, enumerable: true, configurable: true });
      }
      return out;
    }
    const inherited = array ? Array.prototype : Object.prototype;
    const names = nativeObjectKeys(x);
    for (let i = 0; i < names.length; i++) {
      const key = names[i]!;
      const field = x[key], item = field === null || typeof field !== 'object' ? field : visit(field);
      if (array && !plainArrayBase || key in inherited) Object.defineProperty(out, key, { value: item, writable: true, enumerable: true, configurable: true });
      else out[key] = item;
    }
    return out;
  }
  return visit(value);
}
/** Graph cloning is safe only after all source descriptors have been admitted.
 * No user callback runs between this scan and the synchronous clone.
 * Storage adapters keep copy() and their explicit inspection implementation. */
function admitData(value: unknown): { tree: boolean; dense: boolean } {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'undefined' || typeof value === 'bigint') return { tree: true, dense: true };
  const seen = new Set<object>();
  let tree = true, dense = true;
  function visit(x: unknown): void {
    if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'undefined' || typeof x === 'bigint') return;
    if (typeof x !== 'object') throw new TypeError('Functions, symbols and resources cannot cross a boundary');
    if (types.isProxy(x)) throw new TypeError('Proxy cannot cross a boundary');
    if (seen.has(x)) { tree = false; return; }
    seen.add(x);
    const array = Array.isArray(x);
    if (!array) plainPrototype(x, nativeInspection);
    else {
      const proto = Object.getPrototypeOf(x);
      if (types.isProxy(proto)) throw new TypeError('Proxy cannot cross a boundary');
      if (!Array.isArray(proto)) throw new TypeError('Expected a standard array');
      const base = Object.getPrototypeOf(proto);
      if (base === null) throw new TypeError('Expected a standard array');
      if (types.isProxy(base)) throw new TypeError('Proxy cannot cross a boundary');
      if (Object.getPrototypeOf(base) !== null) throw new TypeError('Expected a standard array');
    }
    const names = Reflect.ownKeys(x);
    if (array && (names.length !== (x as unknown[]).length + 1 || names[(x as unknown[]).length] !== 'length')) dense = false;
    for (const key of names) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw new TypeError('Symbol keys are forbidden');
      const field = Object.getOwnPropertyDescriptor(x, key)!;
      if (!Object.hasOwn(field, 'value') || !field.enumerable) throw new TypeError('Expected enumerable data properties');
      visit(field.value);
    }
  }
  visit(value);
  return { tree, dense };
}
/** One native admission/copy traversal. Descriptor checks precede reading data
 * values, and guarded writes cannot call author code during the traversal. */
function isolateData<T>(value: T): { value: T; tree: boolean; dense: boolean } {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'undefined' || typeof value === 'bigint') return { value, tree: true, dense: true };
  const plainArrayBase = arrayPrototypeIsPlain();
  const seen = new Map<object, any>(); let tree = true, dense = true;
  function visit(x: any): any {
    if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'undefined' || typeof x === 'bigint') return x;
    if (typeof x !== 'object') throw new TypeError('Functions, symbols and resources cannot cross a boundary');
    if (types.isProxy(x)) throw new TypeError('Proxy cannot cross a boundary');
    if (seen.has(x)) { tree = false; return seen.get(x); }
    const array = Array.isArray(x);
    if (!array) plainPrototype(x, nativeInspection);
    else {
      const proto = nativeInspection.getPrototypeOf(x);
      if (types.isProxy(proto)) throw new TypeError('Proxy cannot cross a boundary');
      if (!Array.isArray(proto)) throw new TypeError('Expected a standard array');
      const base = nativeInspection.getPrototypeOf(proto);
      if (base === null) throw new TypeError('Expected a standard array');
      if (types.isProxy(base)) throw new TypeError('Proxy cannot cross a boundary');
      if (nativeInspection.getPrototypeOf(base) !== null) throw new TypeError('Expected a standard array');
    }
    const names = nativeInspection.ownKeys(x);
    if (array && (names.length !== x.length + 1 || names[x.length] !== 'length')) dense = false;
    if (!array && names.some(key => typeof key !== 'string')) throw new TypeError('Symbol keys are forbidden');
    if (!array) for (const key of names) {
      if (typeof key !== 'string') throw new TypeError('Symbol keys are forbidden');
      const d = nativeInspection.getOwnPropertyDescriptor(x, key)!;
      if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Expected enumerable data properties');
    }
    const out: any = array ? new Array(x.length) : {}; seen.set(x, out);
    const inherited = array ? Array.prototype : Object.prototype;
    for (const key of names) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw new TypeError('Symbol keys are forbidden');
      let field: unknown;
      if (!array) field = x[key];
      else {
        const d = nativeInspection.getOwnPropertyDescriptor(x, key)!;
        if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Accessors and hidden fields cannot cross a boundary');
        field = d.value;
      }
      const item = visit(field);
      if (array && !plainArrayBase || key in inherited) Object.defineProperty(out, key, { value: item, writable: true, enumerable: true, configurable: true });
      else out[key] = item;
    }
    return out;
  }
  const result = visit(value);
  return { value: result, tree, dense };
}
function isolatePair<T>(value: T): { value: T; parserInput: T; tree: boolean; dense: boolean } {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'undefined' || typeof value === 'bigint') return { value, parserInput: value, tree: true, dense: true };
  const plainArrayBase = arrayPrototypeIsPlain();
  const seen = new Map<object, any>(); let tree = true, dense = true;
  function visit(x: any): any {
    if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'undefined' || typeof x === 'bigint') return x;
    if (typeof x !== 'object') throw new TypeError('Functions, symbols and resources cannot cross a boundary');
    if (types.isProxy(x)) throw new TypeError('Proxy cannot cross a boundary');
    if (seen.has(x)) { tree = false; return seen.get(x); }
    const array = Array.isArray(x);
    if (!array) plainPrototype(x, nativeInspection);
    else {
      const proto = nativeInspection.getPrototypeOf(x);
      if (types.isProxy(proto)) throw new TypeError('Proxy cannot cross a boundary');
      if (!Array.isArray(proto)) throw new TypeError('Expected a standard array');
      const base = nativeInspection.getPrototypeOf(proto);
      if (base === null) throw new TypeError('Expected a standard array');
      if (types.isProxy(base)) throw new TypeError('Proxy cannot cross a boundary');
      if (nativeInspection.getPrototypeOf(base) !== null) throw new TypeError('Expected a standard array');
    }
    const names = nativeInspection.ownKeys(x);
    if (array && (names.length !== x.length + 1 || names[x.length] !== 'length')) dense = false;
    if (!array && names.some(key => typeof key !== 'string')) throw new TypeError('Symbol keys are forbidden');
    if (!array) for (const key of names) {
      if (typeof key !== 'string') throw new TypeError('Symbol keys are forbidden');
      const d = nativeInspection.getOwnPropertyDescriptor(x, key)!;
      if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Expected enumerable data properties');
    }
    const out: any = array ? new Array(x.length) : {};
    const twin: any = array ? new Array(x.length) : {};
    const entry = { value: out, input: twin };
    seen.set(x, entry);
    const inherited = array ? Array.prototype : Object.prototype;
    for (const key of names) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw new TypeError('Symbol keys are forbidden');
      let field: unknown;
      if (!array) field = x[key];
      else {
        const d = nativeInspection.getOwnPropertyDescriptor(x, key)!;
        if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Accessors and hidden fields cannot cross a boundary');
        field = d.value;
      }
      const item = visit(field);
      const pair = item !== null && typeof item === 'object';
      const first = pair ? item.value : item, second = pair ? item.input : item;
      if (array && !plainArrayBase || key in inherited) {
        Object.defineProperty(out, key, { value: first, writable: true, enumerable: true, configurable: true });
        Object.defineProperty(twin, key, { value: second, writable: true, enumerable: true, configurable: true });
      } else {
        out[key] = first;
        twin[key] = second;
      }
    }
    return entry;
  }
  const result = visit(value);
  return { value: result.value, parserInput: result.input, tree, dense };
}
export function admittedCopy<T>(value: T): T {
  return isolateData(value).value;
}
export function retainOwned<T>(value: T, tree = false, dense = false): T {
  if (value !== null && typeof value === 'object') { ownedRoots.add(value); if (tree) { treeRoots.add(value); if (dense) denseTreeRoots.add(value); } }
  return value;
}
/** For a provider-created detached graph that has never reached author code.
 * Ownership alone does not prove admission (native exports may contain Dates). */
export function admitDetached<T>(value: T): T {
  const proof = admitData(value);
  return retainOwned(value, proof.tree, proof.dense);
}
export function copyOwned<T>(value: T): T {
  return value !== null && typeof value === 'object' && ownedRoots.has(value)
    ? cloneData(value) : admittedCopy(value);
}
/** Admit the complete parser result while comparing it to an inaccessible
 * baseline. A mismatch does not short-circuit admission of remaining fields. */
function checkResult(original: unknown, result: unknown): { same: boolean; order: boolean; tree: boolean; dense: boolean } {
  if (result === null || typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' || typeof result === 'undefined' || typeof result === 'bigint') return { same: Object.is(original, result), order: true, tree: true, dense: true };
  const visited = new Set<object>(), forward = isOwnedTree(original) ? null : new Map<object, object>();
  const sourceDense = isDenseTree(original);
  let same = true, order = true, tree = true, dense = true;
  function visit(a: any, b: unknown, present: boolean): void {
    if (b === null || typeof b === 'string' || typeof b === 'number' || typeof b === 'boolean' || typeof b === 'undefined' || typeof b === 'bigint') {
      if (!present || !Object.is(a, b)) same = false;
      return;
    }
    if (typeof b !== 'object') throw new TypeError('Functions, symbols and resources cannot cross a boundary');
    if (types.isProxy(b)) throw new TypeError('Proxy cannot cross a boundary');
    const seenResult = visited.has(b);
    const array = Array.isArray(b), paired = present && a !== null && typeof a === 'object' && Array.isArray(a) === array;
    if (!paired) same = false;
    else if (forward) {
      if (forward.has(a)) { if (forward.get(a) !== b) same = false; }
      else {
        // A new source node cannot map to a result node already encountered.
        // Admission's visited set is also the image set of this bijection.
        if (seenResult) same = false;
        forward.set(a, b);
      }
    } else if (seenResult) same = false; // A source tree has no repeated nodes.
    if (seenResult) { tree = false; return; }
    visited.add(b);
    if (!array) plainPrototype(b, nativeInspection);
    else {
      const proto = Object.getPrototypeOf(b);
      if (types.isProxy(proto)) throw new TypeError('Proxy cannot cross a boundary');
      if (!Array.isArray(proto)) throw new TypeError('Expected a standard array');
      const base = Object.getPrototypeOf(proto);
      if (base === null) throw new TypeError('Expected a standard array');
      if (types.isProxy(base)) throw new TypeError('Proxy cannot cross a boundary');
      if (Object.getPrototypeOf(base) !== null) throw new TypeError('Expected a standard array');
      if (paired && a.length !== (b as unknown[]).length) same = false;
    }
    const names = Reflect.ownKeys(b);
    const denseArray = array && names.length === (b as unknown[]).length + 1 && names[(b as unknown[]).length] === 'length';
    if (array && !denseArray) dense = false;
    if (paired && array && sourceDense && denseArray) {
      // Both arrays have exactly their indexed fields and length. Keep all
      // result descriptor checks, including after a length/value mismatch.
      for (let i = 0; i < (b as unknown[]).length; i++) {
        const d = Object.getOwnPropertyDescriptor(b, String(i))!;
        if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Accessors and hidden fields cannot cross a boundary');
        const has = i < a.length;
        visit(has ? a[i] : undefined, d.value, has);
      }
      return;
    }
    if (!array && names.some(key => typeof key !== 'string')) throw new TypeError('Symbol keys are forbidden');
    // For plain objects preserve copy()'s descriptor-before-child admission.
    if (!array) for (const key of names) {
      if (typeof key !== 'string') throw new TypeError('Symbol keys are forbidden');
      const d = Object.getOwnPropertyDescriptor(b, key)!;
      if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Expected enumerable data properties');
    }
    let expectedCount = 0, position = 0, localOrder = paired;
    // Private baselines contain ordinary enumerable data only. Capture the
    // builtin so a parser cannot intercept enumeration of this private graph.
    if (paired) {
      const expected = nativeObjectKeys(a);
      expectedCount = expected.length;
      for (let i = 0; i < expected.length; i++) {
        while (array && names[position] === 'length') position++;
        if (names[position++] !== expected[i]) order = localOrder = false;
      }
    }
    if (names.length - (array ? 1 : 0) !== expectedCount) localOrder = false;
    let index = 0;
    for (let i = 0; i < names.length; i++) {
      const key = names[i]!;
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw new TypeError('Symbol keys are forbidden');
      let value: unknown;
      if (!array) value = (b as any)[key];
      else {
        const d = Object.getOwnPropertyDescriptor(b, key)!;
        if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Accessors and hidden fields cannot cross a boundary');
        value = d.value;
      }
      index++;
      const has = paired && (localOrder || Object.hasOwn(a, key));
      visit(has ? a[key] : undefined, value, has);
    }
    if (index !== expectedCount) same = false;
  }
  visit(original, result, true);
  return { same, order, tree, dense };
}
export function readOwned<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  let original = value, parserInput: unknown, pairedInput = false;
  if (value !== null && typeof value === 'object' && ownedRoots.has(value)) original = value;
  else {
    pairedInput = !isolatedSchemas.has(schema);
    if (pairedInput) {
      const isolated = isolatePair(value);
      original = retainOwned(isolated.value, isolated.tree, isolated.dense);
      parserInput = isolated.parserInput;
    } else {
      const isolated = isolateData(value);
      original = retainOwned(isolated.value, isolated.tree, isolated.dense);
    }
  }
  const parse = schema.parse;
  // original is already ordinary boundary data: the native copier cannot
  // invoke an author getter or Proxy. Keep callback input ordinary and mutable.
  const isolated = isolatedParsers.has(parse);
  if (isolated) isolatedSchemas.add(schema);
  const result = Reflect.apply(parse, schema, [isolated ? original : pairedInput ? parserInput : cloneData(original)]);
  let checked: { same: boolean; order: boolean; tree: boolean; dense: boolean };
  if (isolated && isOwned(result)) {
    const order = { same: true }, tree = isOwnedTree(result), dense = isDenseTree(result);
    const trees = tree && isOwnedTree(original);
    checked = { same: trees ? equalOwnedTrees(original, result, order, dense && isDenseTree(original)) : equal(original, result, undefined, undefined, order), order: order.same, tree, dense };
  } else checked = isolated ? { same: equal(original, result), order: false, tree: false, dense: false } : checkResult(original, result);
  if (!checked.same) throw new TypeError('Boundary schema changed its input');
  // A value-preserving parser need not supply the private representation. If
  // its key order is identical, reuse our inaccessible baseline. Otherwise
  // preserve its observable ordering with one detached clone.
  return retainOwned(checked.order ? original as T : isolated && isOwned(result) ? result : cloneData(result, checked.tree, checked.dense), checked.tree, checked.dense);
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
