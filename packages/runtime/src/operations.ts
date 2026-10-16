/** Operations emitted by the compiler. The program still uses ordinary JS
 * objects; only access to shared intrinsics and ambient capabilities is guarded.
 * No package or game identity participates in this policy. */
import { isUncataloguedNative, checkAccessor, checkArraySpecies, checkNativeConstruction, checkNativeEntry, checkNativeOperation, checkRegExpProtocol, supportedAccessor, nativeIntrinsicRoots } from './native-policy.ts';
import { createNamespaceRegistry } from './module-namespace.ts';
import { types } from 'node:util';
import { parse, stringify } from './json.ts';
import { globalBindings, type GlobalReference } from './global-bindings.ts';
type Reference = { object: any; key: any; captured?: true };
type LexicalBinding = { initialized: boolean; mutable: boolean; value: unknown };
type Binding = { fun: Function; self: unknown; args: unknown[] };
type MemoryElementKind = 'Int8' | 'Uint8' | 'Int16' | 'Uint16' | 'Int32' | 'Uint32' | 'Float32' | 'Float64' | 'BigInt64' | 'BigUint64';
export type MemoryStorage = {
  has(value: object): boolean;
  isBuffer(value: object): boolean;
  isView(value: object): boolean;
  adoptBuffer(value: ArrayBuffer): ArrayBuffer;
  adoptView(value: ArrayBufferView): ArrayBufferView;
  bufferLength(value: object): number;
  view(value: object): {buffer: ArrayBuffer; kind: MemoryElementKind | 'Uint8Clamped' | 'DataView'; byteOffset: number; byteLength: number; length: number};
  readElement(value: object, index: number): number | bigint | undefined;
  writeElement(value: object, index: number, item: any): void;
  readData(value: object, kind: MemoryElementKind, offset: number, little?: boolean): number | bigint;
  writeData(value: object, kind: MemoryElementKind, offset: number, item: any, little?: boolean): void;
  fork(): MemoryStorage;
  copyBytes(buffer: object, offset: number, source: object, sourceOffset: number, length: number): void;
  writeBytes(buffer: object, offset: number, source: Uint8Array): void;
  readBytes(buffer: object, offset: number, target: Uint8Array): void;
};
/** Internal storage adapter; absent for the native backend. It operates on
 * stable identities, and must never expose branch backing objects to authors. */
export type PropertyReadCache = {
  slots: number[];
  immutablePrototype?: (value: object) => boolean;
  missing?: WeakMap<object, {key: PropertyKey; version: number; epoch: number; prototype: WeakRef<object> | null}>;
};
export type ObjectStorage = {
  has(object: object): boolean;
  get(object: object, key: PropertyKey, receiver: unknown, invoke: (fn: Function, receiver: unknown, args: unknown[]) => unknown, cache?: PropertyReadCache): unknown;
  set(object: object, key: PropertyKey, value: unknown, receiver: unknown, invoke: (fn: Function, receiver: unknown, args: unknown[]) => unknown, number?: (value: any) => number): boolean;
  hasProperty(object: object, key: PropertyKey): boolean;
  deleteProperty(object: object, key: PropertyKey): boolean;
  defineProperty(object: object, key: PropertyKey, descriptor: PropertyDescriptor, number?: (value: any) => number): boolean;
  getOwnPropertyDescriptor(object: object, key: PropertyKey): PropertyDescriptor | undefined;
  ownKeys(object: object): (string | symbol)[];
  getPrototypeOf(object: object): object | null;
  setPrototypeOf(object: object, prototype: object | null): boolean;
  isExtensible(object: object): boolean;
  preventExtensions(object: object): boolean;
};
export type OperationHooks = {
  objects?: () => ObjectStorage | undefined;
  memory?: () => MemoryStorage | undefined;
  global?: () => object;
  tick?: () => void;
  violation?: () => never;
  namespace?: (bindings: Readonly<Record<string, () => unknown>>) => object;
  apply?: (fn: Function, self: unknown, args: unknown[]) => unknown;
  construct?: (fn: Function, args: unknown[], newTarget: Function) => unknown;
  value?: (value: unknown) => void;
  allocate?: (value: object) => void;
  record?: <T extends object>(kind: 'LexicalBinding' | 'IteratorRecord', fields: T) => T;
  bind?: (fn: Function, self: unknown, args: unknown[]) => Function;
  binding?: (fn: Function) => Binding | undefined;
  compiled?: (fn: Function) => boolean;
  iteratorResult?: (next: Function, receiver: object) => {done: boolean; value: unknown} | undefined;
  functionSource?: (fn: Function) => string | undefined;
  regexpStringIterator?: (matcher: object, text: string, global: boolean, fullUnicode: boolean) => object;
};

const apply = Reflect.apply, construct = Reflect.construct;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectIsExtensible = Object.isExtensible;
const objectValueOf = Object.prototype.valueOf;
const bigintToString = BigInt.prototype.toString;
const bigIntChargeFloor = 1n << 8192n;
const lookupGetter = Object.getOwnPropertyDescriptor(Object.prototype, '__lookupGetter__')!.value as Function;
const lookupSetter = Object.getOwnPropertyDescriptor(Object.prototype, '__lookupSetter__')!.value as Function;
const legacyPrototype = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__')!;
/** The generic ToObject group uses V8's own nullish conversion failure. */
function toObject(value: any): object {
  if (value === null || value === undefined) apply(objectValueOf, value, []);
  return Object(value);
}
const generatorFunctionPrototype = Object.getPrototypeOf(function*() {});
const asyncGeneratorFunctionPrototype = Object.getPrototypeOf(async function*() {});
const asyncFunctionPrototype = Object.getPrototypeOf(async function() {});
const dynamicCodeConstructors = [Function, asyncFunctionPrototype.constructor,
  generatorFunctionPrototype.constructor, asyncGeneratorFunctionPrototype.constructor];
const regexpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!;
const regexpFlags = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')!.get!;
const regexpFlagGetters = (['hasIndices','global','ignoreCase','multiline','dotAll','unicode','unicodeSets','sticky'] as const)
  .map((key, index) => [Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get, 'dgimsuvy'[index]!] as const);

const coercionArgumentPositions = new Map<Function, readonly number[]>([
  [String, [0]], [Error, [0]], [TypeError, [0]], [RangeError, [0]], [SyntaxError, [0]],
  [ReferenceError, [0]], [EvalError, [0]], [URIError, [0]], [AggregateError, [1]], ...(typeof SuppressedError==='function'?[[SuppressedError, [2]] as const]:[]),
  [Number, [0]], [BigInt, [0]], [Symbol, [0]], [Symbol.for, [0]],
  [BigInt.asIntN, [0, 1]], [BigInt.asUintN, [0, 1]],
  [Number.prototype.toExponential, [0]], [Number.prototype.toFixed, [0]],
  [Number.prototype.toPrecision, [0]], [Number.prototype.toString, [0]], [BigInt.prototype.toString, [0]],
  [Number.parseFloat, [0]], [Number.parseInt, [0, 1]],
  [RegExp.prototype.exec, [0]],
  [ArrayBuffer, [0]], [ArrayBuffer.prototype.slice, [0, 1]],
  [Array.prototype.at, [0]], [Array.prototype.copyWithin, [0, 1, 2]],
  [Array.prototype.fill, [1, 2]], [Array.prototype.includes, [1]],
  [Array.prototype.indexOf, [1]], [Array.prototype.lastIndexOf, [1]],
  [Array.prototype.toSpliced, [0, 1]], [Array.prototype.with, [0]],
  [Object.getOwnPropertyDescriptor, [1]], [Reflect.getOwnPropertyDescriptor, [1]],
  [Object.hasOwn, [1]], [Reflect.has, [1]], [Reflect.deleteProperty, [1]],
  [Object.prototype.hasOwnProperty, [0]], [Object.prototype.propertyIsEnumerable, [0]],
  [(Object.prototype as any).__lookupGetter__, [0]], [(Object.prototype as any).__lookupSetter__, [0]],
]);
const errorOptionsPosition = new Map<Function, number>([
  ...[Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError]
    .map(constructor => [constructor, 1] as [Function, number]),
  [AggregateError, 2],
]);
// These intrinsics retain a string description/message but return a Symbol or
// Error object, so charging only their return value cannot see the text work.
const retainedTextPosition = new Map<Function, number>([
  [Symbol, 0], [Symbol.for, 0],
  ...[Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError]
    .map(constructor => [constructor, 0] as [Function, number]),
  [AggregateError, 1],
  ...(typeof SuppressedError === 'function' ? [[SuppressedError, 2] as [Function, number]] : []),
]);
// Every observed argument of these intrinsics is conversion-only. Leave the
// number/order of conversions to V8 (including ignored extra arguments).
const variadicCoercions = new Set<Function>([
  Math.abs, Math.acos, Math.acosh, Math.asin, Math.asinh, Math.atan, Math.atanh,
  Math.atan2, Math.cbrt, Math.ceil, Math.clz32, Math.cos, Math.cosh, Math.exp,
  Math.expm1, Math.floor, Math.fround, Math.hypot, Math.imul, Math.log, Math.log1p,
  Math.log2, Math.log10, Math.max, Math.min, Math.pow, Math.round, Math.sign,
  Math.sin, Math.sinh, Math.sqrt, Math.tan, Math.tanh, Math.trunc,
  String.fromCharCode, String.fromCodePoint,
]);
const numericTextArgumentPositions = new Map<Function, readonly number[]>([
  [Number, [0]], [BigInt, [0]], [Number.parseFloat, [0]], [Number.parseInt, [0, 1]],
  [BigInt.asIntN, [0, 1]], [BigInt.asUintN, [0, 1]],
  [Number.prototype.toExponential, [0]], [Number.prototype.toFixed, [0]],
  [Number.prototype.toPrecision, [0]], [Number.prototype.toString, [0]],
  [BigInt.prototype.toString, [0]],
  [ArrayBuffer, [0]], [ArrayBuffer.prototype.slice, [0, 1]],
  [Array.prototype.at, [0]], [Array.prototype.copyWithin, [0, 1, 2]],
  [Array.prototype.fill, [1, 2]], [Array.prototype.includes, [1]],
  [Array.prototype.indexOf, [1]], [Array.prototype.lastIndexOf, [1]],
  [Array.prototype.toSpliced, [0, 1]], [Array.prototype.with, [0]],
]);
const primitiveKeyConsumers = new Map<Function, readonly number[]>([
  [Object.is, [0, 1]],
  [Array.prototype.includes, [0]], [Array.prototype.indexOf, [0]], [Array.prototype.lastIndexOf, [0]],
  [Map.prototype.get, [0]], [Map.prototype.has, [0]], [Map.prototype.set, [0]], [Map.prototype.delete, [0]],
  [Set.prototype.add, [0]], [Set.prototype.has, [0]], [Set.prototype.delete, [0]],
  [BigInt.asIntN, [1]], [BigInt.asUintN, [1]],
]);
// These generic String methods first coerce their receiver, then use only
// primitive conversion at the listed argument positions. Search predicates
// additionally run IsRegExp on argument zero before converting it to a string.
const stringCoercions = new Map<Function, readonly number[]>([
  ...['at','charAt','charCodeAt','codePointAt','repeat','normalize'].map(key => [(String.prototype as any)[key], [0]] as const),
  ...['indexOf','lastIndexOf','slice','substring','padStart','padEnd','startsWith','endsWith','includes'].map(key => [(String.prototype as any)[key], [0,1]] as const),
  ...['isWellFormed','toWellFormed','toLowerCase','toUpperCase','trim','trimEnd','trimStart'].map(key => [(String.prototype as any)[key], []] as const),
]);
const stringSearchPredicates = new Set<Function>([String.prototype.startsWith,String.prototype.endsWith,String.prototype.includes]);
const stringScanOperations = new Set<Function>([
  String.prototype.includes, String.prototype.indexOf, String.prototype.lastIndexOf,
  String.prototype.startsWith, String.prototype.endsWith, (String.prototype as any).isWellFormed,
  String.prototype.trim, String.prototype.trimStart, String.prototype.trimEnd,
  String.prototype.split, String.prototype.replace, String.prototype.replaceAll,
]);
const promiseWithResolvers = Object.getOwnPropertyDescriptor(Promise, 'withResolvers')?.value;
// The proxy only probes [[Construct]]; its trap never calls the target or
// reads target.prototype. It is ephemeral host machinery, not instance state.
const constructorProbe = { construct() { return {}; } };
function isConstructor(value: unknown): boolean {
  if (typeof value !== 'function') return false;
  try { construct(new Proxy(value, constructorProbe), []); return true; }
  catch { return false; }
}
const stringProtocols = new Map<Function, symbol>([
  [String.prototype.replace, Symbol.replace], [String.prototype.replaceAll, Symbol.replace],
  [String.prototype.search, Symbol.search], [String.prototype.split, Symbol.split],
  [String.prototype.match, Symbol.match],
  [String.prototype.matchAll, Symbol.matchAll],
]);
const regexpProtocols = new Map<Function, 'match' | 'replace' | 'search' | 'split'>([
  [RegExp.prototype[Symbol.match], 'match'], [RegExp.prototype[Symbol.replace], 'replace'],
  [RegExp.prototype[Symbol.search], 'search'], [RegExp.prototype[Symbol.split], 'split'],
]);
const typedArrayConstructor = Object.getPrototypeOf(Uint8Array);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const collectionSizeGetters = new Set([Map, Set].map(type => Object.getOwnPropertyDescriptor(type.prototype, 'size')!.get!));
const bufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const typedSlots = Object.fromEntries(['buffer', 'byteOffset', 'length'].map(key =>
  [key, Object.getOwnPropertyDescriptor(typedArrayPrototype, key)!.get!]));
const typedByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const dataViewBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, 'buffer')!.get!;
const memoryAccessors = new Map<Function, {family: 'typed' | 'data' | 'buffer'; field: string}>();
for (const [prototype, family, fields] of [
  [typedArrayPrototype, 'typed', ['buffer', 'byteOffset', 'byteLength', 'length']],
  [DataView.prototype, 'data', ['buffer', 'byteOffset', 'byteLength']],
  [ArrayBuffer.prototype, 'buffer', ['byteLength']],
] as const) for (const field of fields) memoryAccessors.set(Object.getOwnPropertyDescriptor(prototype, field)!.get!, {family, field});
const dataViewOperations = new Map<Function, {kind: MemoryElementKind; write: boolean}>();
const typedReadOperations = new Map<Function, {array: Function; callback: boolean}>();
for (const name of ['every', 'some', 'find', 'findIndex', 'findLast', 'findLastIndex', 'forEach', 'reduce', 'reduceRight', 'includes', 'indexOf', 'lastIndexOf', 'at', 'join']) {
  typedReadOperations.set(typedArrayPrototype[name], {array: (Array.prototype as any)[name],
    callback: !['includes', 'indexOf', 'lastIndexOf', 'at', 'join'].includes(name)});
}
for (const kind of ['Int8', 'Uint8', 'Int16', 'Uint16', 'Int32', 'Uint32', 'Float32', 'Float64', 'BigInt64', 'BigUint64'] as const) {
  for (const prefix of ['get', 'set']) dataViewOperations.set((DataView.prototype as any)[prefix + kind], {kind, write: prefix === 'set'});
}
const typedName = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const typedSpeciesMethods = new Set<Function>(['map', 'filter', 'slice', 'subarray'].map(key => typedArrayPrototype[key]));
const typedCopyingMethods = new Set<Function>(['toReversed', 'toSorted', 'with'].map(key => typedArrayPrototype[key]));
const typedBulkOperations = new Set<Function>(['fill', 'copyWithin', 'reverse', 'sort',
  'includes', 'indexOf', 'lastIndexOf'].map(key => typedArrayPrototype[key]));
for (const [name, positions] of [
  ['at', [0]], ['copyWithin', [0, 1, 2]], ['fill', [0, 1, 2]],
  ['includes', [1]], ['indexOf', [1]], ['lastIndexOf', [1]], ['join', [0]],
  ['slice', [0, 1]], ['subarray', [0, 1]], ['with', [0, 1]],
] as const) coercionArgumentPositions.set(typedArrayPrototype[name], positions);
for (const [name, positions] of [
  ['at', [0]], ['copyWithin', [0, 1, 2]], ['fill', [0, 1, 2]],
  ['includes', [1]], ['indexOf', [1]], ['lastIndexOf', [1]], ['slice', [0, 1]],
  ['subarray', [0, 1]], ['with', [0, 1]],
] as const) numericTextArgumentPositions.set(typedArrayPrototype[name], positions);
for (const name of ['getBigInt64', 'getBigUint64', 'getFloat32', 'getFloat64',
  'getInt8', 'getInt16', 'getInt32', 'getUint8', 'getUint16', 'getUint32'] as const) {
  coercionArgumentPositions.set(DataView.prototype[name], [0]);
  numericTextArgumentPositions.set(DataView.prototype[name], [0]);
}
for (const name of ['setBigInt64', 'setBigUint64', 'setFloat32', 'setFloat64',
  'setInt8', 'setInt16', 'setInt32', 'setUint8', 'setUint16', 'setUint32'] as const) {
  coercionArgumentPositions.set(DataView.prototype[name], [0, 1]);
  numericTextArgumentPositions.set(DataView.prototype[name], [0, 1]);
}
// These algorithms consume a callback result only through primitive
// conversion. Other callbacks (predicates, reducers, JSON, ordinary map) keep
// the original result object and must not receive this transient view.
const coercedCallbackResults = new Set<Function>([
  String.prototype.replace, String.prototype.replaceAll, RegExp.prototype[Symbol.replace],
  Array.prototype.sort, Array.prototype.toSorted, typedArrayPrototype.sort,
  typedArrayPrototype.toSorted, typedArrayPrototype.map, typedArrayConstructor.from,
]);
const typedConstructors = new Set<Function>([Uint8Array, Int8Array, Uint8ClampedArray,
  Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
  BigInt64Array, BigUint64Array]);
