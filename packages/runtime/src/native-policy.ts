import { types } from 'node:util';

/** Conditions on admitted native operations. Inspect data descriptors only:
 * evaluating a custom getter while deciding admission would execute the very
 * behavior whose support has not yet been established. */
// This is an explicit list of supported entry points, not an enumeration of
// whatever methods the installed V8 happens to provide. New builtins stay out.
const nativeCalls = new Set<Function>();
const nativeRoots = new Set<object>();
const nativeGetters = new Set<Function>(), nativeSetters = new Set<Function>();
// Strict arguments expose this exact intrinsic as both callee accessors.
// It always throws and does not perform a host effect or inspect its inputs.
const argumentsPoison = Object.getOwnPropertyDescriptor((function(){'use strict';return arguments;})(), 'callee')!.get!;
nativeCalls.add(argumentsPoison); nativeGetters.add(argumentsPoison); nativeSetters.add(argumentsPoison); nativeRoots.add(argumentsPoison);
// These two protocol methods only return their receiver; they create no native cursor.
const iteratorBase = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
const asyncIteratorBase = Object.getPrototypeOf(Object.getPrototypeOf((async function*() {}).prototype));
nativeRoots.add(iteratorBase); nativeRoots.add(asyncIteratorBase);
// Catalogue host-provided function graphs for provenance even when the values
// are absent from an Instance global. Catalogue membership never admits calls.
for (const value of [Date, Proxy,
  ...(typeof URL === 'function' ? [URL] : []),
  ...(typeof File === 'function' ? [File] : []),
  ...(typeof atob === 'function' ? [atob] : []),
  ...(typeof btoa === 'function' ? [btoa] : []),
  ...(typeof DOMException === 'function' ? [DOMException] : [])]) nativeRoots.add(value);
nativeCalls.add(iteratorBase[Symbol.iterator]);
nativeCalls.add(asyncIteratorBase[Symbol.asyncIterator]);
const generatorPrototype = Object.getPrototypeOf((function*() {}).prototype);
const asyncGeneratorPrototype = Object.getPrototypeOf((async function*() {}).prototype);
function allow(target: object, names: string): void {
  nativeRoots.add(target);
  for (const name of names.split(' ')) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!descriptor) continue;
    if (descriptor.get) nativeGetters.add(descriptor.get);
    if (descriptor.set) nativeSetters.add(descriptor.set);
    for (const value of [descriptor.value, descriptor.get, descriptor.set]) {
      if (typeof value === 'function') nativeCalls.add(value);
    }
  }
}
allow(generatorPrototype, 'next return throw');
allow(asyncGeneratorPrototype, 'next return throw');
for (const constructor of [Object, Array, Number, String, Boolean, BigInt, Symbol,
  Map, Set, WeakMap, WeakSet, RegExp, Error, TypeError, RangeError, AggregateError, ...(typeof SuppressedError==='function'?[SuppressedError]:[]), SyntaxError,
  ReferenceError, EvalError, URIError, ArrayBuffer, DataView, Uint8Array,
  Int8Array, Uint8ClampedArray, Uint16Array, Int16Array, Uint32Array, Int32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array]) nativeCalls.add(constructor);
allow(Object, 'assign create defineProperty defineProperties entries fromEntries freeze getOwnPropertyDescriptor getOwnPropertyDescriptors getOwnPropertyNames getOwnPropertySymbols getPrototypeOf groupBy hasOwn is isExtensible isFrozen isSealed keys preventExtensions seal setPrototypeOf values');
allow(Object.prototype, 'hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf __defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ __proto__');
allow(Function.prototype, 'apply bind call toString');
allow(Array, 'from isArray of');
allow(Array.prototype, 'at concat copyWithin entries every fill filter find findIndex findLast findLastIndex flat flatMap forEach includes indexOf join keys lastIndexOf map pop push reduce reduceRight reverse shift slice some sort splice toReversed toSorted toSpliced toString unshift values with');
allow(Number, 'isFinite isInteger isNaN isSafeInteger parseFloat parseInt');
allow(Number.prototype, 'toExponential toFixed toPrecision toString valueOf');
allow(String, 'fromCharCode fromCodePoint raw');
allow(String.prototype, 'at charAt charCodeAt codePointAt concat endsWith includes indexOf isWellFormed lastIndexOf match matchAll normalize padEnd padStart repeat replace replaceAll search slice split startsWith substring toLowerCase toString toUpperCase toWellFormed trim trimEnd trimStart valueOf');
allow(Boolean.prototype, 'toString valueOf');
allow(BigInt, 'asIntN asUintN'); allow(BigInt.prototype, 'toString valueOf');
allow(Symbol, 'for keyFor'); allow(Symbol.prototype, 'description toString valueOf');
allow(Math, 'abs acos acosh asin asinh atan atanh atan2 cbrt ceil clz32 cos cosh exp expm1 floor fround hypot imul log log1p log2 log10 max min pow round sign sin sinh sqrt tan tanh trunc');
allow(JSON, 'parse stringify');
allow(Reflect, 'apply construct defineProperty deleteProperty get getOwnPropertyDescriptor getPrototypeOf has isExtensible ownKeys preventExtensions set setPrototypeOf');
allow(Map, 'groupBy'); allow(Map.prototype, 'clear delete entries forEach get has keys set size values');
allow(Set.prototype, 'add clear delete entries forEach has keys size values');
allow(WeakMap.prototype, 'delete get has set'); allow(WeakSet.prototype, 'add delete has');
allow(RegExp.prototype, 'exec test source flags dotAll global hasIndices ignoreCase multiline sticky unicode unicodeSets toString');
allow(Error, 'isError'); allow(Error.prototype, 'toString');
nativeCalls.add(Promise);
allow(Promise, 'resolve reject all allSettled any race withResolvers');
allow(Promise.prototype, 'then catch finally');
allow(ArrayBuffer, 'isView'); allow(ArrayBuffer.prototype, 'byteLength slice');
allow(DataView.prototype, 'buffer byteLength byteOffset getBigInt64 getBigUint64 getFloat32 getFloat64 getInt8 getInt16 getInt32 getUint8 getUint16 getUint32 setBigInt64 setBigUint64 setFloat32 setFloat64 setInt8 setInt16 setInt32 setUint8 setUint16 setUint32');
const typedArray = Object.getPrototypeOf(Uint8Array), typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
nativeCalls.add(typedArray); nativeCalls.add(Function.prototype);
allow(typedArray, 'from of');
allow(typedPrototype, 'at buffer byteLength byteOffset copyWithin entries every fill filter find findIndex findLast findLastIndex forEach includes indexOf join keys lastIndexOf length map reduce reduceRight reverse set slice some sort subarray toReversed toSorted toString values with');
for (const [target, keys] of [
  [Array.prototype, [Symbol.iterator]], [String.prototype, [Symbol.iterator]],
  [Map.prototype, [Symbol.iterator]], [Set.prototype, [Symbol.iterator]],
  [Symbol.prototype, [Symbol.toPrimitive]], [typedPrototype, [Symbol.iterator, Symbol.toStringTag]],
  [Function.prototype, [Symbol.hasInstance]],
  [RegExp.prototype, [Symbol.match, Symbol.matchAll, Symbol.replace, Symbol.search, Symbol.split]],
] as const) for (const key of keys) {
  nativeRoots.add(target);
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (typeof descriptor?.value === 'function') nativeCalls.add(descriptor.value);
  if (descriptor?.get) { nativeCalls.add(descriptor.get); nativeGetters.add(descriptor.get); }
}
for (const constructor of [Array, ArrayBuffer, RegExp, Promise, typedArray]) {
  const getter = Object.getOwnPropertyDescriptor(constructor, Symbol.species)?.get;
  if (getter) { nativeCalls.add(getter); nativeGetters.add(getter); }
}
// Host implementations may be written in JavaScript (for example Node's
// URL methods). Source spelling is not proof of author provenance. Record
// every callable reachable from admitted host entry points, including symbol
// methods. Discovery records provenance; it never grants call permission.
const hostFunctions = new WeakSet<Function>();
const hostObjects = new WeakSet<object>();
function recordHostGraph(value: unknown): void {
  if (value === null || typeof value !== 'object' && typeof value !== 'function' || hostObjects.has(value)) return;
  hostObjects.add(value);
  if (typeof value === 'function') hostFunctions.add(value);
  recordHostGraph(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value,key)!;
    if ('value' in descriptor) recordHostGraph(descriptor.value);
    else { recordHostGraph(descriptor.get); recordHostGraph(descriptor.set); }
  }
}
// Both backends admit the same standard iterator operations; the controlled
// backend supplies persistable cursors for the corresponding producer methods.
for (const iterator of [[][Symbol.iterator](), ''[Symbol.iterator](), new Map().entries(), new Set().values()]) {
  allow(Object.getPrototypeOf(iterator), 'next');
  const iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(iterator));
  const identity = Object.getOwnPropertyDescriptor(iteratorPrototype, Symbol.iterator)?.value;
  if (typeof identity === 'function') nativeCalls.add(identity);
}
const functionSource = Function.prototype.toString;
const nativeClassification = new WeakMap<Function, boolean>();
const promiseStatics = new Set<Function>([Promise.resolve, Promise.reject, Promise.all,
  Promise.allSettled, Promise.any, Promise.race, Object.getOwnPropertyDescriptor(Promise, 'withResolvers')?.value]);