const indexedArrayOperations = new Set<Function>([
  ...['at','concat','copyWithin','every','fill','filter','find','findIndex','findLast','findLastIndex','flatMap',
    'forEach','includes','indexOf','lastIndexOf','map','pop','push','reduce','reduceRight',
    'reverse','shift','some','sort','toReversed','toSorted','toSpliced','unshift','with']
    .map(key => (Array.prototype as any)[key])
]);
const indexedArraySpeciesOperations = new Set<Function>([
  Array.prototype.map, Array.prototype.filter, Array.prototype.flatMap,
  Array.prototype.concat,
]);
const allocatingArrayOperations = new Set<Function>([
  ...indexedArraySpeciesOperations, Array.of, Array.prototype.toReversed,
  Array.prototype.toSorted, Array.prototype.toSpliced, Array.prototype.with,
]);
const shared = new WeakSet<object>();
const restrictedAccessorKeys = new Set<PropertyKey>();
// V8 puts its debug-stack accessor on each Error instance rather than on a
// shared prototype. Include that own descriptor in the same accessor policy.
const defaultErrorStack = Object.getOwnPropertyDescriptor(new Error(), 'stack');
if (defaultErrorStack?.get && !supportedAccessor(defaultErrorStack.get, 'get')) restrictedAccessorKeys.add('stack');
const forbiddenCalls = new Set<Function>();
const ambientEffectCalls = new Set<Function>([Date, Date.now, Math.random]);
// These canonical functions are observable V8 values even when executing them
// cannot satisfy the controlled Context contract. Calls remain forbidden.
const readableForbiddenCalls = new Set<Function>([...dynamicCodeConstructors, Date, Date.now, Math.random, Proxy,
  ...(typeof URL === 'function' ? [URL] : []), ...(typeof File === 'function' ? [File] : []), Error.captureStackTrace]);
const targetMutators = new Set<Function>([
  Object.assign, Object.defineProperty, Object.defineProperties,
  Object.setPrototypeOf, Object.freeze, Object.seal, Object.preventExtensions,
  Reflect.defineProperty, Reflect.set, Reflect.deleteProperty,
  Reflect.setPrototypeOf, Reflect.preventExtensions,
]);
const receiverMutators = new Set<Function>([
  ...['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift']
    .map(key => (Array.prototype as any)[key]),
  ...['copyWithin', 'fill', 'reverse', 'set', 'sort'].map(key => typedArrayPrototype[key]),
  ...['setBigInt64', 'setBigUint64', 'setFloat32', 'setFloat64', 'setInt8',
    'setInt16', 'setInt32', 'setUint8', 'setUint16', 'setUint32']
    .map(key => (DataView.prototype as any)[key]),
  Map.prototype.set, Map.prototype.delete, Map.prototype.clear,
  Set.prototype.add, Set.prototype.delete, Set.prototype.clear,
  WeakMap.prototype.set, WeakMap.prototype.delete,
  WeakSet.prototype.add, WeakSet.prototype.delete,
  (Object.prototype as any).__defineGetter__, (Object.prototype as any).__defineSetter__,
]);

export function protectIntrinsics(value: unknown): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || shared.has(value)) return;
  shared.add(value);
  protectIntrinsics(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if ('value' in d) protectIntrinsics(d.value);
    else {
      protectIntrinsics(d.get); protectIntrinsics(d.set);
      if (d.set) receiverMutators.add(d.set);
      if (d.get && !supportedAccessor(d.get, 'get') || d.set && !supportedAccessor(d.set, 'set')) restrictedAccessorKeys.add(key);
    }
  }
}
// Traversal happens once for the runtime, never on a fork or program operation.
for (const value of [...nativeIntrinsicRoots, Object, Array, Number, String, Boolean, BigInt, Symbol,
  Math, JSON, Map, Set, WeakMap, WeakSet, Reflect, RegExp, Error, TypeError, AggregateError, ...(typeof SuppressedError==='function'?[SuppressedError]:[]),
  RangeError, SyntaxError, ReferenceError, EvalError, URIError, ...(typeof DOMException === 'function' ? [DOMException] : []), Function,
  Promise, Date, Proxy, ArrayBuffer, DataView, Uint8Array, Int8Array,
  Uint8ClampedArray, Uint16Array, Int16Array, Uint32Array, Int32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array]) protectIntrinsics(value);
for (const value of [...dynamicCodeConstructors,
  eval, Date, Date.now, Math.random, Proxy,
  ...(typeof URL === 'function' ? [URL] : []), ...(typeof File === 'function' ? [File] : []), Error.captureStackTrace]) forbiddenCalls.add(value);

// These intrinsics allocate a fresh identity and do not expose newTarget to
// author code. Native brands remain intact while Context owns the prototype.
const neutralConstruction = new Set<Function>([Object, Array, Number, String, Boolean,
  RegExp, Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError,
  AggregateError, Map, Set, WeakMap, WeakSet, ArrayBuffer, DataView, ...typedConstructors]);

export function createOperations(hooks: OperationHooks = {}) {
  const policyTick = hooks.tick ?? (() => {});
  function allocation<T extends object>(value: T): T { hooks.allocate?.(value); return value; }
  function internalRecord<T extends object>(kind: 'LexicalBinding' | 'IteratorRecord', fields: T): T {
    return hooks.record ? hooks.record(kind, fields) : fields;
  }
  // V8 must observe the branch prototype while allocating `this`, before the
  // constructor body runs. A private bound target has no non-configurable
  // prototype property, so forwarding also works for frozen logical functions.
  const constructionTargets = new WeakMap<Function, Function>();
  function originalNewTarget(value: Function | undefined): Function | undefined {
    return value && (constructionTargets.get(value) ?? value);
  }
  function constructionTarget(value: Function): Function {
    if (!objectStorage(value)) return value;
    const target = new Proxy((function() {}).bind(undefined), {
      get(_target, key) { return get(ref(value, key)); }
    });
    constructionTargets.set(target, value);
    return target;
  }
  function installConstructedPrototype(result: any, prototype: object | null): any {
    if (!objectStorage(result)) allocation(result);
    objectStorage(result)!.setPrototypeOf(result, prototype);
    return result;
  }
  function objectStorage(value: unknown): ObjectStorage | undefined {
    if (!hooks.objects || value === null || typeof value !== 'object' && typeof value !== 'function') return undefined;
    const storage = hooks.objects();
    return storage?.has(value) ? storage : undefined;
  }
  function memoryStorage(value: unknown): MemoryStorage | undefined {
    if (!hooks.memory || value === null || typeof value !== 'object') return undefined;
    const storage = hooks.memory();
    return storage?.has(value) ? storage : undefined;
  }
  function memoryIndex(value: object, key: PropertyKey): {storage: MemoryStorage; index: number} | undefined {
    if (typeof key !== 'string') return undefined;
    const storage = memoryStorage(value);
    if (!storage?.isView(value) || storage.view(value).kind === 'DataView') return undefined;
    const index = key === '-0' ? -0 : Number(key);
    return key === '-0' || String(index) === key ? {storage, index} : undefined;
  }
  function ownKeys(value: any): (string | symbol)[] {
    const keys = objectStorage(value)?.ownKeys(value) ?? Reflect.ownKeys(value);
    const memory = memoryStorage(value);
    if (!memory?.isView(value) || memory.view(value).kind === 'DataView') return keys;
    const length = memory.view(value).length;
    return [...Array.from({length}, (_, index) => String(index)), ...keys.filter(key => !memoryIndex(value, key))];
  }
  function ownDescriptor(value: any, key: PropertyKey): PropertyDescriptor | undefined {
    const indexed = memoryIndex(value, key);
    if (indexed) {
      const item = indexed.storage.readElement(value, indexed.index);
      return item === undefined ? undefined : {value: item, writable: true, enumerable: true, configurable: true};
    }
    const storage = objectStorage(value);
    return storage ? storage.getOwnPropertyDescriptor(value, key) : Object.getOwnPropertyDescriptor(value, key);
  }
  function prototypeOf(value: any): object | null {
    const storage = objectStorage(value);
    return storage ? storage.getPrototypeOf(value) : Object.getPrototypeOf(value);
  }
  function hasOwn(value: any, key: PropertyKey): boolean { return ownDescriptor(value, key) !== undefined; }
  function forInKeys(value: any): string[] {
    const result: string[] = [], seen = new Set<string>();
    for (let object = value == null ? null : Object(value); object !== null; object = prototypeOf(object)) {
      hooks.tick?.();
      for (const key of ownKeys(object)) {
        hooks.tick?.();
        if (typeof key !== 'string' || seen.has(key)) continue;
        const descriptor = ownDescriptor(object, key);
        if (!descriptor) continue;
        seen.add(key);
        if (descriptor.enumerable) result.push(key);
      }
    }
    return result;
  }
  function enumerableKeys(value: object): string[] {
    const result: string[] = [];
    for (const key of ownKeys(value)) {
      hooks.tick?.();
      if (typeof key === 'string' && ownDescriptor(value, key)?.enumerable) result.push(key);
    }
    return result;
  }
  function extensible(value: any): boolean { return objectStorage(value)?.isExtensible(value) ?? Object.isExtensible(value); }
  function defineStored(value: object, key: PropertyKey, descriptor: PropertyDescriptor): boolean {
    const indexed = memoryIndex(value, key);
    if (indexed) {
      if (indexed.storage.readElement(value, indexed.index) === undefined
        || 'get' in descriptor || 'set' in descriptor || descriptor.configurable === false
        || descriptor.enumerable === false || descriptor.writable === false) return false;
      if ('value' in descriptor) {
        const item = toPrimitive(descriptor.value, 'number'); chargeNumericText(item);
        indexed.storage.writeElement(value, indexed.index, item);
      }
      return true;
    }
    const storage = objectStorage(value);
    return storage ? storage.defineProperty(value, key, descriptor, item => numericUnary('+', item)) : Reflect.defineProperty(value, key, descriptor);
  }
  function defineOwn<T>(value: T, key: PropertyKey, descriptor: PropertyDescriptor): T {
    if (!objectStorage(value) && !memoryStorage(value)) return Object.defineProperty(value, key, descriptor);
    if (!defineStored(value as object, propertyKey(key), descriptor)) throw new TypeError('Cannot redefine property');
    return value;
  }
  function setPrototype<T>(value: T, prototype: object | null): T {
    const storage = objectStorage(value);
    if (!storage) return Object.setPrototypeOf(value, prototype);
    if (!storage.setPrototypeOf(value as object, prototype)) throw new TypeError('Cannot set prototype');
    return value;
  }
  // V8's own debug stack getter is not admitted. Explicit writes retain their
  // local value without reading that getter. Controlled execution replaces it
  // with a Context-owned accessor, so this map is used only by native execution.
  const writtenDebugStacks = new WeakMap<object, unknown>();
  const defaultDebugStack = (object: unknown, key: PropertyKey): object | undefined => {
    if (key !== 'stack' || object === null || typeof object !== 'object') return undefined;
    const descriptor = ownDescriptor(object, key);
    return descriptor?.get === defaultErrorStack?.get && descriptor?.set === defaultErrorStack?.set ? object : undefined;
  };
  function forbidExecution(fn: Function): never {
    if (ambientEffectCalls.has(fn) && hooks.violation) return hooks.violation();
    throw new TypeError('Ambient or dynamic execution is not admitted');
  }
  function instanceGlobal():object {
    if(!hooks.global)throw new TypeError('Missing instance global environment');
    return hooks.global();
  }
  const globalEnvironment = globalBindings(
    () => { const object = instanceGlobal(); writable(object); return object; },
    (object, name) => get(ref(object, name)),
    (object, name, value) => set(ref(object, name), value, true),
    (object, name) => has(name, object),
  );
  function globalReferenceRead(this: { reference: GlobalReference }): unknown { return globalEnvironment.get(this.reference); }
  function globalReferenceWrite(this: { reference: GlobalReference }, value: unknown): void { globalEnvironment.set(this.reference,value); }
  function globalTarget(reference: GlobalReference): object {
    return defineOwn({ reference },'value',{get:globalReferenceRead,set:globalReferenceWrite});
  }
  const bindings = new WeakMap<Function, Binding>();
  const sources = new WeakMap<Function, { source: string; start: number; end: number }>();
  function rememberSource(fn: Function, source: string, start: number, end: number, wrapperKind?: 'sync' | 'async' | 'async-function'): Function {
    if (wrapperKind) {
      const implementation = fn;
      const functionPrototype = wrapperKind === 'async-function' ? asyncFunctionPrototype
        : wrapperKind === 'sync' ? generatorFunctionPrototype : asyncGeneratorFunctionPrototype;
      const iteratorPrototype = functionPrototype.prototype;
      const callable = { invoke(this: unknown, ...args: unknown[]) {
        // Keep eager parameter execution. An async facade returns the existing
        // promise directly, without adding an adoption job; a generator facade
        // must not defer default/destructuring side effects until next().
        const result = apply(implementation, this, args);
        if (wrapperKind === 'async-function') return result;
        const prototype = (callable as any).prototype;
        setPrototype(result, prototype !== null && (typeof prototype === 'object' || typeof prototype === 'function') ? prototype : iteratorPrototype);
        return result;
      } }.invoke;
      setPrototype(callable, functionPrototype);
      Object.defineProperties(callable, {
        name: { value: fn.name, configurable: true }, length: { value: fn.length, configurable: true },
        ...(wrapperKind === 'async-function' ? {} : { prototype: { value: Object.create(iteratorPrototype), writable: true } })
      });
      fn = callable;
    }
    sources.set(fn, { source, start, end });
    return fn;
  }
  function rememberObjectSources(object: object, source: string, entries: [PropertyKey, 'method' | 'get' | 'set', number, number, ('sync' | 'async' | 'async-function')?][]): object {
    for (const [key, kind, start, end, wrapperKind] of entries) {
      const descriptor = ownDescriptor(object, key)!;
      const field = kind === 'method' ? 'value' : kind;
      const fn = rememberSource(descriptor[field]!, source, start, end, wrapperKind);
      if (fn !== descriptor[field]) defineOwn(object, key, { ...descriptor, [field]: fn });
    }
    return object;
  }
  // Only functions received at explicitly adapted native callback boundaries
  // acquire this provenance. It is local, not a global native exemption.
  const nativeCallbacks = new WeakSet<Function>();
  // Compiler-inserted function entries consume this synchronous call marker.
  // Explicit source calls validate every argument before entering; they cannot
  // manufacture callback provenance. The other ingress is V8 calling back into
  // the closed program (or a runtime-owned bound forwarder). Host-facing setup,
  // IO and results are copied data, and authors cannot name __bearOps.
  // Only direct function arguments are registered; nested object contents still
  // go through ordinary guarded reads. No function is wrapped or renamed.
  let checkedEntry = false;
  function nativeEntry(args: ArrayLike<unknown>): void {
    const checked = checkedEntry;
    checkedEntry = false;
    for (let index = 0; index < args.length; index++) {
      const value = args[index];
      if (!checked && typeof value === 'function' && !binding(value) && !nativeCallbacks.has(value)) {
        if (forbiddenCalls.has(value)) forbidExecution(value);
        if (isUncataloguedNative(value)) nativeCallbacks.add(value);
      }
      admittedValue(value);
    }
  }
  function applyFunction(fn: Function, self: unknown, args: any[]): any {
    if (!sources.has(fn)) return hooks.apply ? hooks.apply(fn, self, args) : apply(fn, self, args);
    const previous = checkedEntry;
    checkedEntry = true;
    try { return hooks.apply ? hooks.apply(fn, self, args) : apply(fn, self, args); }
    finally { checkedEntry = previous; }
  }
  function constructFunction(fn: Function, args: any[], newTarget: Function): any {
    if (!sources.has(fn)) return hooks.construct ? hooks.construct(fn, args, newTarget) : construct(fn, args, newTarget);
    const previous = checkedEntry;
    checkedEntry = true;
    try { return hooks.construct ? hooks.construct(fn, args, newTarget) : construct(fn, args, newTarget); }
    finally { checkedEntry = previous; }
  }

  const activeJoins = new Set<object>();
  function chargeByteWork(length: number): void {
    for (let remaining = length; remaining > 0; remaining -= 1024) hooks.tick?.();
  }
  function chargeAllocatedBytes(length: number): void {
    for (let remaining = length; remaining >= 1024; remaining -= 1024) hooks.tick?.();
  }
  function chargeTextWork(length: number): void {
    for (let remaining = length; remaining >= 1024; remaining -= 1024) hooks.tick?.();
  }
  function chargeNumericText(value: unknown): void {
    if (typeof value === 'string') chargeTextWork(value.length);
  }
  function chargeRetainedText(fn: Function, args: readonly unknown[]): void {
    const index = retainedTextPosition.get(fn);
    if (index !== undefined) chargeNumericText(args[index]);
  }
  function chargeBigIntWork(value: unknown): void {
    if (typeof value !== 'bigint' || !hooks.tick || value > -bigIntChargeFloor && value < bigIntChargeFloor) return;
    // V8 exposes no constant-time BigInt byte length. Hex conversion reads
    // the value without author hooks; 2048 digits represent 1024 bytes.
    const hex = apply(bigintToString, value, [16]);
    for (let remaining = hex.length - (hex[0] === '-' ? 1 : 0); remaining >= 2048; remaining -= 2048) hooks.tick();
  }
  function chargeMaterialized(value: any): any {
    if (typeof value === 'string') chargeTextWork(value.length);
    else chargeBigIntWork(value);
    return value;
  }
  function comparisonValue(value: any): any { return chargeMaterialized(value); }
  function rememberPromiseCallbacks(resolve: Function, reject: Function): void {
    nativeCallbacks.add(resolve); nativeCallbacks.add(reject);
  }
  // Used only where a known Promise intrinsic performs Invoke(receiver, "then").
  // Some callers supply generated callbacks; neither view nor bridge escapes.
  function nativeThenReceiver(receiver: object, generated: boolean): object {
    return new Proxy(Object.create(null), {
      get(_target, key) {
        const value = get(ref(receiver, key));
        if (key !== 'then' || typeof value !== 'function') return value;
        return function(fulfilled: Function, rejected: Function) {
          if (generated) rememberPromiseCallbacks(fulfilled, rejected);
          hooks.tick?.();
          return invoke(value, receiver, [fulfilled, rejected]);
        };
      }
    });
  }
  const callbacks = new Map<Function, number>([
    ...['every','filter','find','findIndex','findLast','findLastIndex','flatMap','forEach','map','reduce','reduceRight','some','sort','toSorted']
      .map(key => [(Array.prototype as any)[key], 0] as [Function, number]),
    ...['every','filter','find','findIndex','findLast','findLastIndex','forEach','map','reduce','reduceRight','some','sort','toSorted']
      .map(key => [typedArrayPrototype[key], 0] as [Function, number]),
    [typedArrayConstructor.from, 1],
    [Map.prototype.forEach, 0], [Set.prototype.forEach, 0],
    [String.prototype.replace, 1], [String.prototype.replaceAll, 1],
    [RegExp.prototype[Symbol.replace], 1],
  ]);
  function writable(value: unknown): void {
    if (types.isArrayBufferView(value)) {
      const memory = memoryStorage(value);
      writable(memory ? memory.view(value).buffer : apply(types.isDataView(value) ? dataViewBuffer : typedSlots.buffer!, value, []));
    }
    if (value !== null && (typeof value === 'object' || typeof value === 'function') && shared.has(value)) {
      throw new TypeError('Cannot mutate a shared intrinsic');
    }
  }
  function guardedArrayConstructor(value: object): unknown {
    return checkArraySpecies(value, policyTick, {getOwnPropertyDescriptor:ownDescriptor,getPrototypeOf:prototypeOf});
  }
  function binding(fn: Function): Binding | undefined { return hooks.binding?.(fn) ?? bindings.get(fn); }
  function admittedValue(value: any): any {
    if (typeof value === 'function' && forbiddenCalls.has(value) && !readableForbiddenCalls.has(value)) throw new TypeError('Ambient or dynamic execution is not admitted');
    // The native backend's guarded bind wrapper has native Function#toString
    // output. Its private binding record proves that calls re-enter invoke;
    // this is not permission to admit arbitrary native bound functions.
    if (typeof value === 'function' && !readableForbiddenCalls.has(value) && !binding(value) && !nativeCallbacks.has(value)) checkNativeEntry(value);
    if (value === null || typeof value !== 'object' && typeof value !== 'function' || !shared.has(value)) hooks.value?.(value);
    return value;
  }
  function invoke(fn: any, self: any, args: any[]): any {
    const result = invokeCore(fn, self, args);
    // A native operation may materialize a large primitive without entering
    // a compiled loop. Charge its resulting storage at the common call edge.
    return chargeMaterialized(result);
  }
  function invokeCore(fn: any, self: any, args: any[]): any {
    if (typeof fn !== 'function') throw new TypeError('Value is not callable');
    if (forbiddenCalls.has(fn)) forbidExecution(fn);
    // Spread argument lists can be retained across IO. Materialize only the
    // completed current list at the call edge, never a fork's entire heap.
    if (objectStorage(args)) args = arrayLike(args);
    // These exact intrinsic identities ignore their receiver and only convert
    // arguments. Primitive inputs cannot invoke author code or carry Context
    // references, so the native result needs no guarded callback/slot path.
    // Objects retain the regular conversion and admission machinery.
    if (variadicCoercions.has(fn) && args.every(value => value === null
      || typeof value !== 'object' && typeof value !== 'function')) {
      for (const value of args) { admittedValue(value); chargeNumericText(value); }
      return admittedValue(applyFunction(fn, self, args));
    }
    for (const value of args) admittedValue(value);
    let scannedTextLength = 0;
    const bound = binding(fn);
    if (bound) return invoke(bound.fun, bound.self, [...bound.args, ...args]);
    // Only the controlled backend's exact closure registry can establish this
    // path. Arguments were admitted above; the result and outer materialized
    // value charge remain identical. Native identities retain full dispatch.
    if (hooks.compiled?.(fn)) return admittedValue(applyFunction(fn, self, args));
    chargeRetainedText(fn,args);
    for (const index of primitiveKeyConsumers.get(fn) ?? []) chargeMaterialized(args[index]);
    if (fn === Function.prototype.toString && typeof self === 'function') {
      const source = hooks.functionSource?.(self);
      if (source !== undefined) return source;
      const registered = sources.get(self);
      if (registered) return registered.source.slice(registered.start, registered.end);
    }
    if (fn === String && args.length && typeof args[0] !== 'symbol') return stringValue(args[0]);
    if (fn === String.raw) {
      const raw = get(ref(toObject(args[0]), 'raw'));
      const literals = toObject(raw), length = toLength(get(ref(literals, 'length')));
      let result = '';
      for (let index = 0; index < length; index++) {
        hooks.tick?.();
        result += stringValue(get(ref(literals, String(index))));
        if (index + 1 < length && index + 1 < args.length) result += stringValue(args[index + 1]);
      }
      return result;
    }
    if (fn === String.prototype.concat) {
      if (self === null || self === undefined) return apply(fn, self, []);
      let result = stringValue(self);
      for (const value of args) result += stringValue(value);
      return result;
    }
    if (fn === Object.prototype.toString) {
      if (self === undefined) return '[object Undefined]';
      if (self === null) return '[object Null]';
      const object = Object(self);
      const builtinTag = Array.isArray(object) ? 'Array'
        : types.isArgumentsObject(object) ? 'Arguments'
        : typeof object === 'function' ? 'Function'
        : types.isNativeError(object) ? 'Error'
        : types.isBooleanObject(object) ? 'Boolean'
        : types.isNumberObject(object) ? 'Number'
        : types.isStringObject(object) ? 'String'
        : types.isDate(object) ? 'Date'
        : types.isRegExp(object) ? 'RegExp' : 'Object';
      const tag = get(ref(object, Symbol.toStringTag));
      return '[object ' + (typeof tag === 'string' ? tag : builtinTag) + ']';
    }
    if (fn === Array.prototype.join) {
      const object = toObject(self), length = toLength(get(ref(object, 'length')));
      const separator = args[0] === undefined ? ',' : stringValue(args[0]);
      if (activeJoins.has(object)) return '';
      activeJoins.add(object);
      try {
        const parts: string[] = [];
        for (let index = 0; index < length; index++) {
          hooks.tick?.();
          const value = get(ref(object, String(index)));
          parts.push(value === null || value === undefined ? '' : stringValue(value));
        }
        return parts.join(separator);
      } finally { activeJoins.delete(object); }
    }
    if (fn === Function.prototype.call) return typeof self === 'function'
      ? invoke(self, args[0], args.slice(1)) : applyFunction(fn, self, args);
    if (fn === Function.prototype.apply) {
      if (typeof self !== 'function') return applyFunction(fn, self, args);
      return invoke(self, args[0], args[1] == null ? [] : arrayLike(args[1]));
    }
    if (fn === Function.prototype[Symbol.hasInstance] && typeof self === 'function') {
      const boundReceiver = binding(self);
      if (boundReceiver) return instanceOf(args[0], boundReceiver.fun);
    }
    if (fn === Reflect.apply) {
      if (typeof args[0] !== 'function') return applyFunction(fn, self, args);
      return invoke(args[0], args[1], arrayLike(args[2]));
    }
    if (fn === Reflect.construct) {
      const newTarget = args.length > 2 ? args[2] : args[0];
      if (!isConstructor(args[0]) || !isConstructor(newTarget)) return applyFunction(fn, self, args);
      return create(args[0], arrayLike(args[1]), newTarget);
    }
    if (fn === Function.prototype.bind) {
      if (typeof self !== 'function') return applyFunction(fn, self, args);
      admittedValue(self);
      const record = { fun: self, self: args[0], args: args.slice(1) };
      const prototype = prototypeOf(self);
      function forward(this: unknown, ...rest: unknown[]) {
        nativeEntry(rest);
        return new.target ? create(record.fun, [...record.args, ...rest], new.target === forward ? record.fun : new.target)
          : invoke(record.fun, record.self, [...record.args, ...rest]);
      }
      const result = hooks.bind ? hooks.bind(self, record.self, record.args)
        : apply(Function.prototype.bind, isConstructor(self) ? forward : {
          forward(...rest: unknown[]) { nativeEntry(rest); return invoke(record.fun, record.self, [...record.args, ...rest]); }
        }.forward, [undefined]);
      chargePrototypeMutation(result,prototype);
      setPrototype(result, prototype);
      let length = 0;
      if (hasOwn(self, 'length')) {
        const targetLength = get(ref(self, 'length'));
        if (typeof targetLength === 'number') {
          length = targetLength === Infinity ? Infinity
            : Math.max((Number.isNaN(targetLength) ? 0 : Math.trunc(targetLength)) - record.args.length, 0);
        }
      }
      defineOwn(result, 'length', { value: length, configurable: true });
      const targetName = get(ref(self, 'name'));
      if (typeof targetName === 'string') chargeTextWork(targetName.length);
      defineOwn(result, 'name', { value: 'bound ' + (typeof targetName === 'string' ? targetName : ''), configurable: true });
      bindings.set(result, record);
      return result;
    }
    // These algorithms capture length before argument coercion and only then
    // allocate their result. Keep the species check at that allocation point.
    if (fn === Array.prototype.splice || fn === Array.prototype.flat) {
      const object = toObject(self), length = toLength(get(ref(object, 'length')));
      if (fn === Array.prototype.flat) {
        const depth = args[0] === undefined ? 1 : Math.max(toInteger(args[0]), 0);
        checkNativeOperation(fn, object, policyTick);
        guardedArrayConstructor(object);
        const result: any[] = allocation([]);
        let target = 0;
        function flatten(source: any, count: number, remaining: number): void {
          for (let index = 0; index < count; index++) {
            hooks.tick?.();
            if (!has(index, source)) continue;
            const value = get(ref(source, index));
            if (remaining > 0 && Array.isArray(value)) {
              flatten(value, toLength(get(ref(value, 'length'))), remaining - 1);
            } else {
              if (target >= Number.MAX_SAFE_INTEGER) throw new TypeError('Array result is too large');
              defineElement(result, target++, value);
            }
          }
        }
        flatten(object, length, depth);
        return result;
      }
      const start = relativeIndex(args[0], length), insertCount = Math.max(args.length - 2, 0);
      const deleteCount = args.length === 0 ? 0 : args.length === 1 ? length - start
        : Math.min(Math.max(toInteger(args[1]), 0), length - start);
      const newLength = length - deleteCount + insertCount;
      if (newLength > Number.MAX_SAFE_INTEGER) throw new TypeError('Array result is too large');
      checkNativeOperation(fn, object, policyTick);
      guardedArrayConstructor(object);
      const result = allocation(new Array(deleteCount));
      for (let index = 0; index < deleteCount; index++) {
        hooks.tick?.();
        const source = start + index;
        if (has(source, object)) defineElement(result, index, get(ref(object, source)));
      }
      writable(object);
      if (insertCount < deleteCount) {
        for (let index = start; index < length - deleteCount; index++) {
          hooks.tick?.();
          const source = index + deleteCount, target = ref(object, index + insertCount);
          if (has(source, object)) set(target, get(ref(object, source))); else remove(target);
        }
        for (let index = length; index > newLength; index--) {
          hooks.tick?.();
          remove(ref(object, index - 1));
        }
      } else if (insertCount > deleteCount) {
        for (let index = length - deleteCount; index > start; index--) {
          hooks.tick?.();
          const source = index + deleteCount - 1, target = ref(object, index + insertCount - 1);
          if (has(source, object)) set(target, get(ref(object, source))); else remove(target);
        }
      }
      for (let index = 0; index < insertCount; index++) {
        hooks.tick?.();
        set(ref(object, start + index), args[index + 2]);
      }
      set(ref(object, 'length'), newLength);
      return result;
    }
    if (fn === Array.prototype.slice) {
      const object = toObject(self), length = toLength(get(ref(object, 'length')));
      const start = relativeIndex(args[0], length);
      const end = args[1] === undefined ? length : relativeIndex(args[1], length);
      checkNativeOperation(fn, object, policyTick);
      guardedArrayConstructor(object);
      const count = Math.max(end - start, 0), result = allocation(new Array(count));
      for (let index = start, target = 0; index < end; index++, target++) {
        hooks.tick?.();
        if (has(index, object)) defineElement(result, target, get(ref(object, index)));
      }
      return result;
    }
    if (!nativeCallbacks.has(fn)) checkNativeOperation(fn, self, policyTick);
    const memory = memoryStorage(self);
    if (memory) {
      const accessor = memoryAccessors.get(fn), operation = dataViewOperations.get(fn);
      if (accessor) {
        if (accessor.family === 'buffer') {
          if (!memory.isBuffer(self)) return apply(fn, self, args);
          return memory.bufferLength(self);
        }
        if (!memory.isView(self)) return apply(fn, self, args);
        const view = memory.view(self);
        if ((view.kind === 'DataView') !== (accessor.family === 'data')) return apply(fn, self, args);
        return (view as any)[accessor.field];
      }
      if (operation) {
        if (!memory.isView(self) || memory.view(self).kind !== 'DataView') return apply(fn, self, args);
        const index = toInteger(args[0]);
        if (index < 0 || index > Number.MAX_SAFE_INTEGER) throw new RangeError('Offset outside view');
        if (!operation.write) return memory.readData(self, operation.kind, index, Boolean(args[1]));
        writable(self);
        const item = toPrimitive(args[1], 'number'); chargeNumericText(item);
        // Convert before range validation, as SetViewValue requires. The
        // one-element native scratch carries no Context data or callbacks.
        const scratch = new DataView(new ArrayBuffer(8));
        apply(fn, scratch, [0, item, Boolean(args[2])]);
        const converted = apply((DataView.prototype as any)['get' + operation.kind], scratch, [0, Boolean(args[2])]);
        memory.writeData(self, operation.kind, index, converted, Boolean(args[2]));
        return undefined;
      }
      if (memory.isView(self) && memory.view(self).kind !== 'DataView') {
        const view = memory.view(self), width = view.length ? view.byteLength / view.length : 1;
        if (fn === typedArrayPrototype.reverse || fn === typedArrayPrototype.sort
          || fn === typedArrayPrototype.toReversed || fn === typedArrayPrototype.toSorted) {
          const copying = fn === typedArrayPrototype.toReversed || fn === typedArrayPrototype.toSorted;
          const sorting = fn === typedArrayPrototype.sort || fn === typedArrayPrototype.toSorted;
          if (!copying) writable(self);
          if (sorting && args[0] !== undefined && typeof args[0] !== 'function') throw new TypeError('Invalid comparison function');
          // These operations inherently inspect/rewrite the entire view. A
          // byte-exact scratch preserves NaN payloads and delegates ordering
          // to the same V8 intrinsic; ordinary reads/forks do not use it.
          chargeAllocatedBytes(view.byteLength);
          const bytes = new Uint8Array(view.byteLength);
          memory.readBytes(view.buffer, view.byteOffset, bytes);
          const constructor = [...typedConstructors].find(constructor => constructor.name === view.kind + 'Array')!;
          const scratch = construct(constructor, [bytes.buffer]);
          const compare = args[0];
          const result = apply(fn, scratch, sorting && compare !== undefined ? [(left: unknown, right: unknown) => {
            hooks.tick?.();
            return numericUnary('+', invoke(compare, undefined, [left, right]));
          }] : []);
          // A thrown comparator never installs the scratch. Mutations made by
          // the comparator itself remain in the active branch, as in V8.
          if (copying) {
            memory.adoptView(result);
            return admittedValue(result);
          }
          memory.writeBytes(view.buffer, view.byteOffset, bytes);
          return self;
        }
        if (fn === typedArrayPrototype.map || fn === typedArrayPrototype.filter || fn === typedArrayPrototype.subarray || fn === typedArrayPrototype.slice) {
          const fallback = [...typedConstructors].find(item => item.name === view.kind + 'Array')!;
          const allocate = (arguments_: any[], minimum?: number) => {
            const result = create(speciesConstructor(self, fallback), arguments_);
            if (!types.isTypedArray(result)) throw new TypeError('Invalid typed array species result');
            const resultMemory = memoryStorage(result);
            const kind = resultMemory ? resultMemory.view(result).kind : apply(typedName, result, []).replace(/Array$/, '');
            const length = resultMemory ? resultMemory.view(result).length : apply(typedSlots.length!, result, []);
            if (kind.startsWith('Big') !== view.kind.startsWith('Big')) throw new TypeError('Incompatible typed array content types');
            if (minimum !== undefined && length < minimum) throw new TypeError('Typed array species result too short');
            return result;
          };
          if (fn === typedArrayPrototype.subarray) {
            const start = relativeIndex(args[0], view.length);
            const end = args[1] === undefined ? view.length : relativeIndex(args[1], view.length);
            const elementWidth = (fallback as any).BYTES_PER_ELEMENT;
            return admittedValue(allocate([view.buffer, view.byteOffset + start * elementWidth, Math.max(end - start, 0)]));
          }
          if (fn === typedArrayPrototype.slice) {
            const start = relativeIndex(args[0], view.length);
            const end = args[1] === undefined ? view.length : relativeIndex(args[1], view.length);
            const count = Math.max(end - start, 0), result = allocate([count], count);
            const targetMemory = memoryStorage(result);
            const target = targetMemory?.view(result);
            const targetKind = target?.kind ?? apply(typedName, result, []).replace(/Array$/, '');
            writable(result); chargeByteWork(count * width);
            if (targetKind === view.kind) {
              const targetBuffer = target?.buffer ?? apply(typedSlots.buffer!, result, []);
              const targetOffset = target?.byteOffset ?? apply(typedSlots.byteOffset!, result, []);
              // Unlike set(), slice copies sequentially even when a custom
              // species returns an overlapping view of the source buffer.
              if (targetMemory === memory && targetBuffer !== view.buffer) {
                memory.copyBytes(targetBuffer, targetOffset, view.buffer, view.byteOffset + start * width, count * width);
              } else {
                const bytes = new Uint8Array(width);
                for (let index = 0; index < count; index++) {
                  hooks.tick?.();
                  memory.readBytes(view.buffer, view.byteOffset + (start + index) * width, bytes);
                  if (targetMemory) targetMemory.writeBytes(targetBuffer, targetOffset + index * width, bytes);
                  else new Uint8Array(targetBuffer, targetOffset + index * width, width).set(bytes);
                }
              }
            } else {
              for (let index = 0; index < count; index++) {
                hooks.tick?.(); set(ref(result, String(index)), memory.readElement(self, start + index));
              }
            }
            return admittedValue(result);
          }
          const callback = args[0];
          if (typeof callback !== 'function') throw new TypeError('Invalid typed array callback');
          if (fn === typedArrayPrototype.map) {
            const result = allocate([view.length], view.length);
            for (let index = 0; index < view.length; index++) {
              hooks.tick?.();
              const item = invoke(callback, args[1], [memory.readElement(self, index), index, self]);
              set(ref(result, String(index)), item);
            }
            return admittedValue(result);
          }
          const selected = [];
          for (let index = 0; index < view.length; index++) {
            hooks.tick?.();
            const item = memory.readElement(self, index);
            if (invoke(callback, args[1], [item, index, self])) selected.push(item);
          }
          const result = allocate([selected.length], selected.length);
          for (let index = 0; index < selected.length; index++) {
            hooks.tick?.(); set(ref(result, String(index)), selected[index]);
          }
          return admittedValue(result);
        }
        const readOperation = typedReadOperations.get(fn);
        if (readOperation) {
          // Generic Array algorithms are used only for methods with identical
          // element semantics. Their private facade fixes the internal length
          // and cannot expose itself through a callback's array argument.
          const indexed = (key: PropertyKey) => typeof key === 'string' && String(Number(key)) === key
            && Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < view.length;
          const facade = new Proxy(Object.create(null), {
            get(_target, key) { return key === 'length' ? view.length : indexed(key) ? memory.readElement(self, Number(key)) : undefined; },
            has(_target, key) { return key === 'length' || indexed(key); }
          });
          const forwarded = args.slice();
          if (readOperation.callback && typeof args[0] === 'function') {
            const callback = args[0];
            forwarded[0] = function(this: unknown, ...values: unknown[]) {
              values[values.length - 1] = self;
              return invoke(callback, this, values);
            };
          }
          return invoke(readOperation.array, facade, forwarded);
        }
        if (fn === typedArrayPrototype.with) {
          const relative = toInteger(args[0]);
          const index = relative < 0 ? view.length + relative : relative;
          const item = toPrimitive(args[1], 'number'); chargeNumericText(item);
          const constructor = [...typedConstructors].find(item => item.name === view.kind + 'Array')!;
          // Value conversion precedes range validation and may mutate source.
          const converted: any = construct(constructor, [1]); converted[0] = item;
          if (index < 0 || index >= view.length) throw new RangeError('Invalid typed array index');
          chargeAllocatedBytes(view.byteLength);
          const bytes = new Uint8Array(view.byteLength);
          memory.readBytes(view.buffer, view.byteOffset, bytes);
          const result = apply(fn, construct(constructor, [bytes.buffer]), [index, converted[0]]) as ArrayBufferView;
          memory.adoptView(result);
          return admittedValue(result);
        }
        if (fn === typedArrayPrototype.copyWithin) {
          writable(self);
          const target = relativeIndex(args[0], view.length), start = relativeIndex(args[1], view.length);
          const end = args[2] === undefined ? view.length : relativeIndex(args[2], view.length);
          const count = Math.max(0, Math.min(end - start, view.length - target));
          chargeByteWork(count * width);
          if (count) memory.copyBytes(view.buffer, view.byteOffset + target * width, view.buffer, view.byteOffset + start * width, count * width);
          return self;
        }
        if (fn === typedArrayPrototype.fill) {
          writable(self);
          const item = toPrimitive(args[0], 'number'); chargeNumericText(item);
          // Even an empty fill converts its value before start/end. Use the
          // intrinsic setter to validate Number/BigInt conversion without
          // touching the destination or calling an authored constructor.
          const constructor = [...typedConstructors].find(constructor => constructor.name === view.kind + 'Array')!;
          const scratch: any = construct(constructor, [1]); scratch[0] = item;
          const converted = scratch[0];
          const start = relativeIndex(args[1], view.length), end = args[2] === undefined ? view.length : relativeIndex(args[2], view.length);
          for (let index = start; index < end; index++) { hooks.tick?.(); memory.writeElement(self, index, converted); }
          return self;
        }
        if (fn === typedArrayPrototype.set) {
          writable(self);
          const offset = toInteger(args[1]);
          if (offset < 0) throw new RangeError('Invalid typed array offset');
          const source = toObject(args[0]), sourceMemory = memoryStorage(source);
          const managedTyped = sourceMemory?.isView(source) && sourceMemory.view(source).kind !== 'DataView';
          if (managedTyped || types.isTypedArray(source)) {
            const info = managedTyped ? sourceMemory!.view(source) : undefined;
            const length = info ? info.length : apply(typedSlots.length!, source, []);
            const kind = info ? info.kind : apply(typedName, source, []).replace(/Array$/, '');
            if (length > view.length - offset) throw new RangeError('Source exceeds typed array');
            if (kind.startsWith('Big') !== view.kind.startsWith('Big')) throw new TypeError('Incompatible typed array content types');
            if (kind === view.kind) {
              chargeByteWork(length * width);
              if (length && info) memory.copyBytes(view.buffer, view.byteOffset + offset * width, info.buffer, info.byteOffset, info.byteLength);
              else if (length) memory.writeBytes(view.buffer, view.byteOffset + offset * width,
                new Uint8Array(apply(typedSlots.buffer!, source, []), apply(typedSlots.byteOffset!, source, []), length * width));
            } else {
              // A cheap COW root protects overlapping source views, including
              // conversions between element widths, without copying a buffer.
              const reader = info?.buffer === view.buffer ? sourceMemory!.fork() : sourceMemory;
              for (let index = 0; index < length; index++) {
                hooks.tick?.();
                memory.writeElement(self, offset + index, info ? reader!.readElement(source, index) : (source as any)[index]);
              }
            }
          } else {
            const length = toLength(get(ref(source, 'length')));
            if (length > view.length - offset) throw new RangeError('Source exceeds typed array');
            for (let index = 0; index < length; index++) {
              hooks.tick?.();
              const item = toPrimitive(get(ref(source, String(index))), 'number'); chargeNumericText(item);
              memory.writeElement(self, offset + index, item);
            }
          }
          return undefined;
        }
      }
    }
    if (objectStorage(args[0]) && (fn === Object.prototype.isPrototypeOf || fn === Function.prototype[Symbol.hasInstance])) {
      if (fn === Function.prototype[Symbol.hasInstance]) {
        if (typeof self !== 'function') return false;
        const bound = binding(self);
        if (bound) return instanceOf(args[0], bound.fun);
      }
      const expected = fn === Object.prototype.isPrototypeOf ? toObject(self) : get(ref(self, 'prototype'));
      if (expected === null || typeof expected !== 'object' && typeof expected !== 'function') throw new TypeError('Invalid instanceof prototype');
      for (let current = prototypeOf(args[0]); current !== null; current = prototypeOf(current)) {
        hooks.tick?.();
        if (current === expected) return true;
      }
      return false;
    }
    if (fn === lookupGetter || fn === lookupSetter) {
      // These intrinsics walk the receiver's prototype chain but return only
      // one accessor (or undefined). Convert the key once through the guarded
      // path, then account for ordinary links without revisiting Proxy traps.
      if (self === null || self === undefined) return applyFunction(fn, self, args);
      const key = propertyKey(args[0]);
      if (objectStorage(self)) {
        for (let current: object | null = self; current !== null; current = prototypeOf(current)) {
          hooks.tick?.();
          const descriptor = ownDescriptor(current, key);
          if (descriptor) return admittedValue(descriptor[fn === lookupGetter ? 'get' : 'set']);
        }
        return undefined;
      }
      const result = applyFunction(fn, self, [key]);
      chargePropertyLookup(Object(self), key);
      return admittedValue(result);
    }
    if (fn === JSON.parse) return parse(args[0], args[1], {
      allocate: hooks.objects?.() ? allocation : undefined,
      get: (object, key) => get(ref(object, key)), invoke, string: stringValue,
      length: toLength, tick: () => hooks.tick?.(), keys: enumerableKeys,
      define(object, key, value) {
        writable(object);
        const storage = objectStorage(object), descriptor = {value, writable: true, enumerable: true, configurable: true};
        if (storage) storage.defineProperty(object, key, descriptor, value => numericUnary('+', value));
        else Reflect.defineProperty(object, key, descriptor);
      },
      remove(object, key) { writable(object); const storage = objectStorage(object); if (storage) storage.deleteProperty(object, key); else Reflect.deleteProperty(object, key); },
    });
    if (fn === JSON.stringify) return stringify(args[0], args[1], args[2], {
      allocate: hooks.objects?.() ? allocation : undefined,
      get: (object, key) => get(ref(object, key)), invoke, string: stringValue,
      number: value => +toPrimitive(value, 'number'), length: toLength, tick: () => hooks.tick?.(),
      keys: enumerableKeys, prototype: prototypeOf,
    });
    if (fn === promiseWithResolvers) {
      const result: any = hooks.apply ? hooks.apply(fn, self, args) : apply(fn, self, args);
      rememberPromiseCallbacks(result.resolve, result.reject);
      return admittedValue(result);
    }
    if (fn === Promise.all || fn === Promise.allSettled || fn === Promise.any || fn === Promise.race) {
      // Acquisition remains lazy so GetPromiseResolve still precedes it.
      const guarded = nativeIterable(args[0]);
      // Admission above requires the exact intrinsic Promise constructor.
      // Retain native capability creation and PromiseResolve; wrap only the
      // resolved promise's then handoff, where the combinator owns both args.
      const constructor = new Proxy(Promise, {
        construct(target, values) { return construct(target, values, target); },
        get(target, key) {
          const value = get(ref(target, key));
          if (key !== 'resolve') return value;
          return function(input: unknown) {
            return nativeThenReceiver(invoke(value, target, [input]), true);
          };
        }
      });
      return admittedValue(hooks.apply ? hooks.apply(fn, constructor, [guarded]) : apply(fn, constructor, [guarded]));
    }
    if ((fn === Promise.prototype.catch || fn === Promise.prototype.finally)
      && self !== null && (typeof self === 'object' || typeof self === 'function')) {
      // Both generic methods invoke receiver.then inside V8. Forward the
      // property read and invocation through the guarded path; finally also
      // supplies generated continuation functions that need provenance.
      const receiver = nativeThenReceiver(self, fn === Promise.prototype.finally && typeof args[0] === 'function');
      return admittedValue(hooks.apply ? hooks.apply(fn, receiver, args) : apply(fn, receiver, args));
    }
    if (fn === AggregateError) args = [nativeIterable(args[0]), ...args.slice(1)];
    args = guardedErrorOptions(fn, args);
    if (hooks.memory?.() && (fn === typedArrayConstructor.from || fn === typedArrayConstructor.of)) {
      if (!isConstructor(self)) throw new TypeError('Typed array constructor required');
      const allocate = (length: number) => {
        const result = create(self, [length]);
        if (!types.isTypedArray(result)) throw new TypeError('Invalid typed array result');
        const storage = memoryStorage(result);
        const actualLength = storage ? storage.view(result).length : apply(typedSlots.length!, result, []);
        if (actualLength < length) throw new TypeError('Typed array result too short');
        return result;
      };
      if (fn === typedArrayConstructor.of) {
        const result = allocate(args.length);
        for (let index = 0; index < args.length; index++) {
          hooks.tick?.(); set(ref(result, String(index)), args[index]);
        }
        return admittedValue(result);
      }
      const mapper = args[1], mapping = mapper !== undefined;
      if (mapping && typeof mapper !== 'function') throw new TypeError('Invalid typed array mapper');
      const source = args[0], method = get(ref(source, Symbol.iterator));
      let values: any[] | undefined;
      if (method != null) {
        if (typeof method !== 'function') throw new TypeError('Invalid iterator method');
        values = [];
        const record = iteratorFromMethod(source, method);
        // TypedArray.from collects the iterable before allocation or mapping.
        for (;;) {
          const item = iteratorStep(record);
          if (record.done) break;
          values.push(item);
        }
      }
      const object = values ?? toObject(source);
      const length = values ? values.length : toLength(get(ref(object, 'length')));
      const result = allocate(length);
      for (let index = 0; index < length; index++) {
        hooks.tick?.();
        const value = values ? values[index] : get(ref(object, String(index)));
        set(ref(result, String(index)), mapping ? invoke(mapper, args[2], [value, index]) : value);
      }
      return admittedValue(result);
    }
    if ((fn === typedArrayConstructor.from || fn === typedArrayConstructor.of) && isConstructor(self)) self = byteResultConstructor(self);
    if (fn === typedArrayConstructor.from) args = [nativeSequence(args[0], args[1] === undefined), ...args.slice(1)];
    if (fn === typedArrayPrototype.set && !types.isTypedArray(args[0])) {
      // A nullish source is rejected by V8 after offset conversion but before
      // any source property read. Keep the original value and guard only the
      // offset's ToPrimitive path; no sequence facade is needed for this path.
      if (args[0] == null) return applyFunction(fn, self, nativeCoercionArguments(fn, args));
      args = [nativeSequence(args[0], true), ...args.slice(1)];
    }
    if (fn === Array.from) {
      const items = args[0], mapper = args[1], mapping = mapper !== undefined;
      if (mapping && typeof mapper !== 'function') return applyFunction(fn, self, args);
      const method = get(ref(items, Symbol.iterator));
      if (method != null) {
        if (typeof method !== 'function') return applyFunction(fn, self, [{[Symbol.iterator]: method}]);
        const result: any[] = allocation([]);
        consumeIterator(iteratorFromMethod(items, method), (value, index) => {
          defineElement(result, index, mapping ? invoke(mapper, args[2], [value, index]) : value);
        }, Number.MAX_SAFE_INTEGER);
        return result;
      }
      const object = Object(items), length = toLength(get(ref(object, 'length'))), result = allocation(new Array(length));
      for (let index = 0; index < length; index++) {
        hooks.tick?.();
        const value = get(ref(object, index));
        defineElement(result, index, mapping ? invoke(mapper, args[2], [value, index]) : value);
      }
      return result;
    }
    if (fn === Object.fromEntries) {
      // Primitive input has no authored iterator or accessor. Keep V8's own
      // source/entry validation instead of inventing an iterator error.
      if (args[0] === null || typeof args[0] !== 'object' && typeof args[0] !== 'function')
        return admittedValue(applyFunction(fn, self, args));
      const result = allocation({});
      consumeIterator(consumerIteratorOpen(args[0]), entry => {
        entryObject(entry);
        const key = get(ref(entry, '0')), value = get(ref(entry, '1'));
        defineOwn(result, propertyKey(key), {value, writable:true, enumerable:true, configurable:true});
      });
      return result;
    }
    if (fn === Object.keys || fn === Object.getOwnPropertyNames
      || fn === Object.getOwnPropertySymbols || fn === Reflect.ownKeys) {
      const value = args[0];
      if (value === null || value === undefined || fn === Reflect.ownKeys
        && typeof value !== 'object' && typeof value !== 'function') return applyFunction(fn, self, args);
      const object = Object(value), result: PropertyKey[] = [];
      // OwnPropertyKeys is observed exactly once. The native filters also
      // inspect keys that never appear in their output, so charge each key
      // before applying the same type/enumerability filter.
      for (const key of ownKeys(object)) {
        hooks.tick?.();
        if (fn === Reflect.ownKeys || fn === Object.getOwnPropertyNames && typeof key === 'string'
          || fn === Object.getOwnPropertySymbols && typeof key === 'symbol'
          || fn === Object.keys && typeof key === 'string'
            && ownDescriptor(object, key)?.enumerable) result.push(key);
      }
      return admittedValue(allocation(result));
    }
    if (fn === (Object as any).groupBy || fn === (Map as any).groupBy) {
      const items = args[0], callback = args[1], property = fn === (Object as any).groupBy;
      // Both validations precede GetIterator. The intrinsic supplies the
      // target V8 diagnostic while leaving the iterable untouched.
      if (items == null || typeof callback !== 'function') return applyFunction(fn, self, args);
      const groups = new Map<any, any[]>();
      consumeIterator(consumerIteratorOpen(items), (value, index) => {
        const selected = invoke(callback, undefined, [value, index]);
        const key = property ? propertyKey(selected) : selected;
        let group = groups.get(key);
        if (!group) { group = allocation([]); groups.set(key, group); }
        arrayAppend(group, value);
      }, Number.MAX_SAFE_INTEGER);
      if (!property) return admittedValue(groups);
      const result = allocation(Object.create(null));
      for (const [key, value] of groups) {
        hooks.tick?.();
        defineOwn(result, key, {value, writable:true, enumerable:true, configurable:true});
      }
      return result;
    }
    if (fn === Reflect.get || fn === Reflect.set) {
      if (args[0] === null || typeof args[0] !== 'object' && typeof args[0] !== 'function') {
        // Invalid targets fail before key conversion or receiver observation.
        return applyFunction(fn, self, args);
      }
      const reference = ref(args[0], args[1]);
      const receiver = args.length > (fn === Reflect.get ? 2 : 3) ? args[fn === Reflect.get ? 2 : 3] : args[0];
      const indexed = memoryIndex(reference.object, reference.key);
      if (indexed && fn === Reflect.get) return admittedValue(indexed.storage.readElement(reference.object, indexed.index));
      if (indexed && receiver === reference.object && fn === Reflect.set) {
        set(reference, args[2]); return true;
      }
      if (indexed && fn === Reflect.set) {
        writable(reference.object); writable(receiver);
        if (indexed.storage.readElement(reference.object, indexed.index) === undefined) return true;
        if (receiver === null || typeof receiver !== 'object' && typeof receiver !== 'function') return false;
        const previous = ownDescriptor(receiver, reference.key);
        if (previous && (!('value' in previous) || !previous.writable)) return false;
        return defineStored(receiver, reference.key, previous ? {value: args[2]}
          : {value: args[2], writable: true, enumerable: true, configurable: true});
      }
      const storage = objectStorage(reference.object);
      if (storage) {
        if (fn === Reflect.get) return admittedValue(storage.get(reference.object, reference.key, receiver,
          (fn, self, args) => { accessor(fn, 'get'); return invoke(fn, self, args); }));
        writable(reference.object); writable(receiver);
        return storage.set(reference.object, reference.key, args[2], receiver,
          (fn, self, args) => { accessor(fn, 'set'); return invoke(fn, self, args); }, value => numericUnary('+', value));
      }
      if (fn === Reflect.get) {
        if(receiver===reference.object)return get(reference);
        chargePropertyLookup(reference.object,reference.key);
        checkPropertyAccessor(reference, 'get');
        if (reference.key === 'size') {
          for (let cursor = reference.object; cursor !== null; cursor = prototypeOf(cursor)) {
            const descriptor = ownDescriptor(cursor, reference.key);
            if (!descriptor) continue;
            if (descriptor.get && collectionSizeGetters.has(descriptor.get)) return invoke(descriptor.get, receiver, []);
            break;
          }
        }
        return admittedValue(Reflect.get(reference.object, reference.key, receiver));
      }
      const debugStack=receiver===reference.object?defaultDebugStack(reference.object,reference.key):undefined;
      writable(reference.object); writable(receiver); chargePropertyLookup(reference.object,reference.key); checkPropertyAccessor(reference, 'set');
      const accepted=Reflect.set(reference.object, reference.key, args[2], receiver);
      if(accepted&&debugStack)writtenDebugStacks.set(debugStack,args[2]);
      return accepted;
    }
    if (fn === Reflect.has) {
      if (args[0] === null || typeof args[0] !== 'object' && typeof args[0] !== 'function') return applyFunction(fn,self,args);
      const key=propertyKey(args[1]);
      const indexed = memoryIndex(args[0], key);
      if (indexed) return indexed.storage.readElement(args[0], indexed.index) !== undefined;
      const storage = objectStorage(args[0]);
      if (storage) return storage.hasProperty(args[0], key);
      chargePropertyLookup(args[0],key);
      return admittedValue(applyFunction(fn,self,[args[0],key]));
    }
    if (fn === Object.assign) {
      const target = toObject(args[0]); writable(target);
      for (const source of args.slice(1)) {
        if (source === null || source === undefined) continue;
        const object = Object(source);
        for (const key of ownKeys(object)) {
          hooks.tick?.();
          if (ownDescriptor(object, key)?.enumerable) set(ref(target, key), get(ref(object, key)));
        }
      }
      return target;
    }
    if (fn === Object.values || fn === Object.entries) {
      const object = toObject(args[0]), result: unknown[] = allocation([]);
      for (const key of ownKeys(object)) {
        hooks.tick?.();
        if (typeof key === 'string' && ownDescriptor(object, key)?.enumerable) {
          const value = get(ref(object, key)); arrayAppend(result, fn === Object.entries ? allocation([key, value]) : value);
        }
      }
      return result;
    }
    if (fn === ArrayBuffer.prototype.slice) {
      if (!types.isArrayBuffer(self)) return apply(fn, self, []);
      const length = apply(bufferByteLength, self, []);
      // Constructing a zero-length view also rejects a detached buffer before
      // any argument coercion. Shared/resizable stores are outside admission.
      new Uint8Array(self, 0, 0);
      const start = relativeIndex(args[0], length);
      const end = args[1] === undefined ? length : relativeIndex(args[1], length);
      const count = Math.max(end - start, 0);
      const result = create(speciesConstructor(self, ArrayBuffer), [count]);
      const resultLength = apply(bufferByteLength, result, []);
      new Uint8Array(result, 0, 0);
      if (result === self || resultLength < count) throw new TypeError('Invalid ArrayBuffer species result');
      writable(result);
      // The species result is validated first; no bytes are written if the
      // remaining budget fails.
      chargeByteWork(count);
      const sourceMemory = memoryStorage(self), resultMemory = memoryStorage(result);
      if (sourceMemory && resultMemory === sourceMemory) {
        sourceMemory.copyBytes(result, 0, self, start, count);
      } else if (sourceMemory || resultMemory) {
        // Species may return an ordinary native allocation. Copy in bounded
        // chunks, never mutate an adopted buffer's immutable baseline.
        const chunk = new Uint8Array(Math.min(4096, count));
        for (let offset = 0; offset < count; offset += chunk.length) {
          const bytes = chunk.subarray(0, Math.min(chunk.length, count - offset));
          if (sourceMemory) sourceMemory.readBytes(self, start + offset, bytes);
          else bytes.set(new Uint8Array(self, start + offset, bytes.length));
          if (resultMemory) resultMemory.writeBytes(result, offset, bytes);
          else new Uint8Array(result, offset, bytes.length).set(bytes);
        }
      } else new Uint8Array(result, 0, count).set(new Uint8Array(self, start, count));
      return admittedValue(result);
    }
    if (fn === RegExp.prototype.exec) {
      writable(self);
      // Brand validation precedes input conversion. lastIndex is a fixed own
      // data property, but its value may itself run arbitrary conversion code.
      if (!types.isRegExp(self)) {
        return apply(fn, self, []);
      }
      const text = stringValue(args[0]), index = get(ref(self, 'lastIndex'));
      scannedTextLength = text.length;
      if (objectStorage(self) || index !== null && (typeof index === 'object' || typeof index === 'function')) {
        const start = toLength(index);
        let flags = '';
        for (const [getter, flag] of regexpFlagGetters) if (getter && apply(getter, self, [])) flags += flag;
        // Keep V8's matcher, while preventing a second conversion of the
        // program's index. No temporary property is installed on the original.
        const matcher = new RegExp(apply(regexpSource, self, []), flags);
        matcher.lastIndex = start;
        const result = apply(RegExp.prototype.exec, matcher, [text]);
        if (flags.includes('g') || flags.includes('y')) set(ref(self, 'lastIndex'), matcher.lastIndex);
        chargeTextWork(scannedTextLength);
        return admittedValue(regexpResult(result));
      }
      args = [text];
    }
    if (fn === RegExp.prototype.test) {
      if (self === null || self === undefined || typeof self !== 'object' && typeof self !== 'function') return apply(fn, self, []);
      const text = stringValue(args[0]), exec = get(ref(self, 'exec'));
      const result = invoke(typeof exec === 'function' ? exec : RegExp.prototype.exec, self, [text]);
      if (result !== null && typeof result !== 'object' && typeof result !== 'function') throw new TypeError('Invalid RegExp exec result');
      return result !== null;
    }
    if (fn === RegExp.prototype[Symbol.matchAll]) {
      if (self === null || typeof self !== 'object' && typeof self !== 'function') return apply(fn, self, []);
      // The native iterator keeps a private cursor that cannot enter Context.
      // The direct trusted backend may use it; controlled execution supplies
      // an iterator whose matcher and cursor are explicit Instance state.
      if (!hooks.regexpStringIterator) return admittedValue(applyFunction(fn, self, args));
      const text = stringValue(args[0]);
      const species = speciesConstructor(self, RegExp);
      const flags = stringValue(get(ref(self, 'flags')));
      const matcher = create(species, [self, flags]);
      const index = toLength(get(ref(self, 'lastIndex')));
      set(ref(matcher, 'lastIndex'), index);
      return admittedValue(hooks.regexpStringIterator(matcher, text, flags.includes('g'), flags.includes('u') || flags.includes('v')));
    }
    const regexpProtocol = regexpProtocols.get(fn);
    if (regexpProtocol) {
      if (self === null || typeof self !== 'object' && typeof self !== 'function') return apply(fn, self, []);
      if (!types.isRegExp(self)) throw new TypeError('Unsupported RegExp protocol: receiver is not a RegExp');
      // Perform the specified initial coercions before inspecting fields. A
      // custom input conversion may mutate the regex; checking before it is a
      // time-of-check/time-of-use hole.
      args = args.slice(); args[0] = stringValue(args[0]);
      scannedTextLength = args[0].length;
      if (fn === RegExp.prototype[Symbol.replace] && typeof args[1] !== 'function') args[1] = stringValue(args[1]);
      checkRegExpProtocol(self, regexpProtocol, policyTick, {getOwnPropertyDescriptor:ownDescriptor,getPrototypeOf:prototypeOf});
      // V8 performs ToUint32(limit) after its canonical species/flags setup.
      // Leave that timing to V8 while routing object conversion through the
      // same guarded ToPrimitive view used by other native numeric inputs.
      if (fn === RegExp.prototype[Symbol.split]) args[1] = coercionInput(args[1]);
      writable(self);
      if (objectStorage(self)) self = regexpReceiver(self, regexpProtocol);
    }
    const stringProtocol = stringProtocols.get(fn);
    if (stringProtocol !== undefined) {
      if (self === null || self === undefined) return apply(fn, self, []);
      const search = args[0];
      if (search !== null && search !== undefined) {
        if (fn === String.prototype.replaceAll || fn === String.prototype.matchAll) {
          const match = get(ref(search, Symbol.match));
          if (match === undefined ? types.isRegExp(search) : Boolean(match)) {
            const flags = get(ref(search, 'flags'));
            if (flags === null || flags === undefined || !stringValue(flags).includes('g')) {
              // The original flags getter has already run exactly once. Use a
              // fresh intrinsic RegExp for V8's early failure diagnostic;
              // passing search again would repeat author-observable reads.
              return apply(fn, '', [/x/, '']);
            }
          }
        }
        const method = get(ref(search, stringProtocol));
        if (method !== null && method !== undefined) {
          return invoke(method, search, fn === String.prototype.search || fn === String.prototype.match || fn === String.prototype.matchAll ? [self] : [self, args[1]]);
        }
      }
      // GetMethod is observable. Do not hand the original object to V8 after
      // inspecting it, which would read the hook a second time (possibly a
      // different function). Only the primitive fallback reaches the builtin.
      self = stringValue(self);
      if (stringScanOperations.has(fn)) scannedTextLength = self.length;
      if (fn === String.prototype.search) {
        const pattern = search === undefined ? undefined : stringValue(search);
        const regexp = create(RegExp, [pattern]);
        return invoke(get(ref(regexp, Symbol.search)), regexp, [self]);
      }
      if (fn === String.prototype.match) {
        const pattern = search === undefined ? undefined : stringValue(search);
        const regexp = create(RegExp, [pattern]);
        return invoke(get(ref(regexp, Symbol.match)), regexp, [self]);
      }
      if (fn === String.prototype.matchAll) {
        // RegExpCreate converts the pattern to a string even when it is a
        // RegExp object. The RegExp constructor instead copies its internal
        // pattern, which would give a different fallback when @@matchAll is null.
        const pattern = search === undefined ? undefined : stringValue(search);
        const regexp = create(RegExp, [pattern, 'g']);
        return invoke(get(ref(regexp, Symbol.matchAll)), regexp, [self]);
      }
      if (fn === String.prototype.split) {
        const limit = args[1] === undefined ? undefined : +toPrimitive(args[1], 'number') >>> 0;
        // ToString(separator) precedes the zero-limit return in the native
        // semantics, while undefined still denotes the unsplit input.
        const separator = stringValue(search);
        args = [search === undefined ? undefined : separator, limit];
      } else args = [stringValue(search), typeof args[1] === 'function' ? args[1] : stringValue(args[1])];
    }
    if (fn === Error.prototype.toString || fn === RegExp.prototype.toString) {
      if (self === null || self === undefined) return apply(fn, self, []);
      if (typeof self !== 'object' && typeof self !== 'function') return apply(fn, self, []);
      if (fn === RegExp.prototype.toString) {
        const source = stringValue(get(ref(self, 'source')));
        return '/' + source + '/' + stringValue(get(ref(self, 'flags')));
      }
      const name = get(ref(self, 'name'));
      const nameText = name === undefined ? 'Error' : stringValue(name);
      const message = get(ref(self, 'message'));
      const messageText = message === undefined ? '' : stringValue(message);
      return nameText === '' ? messageText : messageText === '' ? nameText : nameText + ': ' + messageText;
    }
    if (fn === regexpFlags && self !== null && (typeof self === 'object' || typeof self === 'function')) {
      let flags = '';
      for (const [key, flag] of [
        ['hasIndices', 'd'], ['global', 'g'], ['ignoreCase', 'i'], ['multiline', 'm'],
        ['dotAll', 's'], ['unicode', 'u'], ['unicodeSets', 'v'], ['sticky', 'y'],
      ] as const) if (get(ref(self, key))) flags += flag;
      return flags;
    }
    if (fn === Object.prototype.toLocaleString) {
      if (self === null || self === undefined) return apply(fn, self, []);
      return invoke(get(ref(self, 'toString')), self, []);
    }
    if (fn === Array.prototype.toString) {
      const object = toObject(self), join = get(ref(object, 'join'));
      return invoke(typeof join === 'function' ? join : Object.prototype.toString, object, []);
    }
    if (fn === Object.defineProperty || fn === Reflect.defineProperty || fn === Object.defineProperties || fn === Object.create) {
      const target = args[0];
      if (fn === Object.create ? target !== null && typeof target !== 'object' && typeof target !== 'function'
        : target === null || typeof target !== 'object' && typeof target !== 'function') {
        // V8 rejects before inspecting a key or descriptor, and supplies the
        // exact error observed by code that catches this failure.
        return applyFunction(fn, self, args);
      }
    }
    if (fn === Object.defineProperty || fn === Reflect.defineProperty) {
      args = [args[0], propertyKey(args[1]), descriptor(args[2])];
    } else if (fn === Object.defineProperties || fn === Object.create && args[1] !== undefined) {
      args = [args[0], descriptors(args[1])];
    } else if (fn === (Object.prototype as any).__defineGetter__ || fn === (Object.prototype as any).__defineSetter__) {
      if (self === null || self === undefined) return apply(fn, self, []);
      // V8 validates the callback before ToPropertyKey. Invalid callbacks
      // must leave an authored key coercion completely untouched.
      if (typeof args[1] !== 'function') return applyFunction(fn, self, args);
      accessor(args[1], fn === (Object.prototype as any).__defineGetter__ ? 'get' : 'set');
      args[0] = propertyKey(args[0]);
    }
    if (fn === Object.create && hooks.objects?.()) {
      // V8 may retain Object.create's initial prototype in the object's map
      // even after a later native prototype change. Keep authored prototypes
      // solely in Context from allocation onward; descriptor conversion above
      // and native property creation preserve their validation/order rules.
      const result = allocation(applyFunction(fn, self, [null, args[1]]));
      setPrototype(result, args[0]);
      return admittedValue(result);
    }
    const storage = objectStorage(args[0]);
    if (memoryStorage(args[0])) {
      if (fn === Object.getOwnPropertyDescriptor || fn === Reflect.getOwnPropertyDescriptor) {
        const result = ownDescriptor(args[0], propertyKey(args[1])); admitDescriptorValues(result); return result === undefined ? result : allocation(result);
      }
      if (fn === Object.hasOwn) return ownDescriptor(args[0], propertyKey(args[1])) !== undefined;
      if (fn === Reflect.deleteProperty) return remove(ref(args[0], args[1]), false);
      if (fn === Object.defineProperty || fn === Reflect.defineProperty) {
        const indexed = memoryIndex(args[0], args[1]);
        if (indexed) {
          writable(args[0]);
          const accepted = defineStored(args[0], args[1], args[2]);
          if (fn === Reflect.defineProperty) return accepted;
          if (!accepted) throw new TypeError('Cannot redefine property');
          return args[0];
        }
      }
    }
    if (storage) {
      const object = args[0];
      if (fn === Object.defineProperty || fn === Reflect.defineProperty) {
        writable(object);
        const accepted = defineStored(object, args[1], args[2]);
        if (fn === Reflect.defineProperty) return accepted;
        if (!accepted) throw new TypeError('Cannot redefine property');
        return object;
      }
      if (fn === Object.defineProperties) {
        writable(object);
        for (const key of ownKeys(args[1])) {
          hooks.tick?.();
          if (!defineStored(object, key, args[1][key])) throw new TypeError('Cannot redefine property');
        }
        return object;
      }
      if (fn === Object.getOwnPropertyDescriptor || fn === Reflect.getOwnPropertyDescriptor) {
        const result = storage.getOwnPropertyDescriptor(object, propertyKey(args[1]));
        admitDescriptorValues(result);
        return result === undefined ? result : allocation(result);
      }
      if (fn === Object.getOwnPropertyDescriptors) {
        const result = allocation({});
        for (const key of ownKeys(object)) {
          hooks.tick?.();
          const value = ownDescriptor(object, key);
          admitDescriptorValues(value);
          if (value) allocation(value);
          defineOwn(result, key, {value, writable: true, enumerable: true, configurable: true});
        }
        return result;
      }
      if (fn === Object.hasOwn) return storage.getOwnPropertyDescriptor(object, propertyKey(args[1])) !== undefined;
      if (fn === Reflect.deleteProperty) { writable(object); return storage.deleteProperty(object, propertyKey(args[1])); }
      if (fn === Object.getPrototypeOf || fn === Reflect.getPrototypeOf) return admittedValue(storage.getPrototypeOf(object));
      if (fn === Object.setPrototypeOf || fn === Reflect.setPrototypeOf) {
        if (args[1] !== null && typeof args[1] !== 'object' && typeof args[1] !== 'function') throw new TypeError('Invalid prototype');
        writable(object);
        const accepted = storage.setPrototypeOf(object, args[1]);
        if (fn === Reflect.setPrototypeOf) return accepted;
        if (!accepted) throw new TypeError('Cannot set prototype');
        return object;
      }
      if (fn === Object.isExtensible || fn === Reflect.isExtensible) return storage.isExtensible(object);
      if (fn === Object.preventExtensions || fn === Reflect.preventExtensions) {
        writable(object);
        const accepted = storage.preventExtensions(object);
        if (fn === Reflect.preventExtensions) return accepted;
        if (!accepted) throw new TypeError('Cannot prevent extensions');
        return object;
      }
      if (fn === Object.freeze || fn === Object.seal) {
        writable(object);
        if (!storage.preventExtensions(object)) throw new TypeError('Cannot prevent extensions');
        const memory = memoryStorage(object);
        if (memory?.isView(object) && memory.view(object).kind !== 'DataView' && memory.view(object).length > 0) {
          throw new TypeError('Cannot redefine typed array index');
        }
        for (const key of storage.ownKeys(object)) {
          hooks.tick?.();
          const descriptor = storage.getOwnPropertyDescriptor(object, key)!;
          if (!storage.defineProperty(object, key, fn === Object.freeze && 'value' in descriptor
            ? {configurable: false, writable: false} : {configurable: false})) throw new TypeError('Cannot redefine property');
        }
        return object;
      }
      if (fn === Object.isFrozen || fn === Object.isSealed) {
        if (storage.isExtensible(object)) return false;
        const memory = memoryStorage(object);
        if (fn === Object.isFrozen && memory?.isView(object) && memory.view(object).kind !== 'DataView' && memory.view(object).length > 0) return false;
        for (const key of storage.ownKeys(object)) {
          hooks.tick?.();
          const descriptor = storage.getOwnPropertyDescriptor(object, key)!;
          if (descriptor.configurable || fn === Object.isFrozen && 'value' in descriptor && descriptor.writable) return false;
        }
        return true;
      }
    }
    const receiverStorage = objectStorage(self);
    if (receiverStorage && (fn === legacyPrototype.get || fn === legacyPrototype.set)) {
      if (fn === legacyPrototype.get) return admittedValue(receiverStorage.getPrototypeOf(self));
      if (args[0] !== null && typeof args[0] !== 'object' && typeof args[0] !== 'function') return undefined;
      writable(self);
      if (!receiverStorage.setPrototypeOf(self, args[0])) throw new TypeError('Cannot set prototype');
      return undefined;
    }
    if (receiverStorage && (fn === (Object.prototype as any).__defineGetter__ || fn === (Object.prototype as any).__defineSetter__)) {
      writable(self);
      if (!receiverStorage.defineProperty(self, args[0], {
        [fn === (Object.prototype as any).__defineGetter__ ? 'get' : 'set']: args[1], enumerable: true, configurable: true
      })) throw new TypeError('Cannot redefine property');
      return undefined;
    }
    if (receiverStorage && (fn === Object.prototype.hasOwnProperty || fn === Object.prototype.propertyIsEnumerable)) {
      const descriptor = ownDescriptor(self, propertyKey(args[0]));
      return fn === Object.prototype.hasOwnProperty ? descriptor !== undefined : !!descriptor?.enumerable;
    }
    if ((fn === Object.freeze || fn === Object.seal) && args[0] !== null
      && (typeof args[0] === 'object' || typeof args[0] === 'function')) {
      const count = ownKeys(args[0]).length;
      for (let index = 0; index < count; index++) hooks.tick?.();
    }
    if (targetMutators.has(fn)) {
      writable(args[0]);
      // Reflect.set can write to an explicit receiver instead of its target.
      if (fn === Reflect.set && args.length > 3) writable(args[3]);
      if (fn === Object.setPrototypeOf || fn === Reflect.setPrototypeOf) {
        chargePrototypeMutation(args[0],args[1]);
      }
    }
    if (receiverMutators.has(fn)) writable(self);
    let originalReceiver: any, indexedReceiver: any;
    const originalTypedReceiver = typedSpeciesMethods.has(fn) ? self : undefined;
    let typedCopiedBytes = 0;
    if (typedSpeciesMethods.has(fn)) {
      if (!types.isTypedArray(self)) return apply(fn, self, []);
      self = typedSpeciesReceiver(self,
        fn === typedArrayPrototype.slice ? count => { typedCopiedBytes = count; } : undefined);
    }
    const indexedSources = indexedArrayOperations.has(fn) ? new Map<object, object>() : undefined;
    const indexedViews = indexedSources ? new Map<object, object>() : undefined;
    const indexedView = (value: object) => {
      let view = indexedViews!.get(value);
      if (!view) {
        view = indexedArrayReceiver(value, value === originalReceiver && indexedArraySpeciesOperations.has(fn));
        indexedViews!.set(value, view); indexedSources!.set(view, value);
      }
      return view;
    };
    if (indexedArrayOperations.has(fn)) {
      if (self === null || self === undefined) return apply(fn, self, []);
      originalReceiver = Object(self);
      indexedReceiver = indexedView(originalReceiver);
      self = indexedReceiver;
      if (fn === Array.prototype.concat) args = args.map(value => value !== null
        && (typeof value === 'object' || typeof value === 'function') ? indexedView(value) : value);
    }
    const callbackIndex = callbacks.get(fn);
    if (callbackIndex !== undefined && typeof args[callbackIndex] === 'function') {
      const callback = args[callbackIndex];
      args = args.slice();
      args[callbackIndex] = function(this: unknown, ...values: unknown[]) {
        // Native callbacks have no compiler-inserted function-entry charge.
        // Charge the dispatch itself for every callback, independent of origin.
        hooks.tick?.();
        if (originalTypedReceiver) values = values.map(value => value === self ? originalTypedReceiver : value);
        if (indexedReceiver) values = values.map(value => value === indexedReceiver ? originalReceiver : value);
        const result = invoke(callback, this, values);
        if (coercedCallbackResults.has(fn)) return coercionInput(result);
        return fn === Array.prototype.flatMap && Array.isArray(result) ? indexedView(result) : result;
      };
    }
    if ((fn === Array.prototype.sort || fn === Array.prototype.toSorted) && args[0] === undefined) {
      // V8 retains element collection, undefined/hole handling, sorting and
      // writes. Only its default string comparison re-enters guarded coercion.
      args = args.slice();
      args[0] = (left: unknown, right: unknown) => {
        hooks.tick?.();
        const a = stringValue(left), b = stringValue(right);
        chargeTextWork(a.length); chargeTextWork(b.length);
        return a < b ? -1 : a > b ? 1 : 0;
      };
    }
    if (fn === String.prototype[Symbol.iterator]) {
      if (self === null || self === undefined) return apply(fn, self, []);
      self = stringValue(self);
    }
    const originalPattern = fn === RegExp ? args[0] : undefined;
    args = nativeCoercionArguments(fn, args);
    if (stringCoercions.has(fn)) self = coercionInput(self, stringScanOperations.has(fn)
      ? primitive => { if (typeof primitive !== 'symbol') scannedTextLength = String(primitive).length; }
      : undefined);
    const result: any = applyFunction(fn, self, args);
    if (fn === Array || fn === Object.create) allocation(result);
    chargeTextWork(scannedTextLength);
    // Typed-array sources take V8's direct bulk path, bypassing the indexed
    // source facade used for ordinary array-like values. Charge its byte work
    // after native validation and conversion, before returning to the Program.
    if (fn === typedArrayPrototype.set && types.isTypedArray(args[0])) {
      chargeByteWork(apply(typedByteLength, args[0], []));
    }
    // These methods allocate a same-size result without calling @@species.
    // Species-based methods account for allocation in byteResultConstructor;
    // subarray only creates a view over its receiver's backing storage.
    if (typedCopyingMethods.has(fn)) chargeAllocatedBytes(apply(typedByteLength, result, []));
    if (fn === typedArrayPrototype.slice) chargeByteWork(typedCopiedBytes);
    // The native implementation may scan or mutate its whole receiver without
    // invoking any instrumented callback. Charge its capacity as an upper
    // bound; sub-KiB operations still pay only their compiled call cost.
    if (typedBulkOperations.has(fn)) chargeAllocatedBytes(apply(typedByteLength, self, []));
    if ((fn === Object.isFrozen || fn === Object.isSealed) && args[0] !== null
      && (typeof args[0] === 'object' || typeof args[0] === 'function') && !types.isProxy(args[0])) {
      // A successful integrity query can inspect every own descriptor yet
      // return only one boolean. Inspect keys only on ordinary values: a
      // second ownKeys trap on a Proxy would change V8-observable behavior.
      for (const _key of ownKeys(args[0])) hooks.tick?.();
    }
    if ((fn === Object.prototype.isPrototypeOf || fn === Function.prototype[Symbol.hasInstance]) && args[0] !== null
      && (typeof args[0] === 'object' || typeof args[0] === 'function')) {
      // Both native membership tests can walk an arbitrarily deep chain while
      // returning one boolean. Do not revisit a Proxy: its getPrototypeOf
      // trap was already invoked by V8 and a second call would be observable.
      let current = args[0];
      while (current !== null && !types.isProxy(current)) {
        current = prototypeOf(current);
        if (current === null) break;
        hooks.tick?.();
        if (fn === Object.prototype.isPrototypeOf && current === self) break;
      }
    }
    if (fn === Object.getOwnPropertyDescriptor || fn === Reflect.getOwnPropertyDescriptor) {
      admitDescriptorValues(result);
      if (result) allocation(result);
    } else if (fn === Object.getOwnPropertyDescriptors) {
      for (const key of ownKeys(result)) { hooks.tick?.(); admitDescriptorValues(result[key]); allocation(result[key]); }
      allocation(result);
    }
    // RegExp's function-call shortcut returns its pattern. Never leak the
    // transient input view when that shortcut selected the original object.
    if (fn === RegExp && result === args[0]) return admittedValue(originalPattern);
    if (fn === RegExp) chargeTextWork(apply(regexpSource, result, []).length);
    if (fn === Array.prototype.concat) {
      for (const key of Object.keys(result)) {
        hooks.tick?.();
        const original = indexedSources!.get(result[key]);
        if (original) defineElement(result, Number(key), original);
      }
    }
    if (allocatingArrayOperations.has(fn)) allocation(result);
    if (fn === RegExp.prototype.exec || regexpProtocols.has(fn)) regexpResult(result);
    return admittedValue(indexedReceiver && result === indexedReceiver ? originalReceiver : result);
  }
  function create(fn: any, args: any[], newTarget: any = fn): any {
    if (!isConstructor(fn) || !isConstructor(newTarget)) throw new TypeError('Value is not a constructor');
    if (forbiddenCalls.has(fn)) forbidExecution(fn);
    if (forbiddenCalls.has(newTarget)) forbidExecution(newTarget);
    if (objectStorage(args)) args = arrayLike(args);
    for (const value of args) admittedValue(value);
    const bound = binding(fn);
    if (bound) return create(bound.fun, [...bound.args, ...args], newTarget === fn ? bound.fun : newTarget);
    chargeRetainedText(fn,args);
    checkNativeOperation(fn, undefined, policyTick);
    // Registered bound callables have already admitted targets. Native bind
    // prints as native code but is not an unknown host entry point.
    if (newTarget !== fn && !binding(newTarget)) checkNativeOperation(newTarget, undefined, policyTick);
    checkNativeConstruction(fn, newTarget, args, policyTick);
    // [[Construct]] may resolve newTarget.prototype inside V8. Account for
    // ordinary inherited links without evaluating an accessor or Proxy trap.
    chargePropertyLookup(newTarget, 'prototype');
    if (fn === Promise && typeof args[0] === 'function') {
      const executor = args[0];
      args = [function(resolve: Function, reject: Function) {
        rememberPromiseCallbacks(resolve, reject);
        return invoke(executor, undefined, [resolve, reject]);
      }, ...args.slice(1)];
    }
    if (fn === AggregateError) args = [nativeIterable(args[0]), ...args.slice(1)];
    args = guardedErrorOptions(fn, args);
    if (typedConstructors.has(fn) && args[0] !== null
      && (typeof args[0] === 'object' || typeof args[0] === 'function')
      && !types.isTypedArray(args[0]) && !types.isAnyArrayBuffer(args[0])) {
      args = [nativeSequence(args[0], true), ...args.slice(1)];
    }
    let logicalPrototype: object | null | undefined;
    let selectedPrototype = false;
    const target = objectStorage(newTarget) && neutralConstruction.has(fn)
      ? new Proxy((function() {}).bind(undefined), {get(_target, key) {
        if (key !== 'prototype') return get(ref(newTarget, key));
        // Read at the intrinsic's original GetPrototypeFromConstructor point,
        // after any preceding argument coercion, exactly once.
        const value = get(ref(newTarget, key));
        logicalPrototype = value !== null && (typeof value === 'object' || typeof value === 'function')
          ? value : fn.prototype;
        selectedPrototype = true;
        return fn.prototype;
      }}) : constructionTarget(newTarget);
    if (fn === Map || fn === Set || fn === WeakMap || fn === WeakSet) {
      const result: any = construct(fn, [], target), iterable = args[0];
      if (selectedPrototype) installConstructedPrototype(result, logicalPrototype!);
      collectionInitialize(result, iterable, fn === Map || fn === WeakMap);
      return admittedValue(result);
    }
    args = nativeCoercionArguments(fn, args);
    if (typedConstructors.has(fn)) chargeNumericText(args[0]);
    const result = constructFunction(fn, args, target);
    if (fn === Array) allocation(result);
    const memory = hooks.memory?.();
    if (memory && (fn === ArrayBuffer || fn === DataView || typedConstructors.has(fn))) {
      // Native construction retains validation, coercion and newTarget order.
      // A typed source's native bytes are only its immutable baseline: refresh
      // the fresh, unexposed allocation from this branch before adopting it.
      const source = typedConstructors.has(fn) && types.isTypedArray(args[0])
        && memory.isView(args[0]) ? memory.view(args[0]) : undefined;
      if (source) {
        const resultKind = apply(typedName, result, []);
        if (resultKind === source.kind + 'Array') {
          memory.readBytes(source.buffer, source.byteOffset,
            new Uint8Array(apply(typedSlots.buffer!, result, []), apply(typedSlots.byteOffset!, result, []), source.byteLength));
        } else {
          for (let i = 0; i < source.length; i++) {
            hooks.tick?.(); result[i] = memory.readElement(args[0], i);
          }
        }
      }
      if (fn === ArrayBuffer) memory.adoptBuffer(result);
      else memory.adoptView(result);
    }
    admittedValue(result);
    if (selectedPrototype) installConstructedPrototype(result, logicalPrototype!);
    if (fn === RegExp) chargeTextWork(apply(regexpSource, result, []).length);
    if (fn === ArrayBuffer) chargeAllocatedBytes(apply(bufferByteLength, result, []));
    else if (typedConstructors.has(fn) && !types.isAnyArrayBuffer(args[0])) {
      // Constructing a view over an existing buffer does not allocate bytes.
      // Numeric lengths, typed-array copies and array-like sources do.
      chargeAllocatedBytes(apply(typedByteLength, result, []));
    }
    return result;
  }
  /** Only use at specification-defined coercion-only input positions. The
   * native algorithm retains the decision whether/when to coerce. The view is
   * never a result or Context value and conversion sees the original receiver. */
  function diagnosticPrototype(value: object): object | null {
    if (types.isProxy(value)) return Object.prototype;
    const prototype = prototypeOf(value);
    if (prototype === null || !objectStorage(prototype)) return prototype;
    // Managed shells can discard baseline references. Supply V8's diagnostic
    // lookup with the logical constructor without evaluating author getters.
    for (let current: object | null = prototype; current !== null; current = prototypeOf(current)) {
      hooks.tick?.();
      const descriptor = ownDescriptor(current, 'constructor');
      if (!descriptor) continue;
      if (!('value' in descriptor)) return prototype;
      const facade = Object.create(prototype);
      defineOwn(facade, 'constructor', descriptor);
      return facade;
    }
    return prototype;
  }
  function coercionInput(value: any, onPrimitive?: (primitive: unknown) => void): any {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') {
      onPrimitive?.(value);
      return value;
    }
    // Keep the source's ordinary prototype for V8's receiver diagnostics.
    // The accessor returns the actual noncallable exotic value to the native
    // algorithm, while callable and absent methods remain under invoke/get.
    const facade = Object.create(diagnosticPrototype(value));
    defineOwn(facade, Symbol.toPrimitive, {
      get() { return nativeCoercionMethod(value, onPrimitive); }
    });
    return facade;
  }
  function nativeCoercionMethod(value: object, onPrimitive?: (primitive: unknown) => void): unknown {
    const exotic = get(ref(value, Symbol.toPrimitive));
    if (exotic != null) {
      if (typeof exotic !== 'function') return exotic;
      return function(hint: 'string' | 'number' | 'default') {
        const primitive = invoke(exotic, value, [hint]);
        onPrimitive?.(primitive);
        return primitive;
      };
    }
    return function(hint: 'string' | 'number' | 'default') {
      const primitive = ordinaryToPrimitive(value, hint);
      onPrimitive?.(primitive);
      return primitive;
    };
  }
  function guardedErrorOptions(fn: Function, args: any[]): any[] {
    const index = errorOptionsPosition.get(fn);
    if (index === undefined || index >= args.length) return args;
    const original = args[index];
    if (original === null || typeof original !== 'object' && typeof original !== 'function') return args;
    // Error constructors perform HasProperty(options, "cause") followed by Get.
    // A transient facade preserves those calls and their order on the original
    // receiver without letting V8 perform the getter read outside operations.
    const options = new Proxy(Object.create(null), {
      has(_target, key) { return has(key, original); },
      get(_target, key) { return get(ref(original, key)); },
    });
    const result = args.slice();
    result[index] = options;
    return result;
  }
  function admitDescriptorValues(descriptor: PropertyDescriptor | undefined): void {
    if (!descriptor) return;
    if ('value' in descriptor) admittedValue(descriptor.value);
    if ('get' in descriptor) admittedValue(descriptor.get);
    if ('set' in descriptor) admittedValue(descriptor.set);
  }
  function regexpResult(value: any): any {
    if (!Array.isArray(value)) return value;
    const groups = Object.getOwnPropertyDescriptor(value, 'groups')?.value;
    if (groups) allocation(groups);
    const indices = Object.getOwnPropertyDescriptor(value, 'indices')?.value;
    if (indices) {
      for (const pair of indices) if (pair) allocation(pair);
      const named = Object.getOwnPropertyDescriptor(indices, 'groups')?.value;
      if (named) allocation(named);
      allocation(indices);
    }
    return allocation(value);
  }
  function regexpReceiver(value: object, protocol: 'match' | 'replace' | 'search' | 'split'): object {
    // This facade exists only inside the synchronous native algorithm. exec
    // and writes select the current branch immediately, before replace calls
    // any authored callback. The facade itself never becomes Context state.
    return new Proxy(Object.create(null), {
      get(_target, key) {
        if (key === 'exec') return (text: string) => invoke(RegExp.prototype.exec, value, [text]);
        if (key === 'constructor' && protocol === 'split') return {
          [Symbol.species]: function(_pattern: unknown, flags: string) {
            // Split's private matcher copies internal pattern slots, ignoring
            // an authored source property exactly as native RegExp does.
            return new RegExp(apply(regexpSource, value, []), flags);
          }
        };
        return get(ref(value, key));
      },
      set(_target, key, item) { set(ref(value, key), item); return true; }
    });
  }
  function regexpInput(value: any, preserveSlots = true): any {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') return value;
    const nativePattern = types.isRegExp(value);
    if (preserveSlots && nativePattern) {
      if (!objectStorage(value)) return value;
      let flags = '';
      for (const [getter, flag] of regexpFlagGetters) if (getter && apply(getter, value, [])) flags += flag;
      const input = new RegExp(apply(regexpSource, value, []), flags);
      for (const key of [Symbol.match, 'constructor']) Object.defineProperty(input, key, {
        configurable:true, get:()=>get(ref(value,key))
      });
      return input;
    }
    // Construction retains genuine RegExp internal slots. String search
    // predicates need only IsRegExp and ToPrimitive, so their view preserves
    // the internal-slot fallback of IsRegExp explicitly. Forward each native read
    // once. An empty proxy target preserves frozen input invariants.
    return new Proxy(Object.create(null), { get(_target, key) {
      if (key === Symbol.toPrimitive) return nativeCoercionMethod(value);
      const field = get(ref(value, key));
      if (key === Symbol.match && field === undefined && nativePattern) return true;
      return key === 'source' || key === 'flags' ? coercionInput(field) : field;
    } });
  }
  function nativeCoercionArguments(fn: Function, args: any[]): any[] {
    if (fn === typedArrayConstructor.of) return args.map(value => coercionInput(value, chargeNumericText));
    if (fn === typedArrayPrototype.set || typedConstructors.has(fn) || fn === DataView) {
      const result = args.slice();
      for (const index of fn === typedArrayPrototype.set ? [1] : [1,2]) {
        if (index < result.length) result[index] = coercionInput(result[index], chargeNumericText);
      }
      return result;
    }
    if (variadicCoercions.has(fn)) return args.map(value => coercionInput(value, chargeNumericText));
    if (fn === RegExp) return [regexpInput(args[0]), coercionInput(args[1])];
    const indices = stringCoercions.get(fn) ?? coercionArgumentPositions.get(fn);
    if (!indices) return args;
    const result = args.slice();
    for (const index of indices) if (index < result.length) result[index] = index === 0 && stringSearchPredicates.has(fn)
      ? regexpInput(result[index], false) : coercionInput(result[index], numericTextArgumentPositions.get(fn)?.includes(index) ? chargeNumericText : undefined);
    return result;
  }
  function speciesConstructor(value: object, fallback: Function): Function {
    const constructor = get(ref(value, 'constructor'));
    if (constructor === undefined) return fallback;
    if (constructor === null || typeof constructor !== 'object' && typeof constructor !== 'function') throw new TypeError('Invalid species constructor');
    const species = get(ref(constructor, Symbol.species));
    if (species === undefined || species === null) return fallback;
    if (!isConstructor(species)) throw new TypeError('Species is not a constructor');
    return species;
  }
  function byteResultConstructor(selected: Function, onAllocated?: (length: number) => void): Function {
    return function(...args: any[]) {
      const result = create(selected, args);
      writable(result);
      onAllocated?.(args[0]);
      return result;
    };
  }
  function typedSpeciesReceiver(value: any, onCopiedBytes?: (count: number) => void): any {
    if (!types.isTypedArray(value)) throw new TypeError('Invalid typed array receiver');
    const name = apply(typedName, value, []);
    const Constructor = [...typedConstructors].find(item => item.name === name)!;
    const view = construct(Constructor, [apply(typedSlots.buffer!, value, []),
      apply(typedSlots.byteOffset!, value, []), apply(typedSlots.length!, value, [])]);
    // A transient genuine view preserves the native algorithm and backing
    // bytes. Only SpeciesConstructor is redirected; no author object changes.
    defineOwn(view, 'constructor', {get() {
      const selected = speciesConstructor(value, Constructor);
      return { [Symbol.species]: byteResultConstructor(selected, onCopiedBytes
        ? count => onCopiedBytes(count * (Constructor as any).BYTES_PER_ELEMENT) : undefined) };
    }});
    return view;
  }
  function collectionInitialize(result: object, iterable: unknown, isMap: boolean): void {
    if (iterable != null) {
      const adder = get(ref(result, isMap ? 'set' : 'add'));
      if (typeof adder !== 'function') throw new TypeError('Invalid collection adder');
      consumeIterator(consumerIteratorOpen(iterable), item => {
        if (isMap) {
          entryObject(item);
          invoke(adder, result, [get(ref(item, '0')), get(ref(item, '1'))]);
        } else invoke(adder, result, [item]);
      });
    }
  }
  /** For native algorithms that synchronously consume an iterable. Keep all
   * original getters lazy, retaining their specified order relative to other
   * arguments. This adapter is never returned or stored as instance state. */
  function nativeIterable(value: unknown): Iterable<unknown> {
    return { [Symbol.iterator]() {
      return nativeIterator(consumerIteratorOpen(value));
    } };
  }
  function consumerIteratorOpen(value: unknown): IteratorRecord {
    rejectPrimitiveIterable(value);
    const method = get(ref(value, Symbol.iterator));
    if (typeof method !== 'function') {
      // The method has already been read from the original exactly once.
      // Preserve the original value category in V8's failure without reading
      // the authored iterator getter again.
      const invalidSource = typeof value === 'function' ? function() {} : Object.create(null);
      construct(AggregateError, [invalidSource]);
    }
    return iteratorFromMethod(value, method);
  }
  function rejectPrimitiveIterable(value: unknown): void {
    if (value !== null && (typeof value === 'string' || typeof value === 'object' || typeof value === 'function')) return;
    // These primitives have no iterator property or author callbacks. Ask a
    // native iterable consumer for V8's own failure before guarded iteration.
    construct(AggregateError, [value]);
  }
  function nativeIterator(record: IteratorRecord, coerceElements = false): Iterator<unknown> {
    return {
      next() { const value = iteratorStep(record); return {done:record.done,value:coerceElements ? coercionInput(value, chargeNumericText) : value}; },
      return() { iteratorClose(record); return {done:true,value:undefined}; }
    };
  }
  /** Ephemeral input facade for synchronous native sequence consumers. Native
   * code selects iterable versus array-like and retains its allocation order;
   * accessors and iterator methods still receive the original source. The empty
   * proxy target avoids changing nonconfigurable source-property invariants. */
  function nativeSequence(value: unknown, coerceElements = false): object {
    return new Proxy(Object.create(null), {get(_target, key) {
      if (key === Symbol.iterator) {
        const method = get(ref(value, key));
        if (typeof method !== 'function') return method;
        return () => nativeIterator(iteratorFromMethod(value, method), coerceElements);
      }
      if (key === 'length') return toLength(get(ref(value, key)));
      hooks.tick?.();
      const element = get(ref(value, key));
      return coerceElements ? coercionInput(element, chargeNumericText) : element;
    }});
  }
  /** A synchronous native algorithm receives this view only for the duration of
   * its call. Forward with the real receiver and unwrap callback/source results;
   * no proxy is exposed to author code or retained in Context. */
  function indexedArrayReceiver(value: object, guardSpecies = false): object {
    const charge = (key: PropertyKey) => {
      if (typeof key === 'string' && key !== '' && Number.isSafeInteger(Number(key))
        && Number(key) >= 0 && String(Number(key)) === key) hooks.tick?.();
    };
    // Preserve IsArray without making frozen source properties proxy-target
    // invariants. The native algorithm sees only this transient view; all
    // reads/writes still address the original object and its original receiver.
    return new Proxy(Array.isArray(value) ? [] : Object.create(null), {
      has(_target, key) { charge(key); return has(key, value); },
      get(_target, key) {
        charge(key);
        if (guardSpecies && key === 'constructor') return guardedArrayConstructor(value);
        const field = get(ref(value, key));
        return key === 'length' ? toLength(field) : field;
      },
      set(_target, key, item) { charge(key); set(ref(value, key), item); return true; },
      deleteProperty(_target, key) { charge(key); return remove(ref(value, key)); }
    });
  }
  function consumeIterator(record: IteratorRecord, consume: (value: any, index: number) => void, limit = Infinity): void {
    try {
      for (let index = 0; ; index++) {
        if (index >= limit) throw new TypeError('Iterator input is too large');
        const value = iteratorStep(record);
        if (record.done) return;
        consume(value, index);
      }
    } catch (error) {
      iteratorClose(record, true);
      throw error;
    }
  }
  function arrayLike(value: any): any[] {
    // Reflect.apply uses CreateListFromArrayLike, not the iterable protocol.
    if (value === null || typeof value !== 'object' && typeof value !== 'function') {
      // This path has no authored property reads. Let the same V8 abstract
      // operation supply the diagnostic shared by apply and construct.
      apply(() => {}, undefined, value as any);
      throw new TypeError('Invalid argument list');
    }
    // Borrowing Array#slice here would introduce an unrelated species call.
    const length = toLength(get(ref(value, 'length')));
    const values: any[] = [];
    for (let index = 0; index < length; index++) {
      hooks.tick?.();
      values.push(get(ref(value, String(index))));
    }
    return values;
  }
  function toLength(value: any): number {
    const primitive = toPrimitive(value, 'number');
    chargeNumericText(primitive);
    const number = +primitive;
    return Number.isNaN(number) || number <= 0 ? 0 : Math.min(Math.floor(number), Number.MAX_SAFE_INTEGER);
  }
  function defineElement(target: any[], key: number, value: any): void {
    defineOwn(target, key, { value, writable: true, enumerable: true, configurable: true });
  }
  function toInteger(value: any): number {
    const primitive = toPrimitive(value, 'number');
    chargeNumericText(primitive);
    const number = +primitive;
    return Number.isNaN(number) ? 0 : Math.trunc(number);
  }
  function relativeIndex(value: any, length: number): number {
    const integer = toInteger(value);
    return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length);
  }
  function stringValue(value: any): string {
    // Abstract ToString rejects a primitive Symbol, unlike String(symbol).
    value = toPrimitive(value, 'string');
    if (typeof value === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
    return String(value);
  }
  function descriptor(value: any): PropertyDescriptor {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') {
      // Validation has reached ToPropertyDescriptor. The synthetic target and
      // key cannot invoke author code or change the original target.
      apply(Object.defineProperty, Object, [{}, 'value', value]);
      throw new TypeError('Property description must be an object');
    }
    const result: any = Object.create(null);
    for (const key of ['enumerable', 'configurable', 'value', 'writable', 'get', 'set']) {
      if (!has(key, value)) continue;
      const field = get(ref(value, key));
      if (key === 'get' || key === 'set') {
        if (field !== undefined && typeof field !== 'function') {
          apply(Object.defineProperty, Object, [{}, 'value', {[key]: field}]);
          throw new TypeError('Accessor is not callable');
        }
        accessor(field, key);
      }
      result[key] = key === 'enumerable' || key === 'configurable' || key === 'writable' ? Boolean(field) : field;
    }
    if (hasOwn(result, 'get') || hasOwn(result, 'set')) {
      if (hasOwn(result, 'value') || hasOwn(result, 'writable')) {
        // All authored fields have already been read in order. Native V8 sees
        // their cached values through a private facade, preserving the source
        // prototype in its diagnostic without reading any getter twice.
        const target = Object.create(diagnosticPrototype(value));
        const facade = new Proxy(target, {
          has(_target, key) { return hasOwn(result, key); },
          get(_target, key) { return result[key]; },
        });
        apply(Object.defineProperty, Object, [{}, 'value', facade]);
        throw new TypeError('Invalid mixed property descriptor');
      }
    }
    return result;
  }
  function descriptors(value: any): object {
    if (value === null || value === undefined) {
      apply(Object.defineProperties, Object, [{}, value]);
      throw new TypeError('Cannot convert descriptor table to object');
    }
    const table = Object(value);
    const result = Object.create(null);
    for (const key of ownKeys(table)) {
      hooks.tick?.();
      const field = ownDescriptor(table, key);
      if (!field) continue;
      if (!field.enumerable) continue;
      defineOwn(result, key, { value: descriptor(get(ref(table,key))), enumerable: true });
    }
    return result;
  }
  // Source member references retain the evaluated key value. V8 performs
  // coercion on each read/write, after RHS evaluation for a simple write.
  // Intrinsic algorithms still use ref() when their contract captures a key.
  function memberReference(object: any, key: any): Reference {
    admittedValue(object);
    return { object, key };
  }
  function resolveReference(reference: Reference): Reference {
    // Native property operations reject nullish receivers without coercing keys.
    if (reference.object == null || reference.captured) return reference;
    if (typeof reference.key === 'string') { chargeTextWork(reference.key.length); return reference; }
    if (typeof reference.key === 'symbol') return reference;
    return ref(reference.object, reference.key);
  }
  function ref(object: any, key: any): Reference {
    admittedValue(object);
    return { object, key: propertyKey(key), captured: true };
  }
  function propertyKey(value: any): PropertyKey {
    const primitive = toPrimitive(value, 'string');
    chargeBigIntWork(primitive);
    chargeNumericText(primitive);
    return typeof primitive === 'symbol' ? primitive : String(primitive);
  }
  function objectRest(source: any, excluded: PropertyKey[]): object {
    if (source === null || source === undefined) throw new TypeError('Cannot destructure null or undefined');
    return copyProperties(allocation({}), source, excluded);
  }
  function objectSpread(target: object, source: any): object {
    writable(target);
    return source === null || source === undefined ? target : copyProperties(target, source, []);
  }
  function copyProperties(result: object, source: any, excluded: PropertyKey[]): object {
    if (objectStorage(excluded)) excluded = arrayLike(excluded);
    admittedValue(source);
    const object = Object(source);
    // CopyDataProperties captures all keys before any property getter runs.
    // Descriptors are checked immediately before each read; getters can delete
    // later properties or change their enumerability.
    for (const key of ownKeys(object)) {
      hooks.tick?.();
      if (excluded.includes(key)) continue;
      const descriptor = ownDescriptor(object, key);
      if (!descriptor?.enumerable) continue;
      const value = get(ref(object, key));
      defineOwn(result, key, { value, writable: true, enumerable: true, configurable: true });
    }
    return result;
  }
  function nameFunction(fn: Function, name: string): Function {
    writable(fn);
    chargeTextWork(name.length);
    defineOwn(fn, 'name', { value: name, configurable: true });
    return fn;
  }
  function nameClass(fn: Function, name: PropertyKey): Function {
    // Called first in static initialization. Class methods have already been
    // installed: data methods are writable, accessors have no writable field.
    // Only SetFunctionName's nonwritable data property remains ours to restore.
    if (ownDescriptor(fn, 'name')?.writable === false) nameFunction(fn,
      typeof name === 'symbol' ? name.description === undefined ? '' : '[' + name.description + ']' : String(name));
    return fn;
  }
  function classCall(newTarget: unknown): void {
    if (newTarget === undefined) throw new TypeError('Class constructor requires new');
  }
  function arrayAppend(target: any[], value: unknown): void {
    defineOwn(target, get(ref(target, 'length')), { value, writable: true, enumerable: true, configurable: true });
  }
  function arrayHole(target: any[]): void { set(ref(target, 'length'), increment(get(ref(target, 'length')), 1).value); }
  type IteratorRecord = { iterator: object; next: unknown; done: boolean };
  function iteratorStageObject(value: any, stage: 'method' | 'next'): object {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) return value;
    // Reproduce the target V8 completion for this iterator protocol stage.
    // The original callback has already run; the synthetic iterator contains
    // only private functions and the primitive result, so it cannot rerun it.
    const source = stage === 'method'
      ? { [Symbol.iterator]() { return value; } }
      : { [Symbol.iterator]() { return { next() { return value; } }; } };
    construct(AggregateError, [source]);
    throw new TypeError('Iterator result is not an object');
  }
  function invalidIteratorNext(value: unknown): never {
    const source = { [Symbol.iterator]() { return { next: value }; } };
    construct(AggregateError, [source]);
    throw new TypeError('Iterator next is not callable');
  }
  function entryObject(value: any): object {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') {
      // A fresh one-element intrinsic array reproduces AddEntriesFromIterable's
      // guaranteed failure without reading the author's iterator twice.
      return apply(Object.fromEntries, Object, [[value]]);
    }
    return value;
  }
  function lexicalCreate(mutable: boolean): LexicalBinding { return internalRecord('LexicalBinding', { initialized: false, mutable, value: undefined }); }
  function lexicalInitialize(binding: LexicalBinding, value: unknown): unknown {
    if (binding.initialized) throw new Error('Lexical binding initialized twice');
    binding.value = value; binding.initialized = true; return value;
  }
  function lexicalRead(binding: LexicalBinding): any {
    if (!binding.initialized) throw new ReferenceError('Cannot access uninitialized binding');
    return binding.value;
  }
  function lexicalWrite(binding: LexicalBinding, value: unknown): unknown {
    if (!binding.initialized) throw new ReferenceError('Cannot access uninitialized binding');
    if (!binding.mutable) throw new TypeError('Assignment to constant variable.');
    binding.value = value; return value;
  }
  function lexicalReferenceRead(this: { binding: LexicalBinding }): unknown { return lexicalRead(this.binding); }
  function lexicalReferenceWrite(this: { binding: LexicalBinding }, value: unknown): void { lexicalWrite(this.binding, value); }
  function lexicalReference(binding: LexicalBinding): object {
    return defineOwn({ binding }, 'value', { get: lexicalReferenceRead, set: lexicalReferenceWrite });
  }
  function lexicalCopy(binding: LexicalBinding): LexicalBinding { return internalRecord('LexicalBinding', { initialized: binding.initialized, mutable: binding.mutable, value: binding.value }); }
  function lexicalUpdate(binding: LexicalBinding, delta: 1 | -1, prefix: boolean): unknown {
    const result = increment(lexicalRead(binding), delta);
    lexicalWrite(binding, result.value); return prefix ? result.value : result.old;
  }
  function immutableWrite(value: unknown, strict: boolean): unknown {
    if (strict) throw new TypeError('Assignment to constant variable.');
    return value;
  }
  function immutableUpdate(value: unknown, delta: 1 | -1, prefix: boolean, strict: boolean): unknown {
    const result = increment(value, delta);
    immutableWrite(result.value, strict);
    return prefix ? result.value : result.old;
  }
  function uninitializedBinding(): never { throw new ReferenceError('Cannot access uninitialized binding'); }
  function uninitializedCell(): object {
    return defineOwn({}, 'value', { get: uninitializedBinding, set: uninitializedBinding });
  }
  function iteratorOpen(value: unknown): IteratorRecord {
    return iteratorFromMethod(value, get(ref(value, Symbol.iterator)));
  }
  function iteratorFromMethod(value: unknown, method: unknown): IteratorRecord {
    const iterator = iteratorStageObject(invoke(method, value, []), 'method');
    return internalRecord('IteratorRecord', { iterator, next: get(ref(iterator, 'next')), done: false });
  }
  function iteratorStep(record: IteratorRecord, readValue = true): unknown {
    if (record.done) return undefined;
    hooks.tick?.();
    // Failed next/done/value operations finish this record: destructuring does
    // not subsequently close it. Defaults and bindings run after this returns.
    record.done = true;
    const next = record.next;
    if (typeof next !== 'function') invalidIteratorNext(next);
    // Exact runtime-owned iterators can produce a private, immediately consumed
    // result. Authored next methods and exposed next() results keep the general
    // operation path, including their getters and branch-owned result objects.
    const direct = hooks.iteratorResult?.(next, record.iterator);
    if (direct !== undefined) {
      if (direct.done) return undefined;
      const value = readValue ? admittedValue(direct.value) : undefined;
      record.done = false;
      return value;
    }
    const result = iteratorStageObject(invoke(next, record.iterator, []), 'next');
    if (get(ref(result, 'done'))) return undefined;
    const value = readValue ? get(ref(result, 'value')) : undefined;
    record.done = false;
    return value;
  }
  function iteratorClose(record: IteratorRecord, throwing = false): void {
    if (record.done) return;
    record.done = true;
    try {
      const method = get(ref(record.iterator, 'return'));
      if (method == null) return;
      iteratorStageObject(invoke(method, record.iterator, []), 'next');
    } catch (error) {
      // The enclosing generated catch retains and rethrows the original error.
      if (!throwing) throw error;
    }
  }
  function iteratorPush(stack: IteratorRecord[], value: unknown): IteratorRecord {
    const record = iteratorOpen(value);
    arrayAppend(stack, record);
    return record;
  }
  function iteratorFinish(stack: IteratorRecord[], record: IteratorRecord): void {
    const length = ownDescriptor(stack, 'length')!.value;
    if (ownDescriptor(stack, String(length - 1))?.value !== record) throw new Error('Invalid iterator region nesting');
    defineOwn(stack, 'length', {value:length - 1});
    iteratorClose(record);
  }
  function iteratorDrain(stack: IteratorRecord[], depth: number, throwing: boolean): void {
    let failed = throwing, error: unknown;
    while (ownDescriptor(stack, 'length')!.value > depth) {
      const length = ownDescriptor(stack, 'length')!.value;
      const record = ownDescriptor(stack, String(length - 1))!.value;
      defineOwn(stack, 'length', {value:length - 1});
      try { iteratorClose(record, failed); }
      catch (caught) { failed = true; error = caught; }
    }
    if (!throwing && failed) throw error;
  }
  function iteratorRest(record: IteratorRecord): unknown[] {
    const values: unknown[] = allocation([]);
    while (!record.done) {
      const value = iteratorStep(record);
      if (!record.done) arrayAppend(values, value);
    }
    return values;
  }
  function arraySpread(target: any[], value: unknown): void {
    const record = iteratorOpen(value);
    while (!record.done) {
      const value = iteratorStep(record);
      if (!record.done) arrayAppend(target, value);
    }
  }
  function superConstructor(constructor: Function): unknown {
    return prototypeOf(constructor);
  }
  function superApply(fn: Function, receiver: unknown, args: unknown): unknown {
    return invoke(fn, receiver, arrayLike(args));
  }
  function superProperty(home: any, key: unknown, receiver: unknown, flags = 0): unknown {
    const target = flags & 1 ? get(ref(home, 'prototype')) : home;
    const method = invoke(Reflect.get, undefined, [prototypeOf(target), key, receiver]);
    // The helper's call form accepts one argument-list value. Persistent bind
    // retains its target/receiver through IO without an opaque host closure.
    return flags & 2 && typeof method === 'function'
      ? invoke(Function.prototype.bind, superApply, [undefined, method, receiver]) : method;
  }
  function superConstruct(constructor: unknown, args: unknown, newTarget: unknown, thisBinding: { initialized: boolean }): unknown {
    const result = create(constructor, arrayLike(args), newTarget);
    // BindThisValue occurs after Construct; a duplicate super call still runs
    // the base constructor but must not replace this or initialize fields again.
    if (get(ref(thisBinding,'initialized'))) throw new ReferenceError('Derived this is already initialized');
    set(ref(thisBinding,'initialized'),true);
    return result;
  }
  function nameMethod(fn: Function, key: PropertyKey, kind: 'method' | 'get' | 'set'): Function {
    const name = typeof key === 'symbol' ? key.description === undefined ? '' : '[' + key.description + ']' : String(key);
    return nameFunction(fn, kind === 'method' ? name : kind + ' ' + name);
  }
  function defineMethod(object: object, key: PropertyKey, fn: Function, kind: 'method' | 'get' | 'set'): void {
    writable(object);
    nameMethod(fn, key, kind);
    const descriptor = kind === 'method' ? { value: fn, writable: true } : { [kind]: fn };
    defineOwn(object, key, { ...descriptor, enumerable: true, configurable: true });
  }
  function literalProperty(object: object, key: PropertyKey, value: unknown): void {
    writable(object);
    defineOwn(object, key, {value, writable: true, enumerable: true, configurable: true});
  }
  function literalPrototype(object: object, value: unknown): void {
    writable(object);
    if (value === null || typeof value === 'object' || typeof value === 'function') {
      chargePrototypeMutation(object,value);
      setPrototype(object, value);
    }
  }
  function chargePrototypeMutation(target: unknown, prototype: unknown): void {
    if (target === null || typeof target !== 'object' && typeof target !== 'function'
      || prototype === null || typeof prototype !== 'object' && typeof prototype !== 'function') return;
    if (types.isProxy(target) || prototypeOf(target) === prototype || !extensible(target)) return;
    // V8 must check the proposed chain for a cycle. Account for long ordinary
    // chains before it mutates the target, without invoking Proxy traps twice.
    let links=0,cursor: object | null=prototype;
    while (cursor !== null && cursor !== target && !types.isProxy(cursor)) {
      cursor=prototypeOf(cursor);
      if (cursor !== null && ++links % 16 === 0) hooks.tick?.();
    }
  }
  function chargePropertyLookup(value: unknown, key: PropertyKey): void {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') return;
    // Most game-state reads hit an own property and pay no additional scan.
    // A missing/inherited property makes V8 traverse the prototype chain.
    // Charge one unit per 16 links; shallow built-in prototype chains retain
    // the ordinary operation cost. Stop before a Proxy so its observable traps
    // run only in the real lookup.
    let links=0;
    for (let cursor: object | null = value; cursor !== null && !types.isProxy(cursor);) {
      if (hasOwn(cursor,key)) return;
      cursor = prototypeOf(cursor);
      if (cursor !== null && ++links % 16 === 0) hooks.tick?.();
    }
  }
  // Hints contain only numeric positions, never object identities or values.
  // The heap validates the current branch's property key before using a hint.
  const fixedReadSlots: {key: PropertyKey; cache: PropertyReadCache}[] = [];
  // Object.prototype is already protected by writable(); arbitrary native or
  // authored prototype objects do not acquire an immutability exemption.
  const immutablePrototype = (value: object) => value === Object.prototype;
  function getFixed(object: unknown, key: string, site: number): any {
    let entry = fixedReadSlots[site];
    if (!entry || entry.key !== key) fixedReadSlots[site] = entry = {key, cache: {slots: [], immutablePrototype}};
    return get(memberReference(object, key), entry.cache);
  }
  function get(reference: Reference, cache?: PropertyReadCache): any {
    reference = resolveReference(reference);
    const indexed = memoryIndex(reference.object, reference.key);
    if (indexed) return admittedValue(indexed.storage.readElement(reference.object, indexed.index));
    if (memoryStorage(reference.object)) {
      for (let current = reference.object; current !== null; current = prototypeOf(current)) {
        const descriptor = ownDescriptor(current, reference.key);
        if (!descriptor) continue;
        if (descriptor.get && memoryAccessors.has(descriptor.get)) return invoke(descriptor.get, reference.object, []);
        break;
      }
    }
    const storage = objectStorage(reference.object);
    if (storage) return admittedValue(storage.get(reference.object, reference.key, reference.object,
      (fn, receiver, args) => { accessor(fn, 'get'); return invoke(fn, receiver, args); }, cache));
    const debugStack=defaultDebugStack(reference.object,reference.key);
    if(debugStack && writtenDebugStacks.has(debugStack))return admittedValue(writtenDebugStacks.get(debugStack));
    chargePropertyLookup(reference.object,reference.key);
    checkPropertyAccessor(reference, 'get');
    if ((reference.key === 'flags' || reference.key === 'size') && reference.object !== null &&
      (typeof reference.object === 'object' || typeof reference.object === 'function')) {
      for (let cursor: object | null = reference.object; cursor !== null; cursor = prototypeOf(cursor)) {
        const descriptor = ownDescriptor(cursor, reference.key);
        if (!descriptor) continue;
        if (descriptor.get === regexpFlags || descriptor.get && collectionSizeGetters.has(descriptor.get)) return invoke(descriptor.get!, reference.object, []);
        break;
      }
    }
    return admittedValue(reference.object[reference.key]);
  }
  function set(reference: Reference, value: any, strict = true): any {
    reference = resolveReference(reference);
    const indexed = memoryIndex(reference.object, reference.key);
    if (indexed) {
      writable(reference.object);
      const item = toPrimitive(value, 'number'); chargeNumericText(item);
      indexed.storage.writeElement(reference.object, indexed.index, item);
      return value;
    }
    const storage = objectStorage(reference.object);
    if (storage) {
      writable(reference.object);
      const written = storage.set(reference.object, reference.key, value, reference.object,
        (fn, receiver, args) => { accessor(fn, 'set'); return invoke(fn, receiver, args); }, value => numericUnary('+', value));
      if (!written && strict) throw new TypeError('Cannot assign to property');
      return value;
    }
    const debugStack=defaultDebugStack(reference.object,reference.key);
    writable(reference.object);
    chargePropertyLookup(reference.object,reference.key);
    checkPropertyAccessor(reference, 'set');
    if(strict||reference.object===null||reference.object===undefined)reference.object[reference.key] = value;
    else Reflect.set(Object(reference.object),reference.key,value,reference.object);
    if(debugStack)writtenDebugStacks.set(debugStack,value);
    return value;
  }
  function checkPropertyAccessor(reference: Reference, kind: 'get' | 'set'): void {
    // Most properties cannot name an excluded intrinsic accessor. This closed
    // key set avoids walking ordinary gameplay objects on every property read.
    if (!restrictedAccessorKeys.has(reference.key) || reference.object === null || reference.object === undefined) return;
    for (let object: object | null = Object(reference.object); object !== null; object = prototypeOf(object)) {
      const descriptor = ownDescriptor(object, reference.key);
      if (!descriptor) continue;
      accessor(descriptor[kind], kind); return;
    }
  }
  function accessor(fn: unknown, kind: 'get' | 'set'): void {
    if (typeof fn === 'function' && (binding(fn) || nativeCallbacks.has(fn))) return;
    checkAccessor(fn, kind);
  }
  function instanceOf(value: any, target: any): boolean {
    if (target === null || typeof target !== 'object' && typeof target !== 'function') throw new TypeError('Invalid instanceof target');
    const method = get(ref(target, Symbol.hasInstance));
    if (method !== null && method !== undefined) return Boolean(invoke(method, target, [value]));
    if (typeof target !== 'function') throw new TypeError('Instanceof target is not callable');
    return Boolean(invoke(Function.prototype[Symbol.hasInstance], target, [value]));
  }
  function remove(reference: Reference, strict = true): boolean {
    reference = resolveReference(reference);
    writable(reference.object);
    const indexed = memoryIndex(reference.object, reference.key);
    if (indexed) {
      const exists = indexed.storage.readElement(reference.object, indexed.index) !== undefined;
      if (exists && strict) throw new TypeError('Cannot delete property');
      return !exists;
    }
    const storage = objectStorage(reference.object);
    if (storage) {
      const removed = storage.deleteProperty(reference.object, reference.key);
      if (!removed && strict) throw new TypeError('Cannot delete property');
      return removed;
    }
    if(strict||reference.object===null||reference.object===undefined)return delete reference.object[reference.key];
    return Reflect.deleteProperty(Object(reference.object),reference.key);
  }
  function compare(operator: '==' | '!=' | '===' | '!==' | '<' | '<=' | '>' | '>=', left: any, right: any): boolean {
    if (operator === '===' || operator === '!==') {
      // Strict comparison never converts an operand, but large primitive
      // values can still require a proportional value comparison.
      chargeMaterialized(left); chargeMaterialized(right);
      return operator === '===' ? left === right : left !== right;
    }
    const object = (value: any) => value !== null && (typeof value === 'object' || typeof value === 'function');
    if (operator === '==' || operator === '!=') {
      // Two objects compare by identity; object/null/undefined comparisons do
      // not invoke conversion. Only an object paired with another primitive
      // type reaches ToPrimitive. The native primitive comparison handles the
      // Number/BigInt/String/Boolean/Symbol rules without approximating them.
      const leftObject = object(left), rightObject = object(right);
      if (leftObject && !rightObject && right !== null && right !== undefined) left = toPrimitive(left);
      else if (rightObject && !leftObject && left !== null && left !== undefined) right = toPrimitive(right);
      chargeMaterialized(left); chargeMaterialized(right);
      const equal = left == right;
      return operator === '==' ? equal : !equal;
    }
    // Even > and <= convert source operands from left to right; the spec's
    // internal operand reversal is paired with LeftFirst=false.
    left = toPrimitive(left, 'number'); right = toPrimitive(right, 'number');
    chargeMaterialized(left); chargeMaterialized(right);
    switch (operator) {
      case '<': return left < right;
      case '<=': return left <= right;
      case '>': return left > right;
      case '>=': return left >= right;
    }
  }
  function has(key: any, object: any): boolean {
    if (object === null || typeof object !== 'object' && typeof object !== 'function') throw new TypeError('Invalid in target');
    const name=propertyKey(key);
    const indexed = memoryIndex(object, name);
    if (indexed) return indexed.storage.readElement(object, indexed.index) !== undefined;
    const storage = objectStorage(object);
    if (storage) return storage.hasProperty(object, name);
    chargePropertyLookup(object,name);
    return name in object;
  }
  function add(left: any, right: any): any {
    left = toPrimitive(left); right = toPrimitive(right);
    chargeBigIntWork(left); chargeBigIntWork(right);
    return chargeMaterialized(left + right);
  }
  function toPrimitive(value: any, hint: 'number' | 'string' | 'default' = 'default'): any {
    const primitive = (item: any) => item === null || typeof item !== 'object' && typeof item !== 'function';
    if (!primitive(value)) {
      const receiver = value, exotic = get(ref(receiver, Symbol.toPrimitive));
      if (exotic != null) {
        if (typeof exotic !== 'function') invalidExoticMethod(exotic);
        value = invoke(exotic, receiver, [hint]);
        if (!primitive(value)) throw new TypeError('Cannot convert object to primitive value');
      } else value = ordinaryToPrimitive(receiver, hint);
    }
    return value;
  }
  function invalidExoticMethod(exotic: unknown): never {
    // No authored callback is reachable from this fresh operand. V8 supplies
    // its own noncallable-method diagnostic after the original getter ran once.
    +({[Symbol.toPrimitive]: exotic} as any);
    throw new TypeError('Symbol.toPrimitive is not callable');
  }
  function ordinaryToPrimitive(receiver: object, hint: 'number' | 'string' | 'default'): unknown {
    for (const key of hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString']) {
      const method = get(ref(receiver, key));
      if (typeof method !== 'function') continue;
      const value = invoke(method, receiver, []);
      if (value === null || typeof value !== 'object' && typeof value !== 'function') return value;
    }
    throw new TypeError('Cannot convert object to primitive value');
  }
  function numericValue(value: any): any {
    const primitive = toPrimitive(value, 'number');
    chargeNumericText(primitive);
    chargeBigIntWork(primitive);
    return typeof primitive === 'bigint' ? primitive : +primitive;
  }
  function numericUnary(operator: '+' | '-' | '~', value: any): any {
    if (operator === '+') {
      const primitive = toPrimitive(value, 'number');
      chargeNumericText(primitive);
      return +primitive;
    }
    const number = numericValue(value);
    return chargeMaterialized(operator === '-' ? -number : ~number);
  }
  function numericBinary(operator: '-' | '*' | '/' | '%' | '**' | '<<' | '>>' | '>>>' | '&' | '|' | '^', left: any, right: any): any {
    // Finish left ToNumeric before right conversion, including a Symbol error.
    const a = numericValue(left), b = numericValue(right);
    let result: any;
    switch (operator) {
      case '-': result = a - b; break;
      case '*': result = a * b; break;
      case '/': result = a / b; break;
      case '%': result = a % b; break;
      case '**': result = a ** b; break;
      case '<<': result = a << b; break;
      case '>>': result = a >> b; break;
      case '>>>': result = a >>> b; break;
      case '&': result = a & b; break;
      case '|': result = a | b; break;
      case '^': result = a ^ b; break;
    }
    return chargeMaterialized(result);
  }
  function increment(value: any, delta: 1 | -1): { old: any; value: any } {
    value = toPrimitive(value, 'number');
    chargeNumericText(value);
    chargeBigIntWork(value);
    const old = delta === 1 ? value++ : value--;
    chargeMaterialized(value);
    return { old, value };
  }
  function update(reference: Reference, delta: 1 | -1, prefix: boolean, strict = true): any {
    const result = increment(get(reference), delta);
    set(reference, result.value,strict);
    return prefix ? result.value : result.old;
  }
  const operations = Object.freeze({ originalNewTarget, forInKeys, allocation, globalRead: globalEnvironment.readName, globalTarget, globalReferenceRead, globalReferenceWrite, globalReference: globalEnvironment.reference, globalGet: globalEnvironment.get, globalSet: globalEnvironment.set, globalTypeof: globalEnvironment.typeOf, nativeEntry, rememberSource, rememberObjectSources, numericUnary, numericBinary, comparisonValue, compare, has, add, collectionInitialize, moduleNamespace: hooks.namespace ?? createNamespaceRegistry().create, lexicalReference, lexicalReferenceRead, lexicalReferenceWrite, immutableWrite, immutableUpdate, lexicalCreate, lexicalInitialize, lexicalRead, lexicalWrite, lexicalCopy, lexicalUpdate, memberReference, ref, get, getFixed, set, remove, update, increment, invoke, instanceOf, propertyKey, toPrimitive, objectRest, objectSpread, literalProperty, literalPrototype, defineMethod, nameFunction, nameClass, nameMethod, classCall, arrayAppend, arrayHole, arraySpread, iteratorOpen, consumerIteratorOpen, iteratorStep, iteratorClose, iteratorPush, iteratorFinish, iteratorDrain, iteratorRest, uninitializedBinding, uninitializedCell, superConstructor, superConstruct, superProperty, superApply, isConstructor, construct: create });
  protectIntrinsics(operations);
  return operations;
}