const errorStack = Object.getOwnPropertyDescriptor(new Error(), 'stack');
if (errorStack?.set) { nativeSetters.add(errorStack.set); nativeCalls.add(errorStack.set); }
// One catalogue seeds both origin checks and shared-state protection. An
// admitted method's owner matters even when no public constructor reaches it.
export const nativeIntrinsicRoots: readonly object[] = Object.freeze([...nativeRoots, ...nativeCalls]);
for (const value of nativeIntrinsicRoots) recordHostGraph(value);

function isNative(fn: Function): boolean {
  if (hostFunctions.has(fn)) return true;
  let native = nativeClassification.get(fn);
  if (native === undefined) {
    // Match the complete native-function form. A body-ending line comment
    // can contain the same suffix without making an authored function native.
    native = /^function\b[^()]*\([^()]*\)\s*\{\s*\[native code\]\s*\}$/.test(Reflect.apply(functionSource, fn, []));
    nativeClassification.set(fn, native);
  }
  return native;
}

export function checkAccessor(fn: unknown, kind: 'get' | 'set'): void {
  if (fn === undefined) return;
  if (typeof fn !== 'function') throw new TypeError('Accessor is not callable');
  if (isNative(fn) && !(kind === 'get' ? nativeGetters : nativeSetters).has(fn)) {
    throw new TypeError('Unsupported native function used as an accessor');
  }
}

export function supportedAccessor(fn: Function, kind: 'get' | 'set'): boolean {
  return !isNative(fn) || (kind === 'get' ? nativeGetters : nativeSetters).has(fn);
}

/** Classification is not permission: only a verified callback ingress may
 * register this candidate. Known host entries retain their whitelist checks. */
export function isUncataloguedNative(fn: Function): boolean {
  if (hostFunctions.has(fn)) { checkNativeEntry(fn); return false; }
  return isNative(fn);
}

export function checkNativeEntry(fn: Function): void {
  if (isNative(fn) && !nativeCalls.has(fn)) throw new TypeError('Unsupported native operation: entry point is not whitelisted');
}

type PropertyInspection = {
  getOwnPropertyDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined;
  getPrototypeOf(value: object): object | null;
};
function dataProperty(value: object, key: PropertyKey, tick: () => void, inspection: PropertyInspection = Object): unknown {
  let links = 0;
  for (let cursor: object | null = value; cursor !== null;) {
    const descriptor = inspection.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!('value' in descriptor)) throw new TypeError('Unsupported native operation: custom constructor accessor');
      return descriptor.value;
    }
    cursor = inspection.getPrototypeOf(cursor);
    if (cursor !== null && ++links % 16 === 0) tick();
  }
  return undefined;
}

/** ArraySpeciesCreate is checked only at its actual allocation point. This
 * profile admits the default constructor and rejects accessor/custom species
 * before V8 could construct a result outside guarded writes. */
export function checkArraySpecies(value: object, tick: () => void, inspection: PropertyInspection = Object): unknown {
  if (!Array.isArray(value)) return undefined;
  const constructor = dataProperty(value, 'constructor', tick, inspection);
  if (constructor !== undefined && constructor !== Array) {
    throw new TypeError('Unsupported native operation: custom array species');
  }
  return constructor;
}

/** These V8 algorithms invoke exec/species themselves. The admitted profile
 * uses canonical regex execution and primitive control fields, so no author
 * code can change those fields between this check and the native use. */
const regexpIntrinsicGlobal = Object.getOwnPropertyDescriptor(RegExp.prototype, 'global')!.get!;
export function checkRegExpProtocol(value: object, protocol: 'match' | 'replace' | 'search' | 'split', tick: () => void, inspection: PropertyInspection = Object): void {
  if (dataProperty(value, 'exec', tick, inspection) !== RegExp.prototype.exec) throw new TypeError('Unsupported RegExp protocol: custom exec');
  let global = false;
  for (const key of ['global', 'lastIndex', 'unicode', 'unicodeSets', 'flags', 'hasIndices', 'ignoreCase', 'multiline', 'dotAll', 'sticky']) {
    // Search replaces lastIndex temporarily, split runs a fresh matcher, and
    // global match/replace reset it to zero. Only the remaining paths can
    // convert the original field inside V8.
    if (key === 'lastIndex' && (protocol === 'search' || protocol === 'split' || global)) continue;
    let links = 0;
    for (let cursor: object | null = value; cursor !== null;) {
      const descriptor = inspection.getOwnPropertyDescriptor(cursor, key);
      if (descriptor) {
        if ('value' in descriptor) {
          const field = descriptor.value;
          if (field !== null && (typeof field === 'object' || typeof field === 'function')) throw new TypeError('Unsupported RegExp protocol: object control field');
          if (key === 'global') global = Boolean(field);
        } else if (descriptor.get !== Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get) {
          throw new TypeError('Unsupported RegExp protocol: control accessor');
        } else if (key === 'global') {
          global = Boolean(Reflect.apply(descriptor.get!, value, []));
        }
        break;
      }
      cursor = inspection.getPrototypeOf(cursor);
      if (cursor !== null && ++links % 16 === 0) tick();
    }
    // The public flag controls repetition; the internal flag controls whether
    // exec advances lastIndex. Only public=true/internal=false can repeat the
    // same successful match forever. The opposite mismatch executes once.
    if (key === 'global' && global && (protocol === 'match' || protocol === 'replace')
      && !Reflect.apply(regexpIntrinsicGlobal, value, [])) {
      throw new TypeError('Unsupported RegExp protocol: conflicting global flag');
    }
  }
  if (protocol === 'split') {
    const constructor = dataProperty(value, 'constructor', tick, inspection);
    if (constructor !== undefined && constructor !== RegExp) throw new TypeError('Unsupported RegExp protocol: custom species');
  }
}

export function checkNativeOperation(fn: Function, receiver: unknown, tick: () => void): void {
  checkNativeEntry(fn);
  if (promiseStatics.has(fn) && receiver !== Promise) throw new TypeError('Unsupported Promise constructor');
  if (fn === Promise.prototype.then || fn === Promise.prototype.finally) {
    // Then performs its native Promise brand check before SpeciesConstructor.
    // An incompatible receiver cannot expose constructor to this operation.
    if (fn === Promise.prototype.then && !types.isPromise(receiver)) return;
    const constructor = receiver !== null && (typeof receiver === 'object' || typeof receiver === 'function')
      ? dataProperty(receiver, 'constructor', tick) : undefined;
    if (constructor !== undefined && constructor !== Promise) throw new TypeError('Unsupported Promise species');
  }
  // These constructors are generic in JS; this profile admits the canonical
  // Array receiver. Custom constructor results have no isolation guarantee.
  if ((fn === Array.from || fn === Array.of) && receiver !== Array) {
    throw new TypeError('Unsupported native operation: custom array constructor');
  }
}

export function checkNativeConstruction(fn: Function, newTarget: Function, args: unknown[], tick: () => void): void {
  if (fn === Promise && newTarget !== Promise) throw new TypeError('Unsupported Promise constructor');
  if (fn === ArrayBuffer && args[1] !== null && (typeof args[1] === 'object' || typeof args[1] === 'function')
    && dataProperty(args[1], 'maxByteLength', tick) !== undefined) {
    throw new TypeError('Unsupported resizable ArrayBuffer');
  }
}
