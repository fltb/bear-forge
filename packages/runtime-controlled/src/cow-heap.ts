import {CowIdentityStore} from './cow-identities.ts';
import {CowStore} from './cow-store.ts';

// Runtime bookkeeping must retain native ephemeron storage even when the
// language global exposes the controlled WeakMap constructor.
const NativeWeakMap = WeakMap;

type StoredProperty = {key: PropertyKey; order: number; descriptor: PropertyDescriptor};
type ObjectState = {
  array: boolean;
  prototype: object | null;
  extensible: boolean;
  properties: CowStore<StoredProperty>;
  nextOrder: number;
};
type Identity = {id: number; keys: Map<PropertyKey, number>; nextKey: number; noNativePreparation: boolean};
type Identities = {objects: WeakMap<object, Identity>; nextId: number};
export type HeapInvoke = (fn: Function, receiver: unknown, args: unknown[]) => unknown;
const arrayLimit = 2 ** 32 - 1;
function arrayIndex(key: PropertyKey): number | undefined {
  if (typeof key !== 'string') return undefined;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < arrayLimit && String(index) === key ? index : undefined;
}

/** Ordinary object storage with stable JS identities and branch-local data.
 * No Proxy is used: non-configurable descriptors and non-extensibility belong
 * to the branch, rather than to a Proxy's shared target invariants.
 *
 * This is an internal heap, not a native-object membrane. All operations on a
 * managed identity must go through the runtime; native slots use separate
 * adapters. Static prototypes outside this heap must be protected by runtime.
 */
export class CowHeap {
  private states = new CowIdentityStore<ObjectState>();
  private identities: Identities;
  private tick: () => void;
  constructor(identities: Identities = {objects: new NativeWeakMap(), nextId: 0}, tick: () => void = () => {}) {
    this.identities = identities; this.tick = tick;
  }

  create(prototype: object | null = null): object {
    return this.allocate(Object.create(null), prototype, false);
  }
  /** Register a newly allocated runtime identity before it can be shared.
   * Internal-slot adapters retain its brand; properties live in this heap.
   * Registration is not a fork-time traversal and never follows value edges.
   */
  register<T extends object>(identity: T, prototype: object | null = Object.getPrototypeOf(identity), keys: Iterable<PropertyKey> = Reflect.ownKeys(identity)): T {
    if (this.identities.objects.has(identity)) throw new TypeError('Identity already registered');
    this.allocate(identity, prototype, Array.isArray(identity));
    const state = this.state(identity);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(identity, key)!;
      // Native own descriptors are already complete and valid. This fresh
      // record has no shared writers; revalidating on a probe object adds no
      // semantic check and allocates another object for every initial field.
      if (!descriptor) throw new TypeError('Missing property during registration');
      const slot = this.slot(identity, key, true)!;
      const previous = state.properties.get(slot);
      state.properties.set(slot, {key, order: previous?.order ?? state.nextOrder++, descriptor});
      // The native shell supplies identity/brand, not a second object graph.
      // An obsolete baseline reference must not pin a value after the logical
      // property is replaced or deleted in every surviving branch.
      if (descriptor.configurable && ('value' in descriptor
        ? descriptor.value !== null && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')
        : true)) Reflect.deleteProperty(identity, key);
      else if ('value' in descriptor && descriptor.writable && descriptor.value !== null
        && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
        // Nonconfigurable does not imply readonly (function.prototype is one
        // example). Keep its descriptor in Context and clear only the native
        // baseline reference; later branch writes must not pin its old value.
        Reflect.defineProperty(identity, key, {value: undefined});
      }
    }
    state.extensible = Object.isExtensible(identity);
    return identity;
  }
  createArray(length = 0, prototype: object | null = Array.prototype): unknown[] {
    if (!Number.isInteger(length) || length < 0 || length > arrayLimit) throw new RangeError('Invalid array length');
    const identity = this.allocate([], prototype, true) as unknown[];
    this.ordinaryDefine(identity, 'length', {value: length, writable: true, enumerable: false, configurable: false});
    return identity;
  }
  private allocate(identity: object, prototype: object | null, array: boolean): object {
    const meta = {id: this.identities.nextId++, keys: new Map<PropertyKey, number>(), nextKey: 1, noNativePreparation: false};
    this.identities.objects.set(identity, meta);
    this.states.register(meta.id, identity);
    this.states.set(meta.id, {array, prototype, extensible: true, properties: new CowStore(), nextOrder: 0}, identity);
    return identity;
  }

  has(object: object): boolean {
    const meta = this.identities.objects.get(object);
    return !!meta && this.states.has(meta.id, object);
  }
  /** Only immutable native-brand classification may be cached here. Current
   * prototypes and branch-specific internal slots must still be checked by
   * their adapters. Reuse identity metadata rather than allocating a cache. */
  nativePreparationUnneeded(object: object, mark = false): boolean {
    const meta = this.identities.objects.get(object);
    if (!meta) return false;
    if (mark) meta.noNativePreparation = true;
    return meta.noNativePreparation;
  }
  private state(object: object): ObjectState {
    const meta = this.identities.objects.get(object);
    const state = meta && this.states.get(meta.id, object);
    if (!state) throw new TypeError('Object does not belong to this Context');
    return state;
  }
  private edit(object: object): ObjectState {
    this.state(object);
    return this.states.edit(this.identities.objects.get(object)!.id, state => ({...state, properties: state.properties.fork()}), object);
  }
  private slot(object: object, key: PropertyKey, create = false): number | undefined {
    const index = arrayIndex(key);
    // Even slots are array indices; odd slots are named properties. Starting
    // names above 2^32 forced a seven-level radix path even for {value: 1}.
    // Interleaving preserves disjoint identities while keeping small objects
    // and ordinary dense arrays in shallow nodes.
    if (index !== undefined) return index * 2;
    const meta = this.identities.objects.get(object)!;
    let slot = meta.keys.get(key);
    if (slot === undefined && create) { slot = meta.nextKey; meta.nextKey += 2; meta.keys.set(key, slot); }
    return slot;
  }

  fork(): CowHeap {
    const branch = new CowHeap(this.identities, this.tick);
    branch.states = this.states.fork();
    return branch;
  }
  clear(): void { this.states.clear(); }

  private descriptor(object: object, key: PropertyKey): Readonly<PropertyDescriptor> | undefined {
    const state = this.state(object), slot = this.slot(object, key);
    return slot === undefined ? undefined : state.properties.get(slot)?.descriptor;
  }
  getOwnPropertyDescriptor(object: object, key: PropertyKey): PropertyDescriptor | undefined {
    const descriptor = this.descriptor(object, key);
    return descriptor && {...descriptor};
  }
  ownKeys(object: object): (string | symbol)[] {
    const properties = [...this.state(object).properties.entries()].map(([, property]) => property);
    const indices = properties.filter(property => arrayIndex(property.key) !== undefined)
      .sort((a, b) => arrayIndex(a.key)! - arrayIndex(b.key)!);
    const named = properties.filter(property => typeof property.key === 'string' && arrayIndex(property.key) === undefined)
      .sort((a, b) => a.order - b.order);
    const symbols = properties.filter(property => typeof property.key === 'symbol').sort((a, b) => a.order - b.order);
    return [...indices, ...named, ...symbols].map(property => property.key as string | symbol);
  }
  getPrototypeOf(object: object): object | null { return this.state(object).prototype; }
  isExtensible(object: object): boolean { return this.state(object).extensible; }
  preventExtensions(object: object): boolean { this.edit(object).extensible = false; return true; }
  setPrototypeOf(object: object, prototype: object | null): boolean {
    const state = this.state(object);
    if (state.prototype === prototype) return true;
    if (!state.extensible) return false;
    let links = 0;
    for (let parent = prototype; parent !== null; parent = this.has(parent) ? this.getPrototypeOf(parent) : Object.getPrototypeOf(parent)) {
      if (parent === object) return false;
      if (++links % 16 === 0) this.tick();
    }
    this.edit(object).prototype = prototype;
    return true;
  }

  /** descriptor must already have been converted by the guarded operation.
   * Use V8 to validate one ordinary property; never copy the full property map.
   */
  defineProperty(object: object, key: PropertyKey, descriptor: PropertyDescriptor, number: (value: any) => number = value => +value): boolean {
    if (this.state(object).array) {
      if (key === 'length') return this.defineLength(object, descriptor, number);
      const index = arrayIndex(key);
      if (index !== undefined) {
        const length = this.getOwnPropertyDescriptor(object, 'length')!;
        if (index >= length.value && !length.writable) return false;
        if (!this.ordinaryDefine(object, key, descriptor)) return false;
        if (index >= length.value) this.ordinaryDefine(object, 'length', {value: index + 1});
        return true;
      }
    }
    return this.ordinaryDefine(object, key, descriptor);
  }
  private defineLength(object: object, descriptor: PropertyDescriptor, number: (value: any) => number): boolean {
    if (!('value' in descriptor)) return this.ordinaryDefine(object, 'length', descriptor);
    // ArraySetLength performs ToUint32 then ToNumber, including two authored
    // conversions. The runtime supplies guarded conversion for managed values.
    const length = number(descriptor.value) >>> 0;
    if (length !== number(descriptor.value)) throw new RangeError('Invalid array length');
    const before = this.getOwnPropertyDescriptor(object, 'length')!;
    const next = {...descriptor, value: length};
    if (length >= before.value) return this.ordinaryDefine(object, 'length', next);
    if (!before.writable) return false;
    const readonly = next.writable === false;
    if (readonly) next.writable = true;
    if (!this.ordinaryDefine(object, 'length', next)) return false;
    const indices = this.ownKeys(object).map(arrayIndex).filter((key): key is number => key !== undefined && key >= length)
      .sort((a, b) => b - a);
    for (const index of indices) if (!this.deleteProperty(object, String(index))) {
      this.ordinaryDefine(object, 'length', {value: index + 1, ...(readonly ? {writable: false} : {})});
      return false;
    }
    if (readonly) this.ordinaryDefine(object, 'length', {writable: false});
    return true;
  }
  private ordinaryDefine(object: object, key: PropertyKey, descriptor: PropertyDescriptor): boolean {
    const previous = this.getOwnPropertyDescriptor(object, key);
    if (!previous && !this.isExtensible(object)) return false;
    const probe = Object.create(null);
    if (previous) Reflect.defineProperty(probe, key, previous);
    if (!Reflect.defineProperty(probe, key, descriptor)) return false;
    const complete = Object.getOwnPropertyDescriptor(probe, key)!;
    const state = this.edit(object), slot = this.slot(object, key, true)!;
    const old = state.properties.get(slot);
    state.properties.set(slot, {key, order: old?.order ?? state.nextOrder++, descriptor: complete});
    return true;
  }
  deleteProperty(object: object, key: PropertyKey): boolean {
    const previous = this.getOwnPropertyDescriptor(object, key);
    if (!previous) return true;
    if (!previous.configurable) return false;
    this.edit(object).properties.delete(this.slot(object, key)!);
    return true;
  }

  get(object: object, key: PropertyKey, receiver: unknown, invoke: HeapInvoke): unknown {
    this.state(object);
    const descriptor = this.lookup(object, key);
    return !descriptor ? undefined : 'value' in descriptor ? descriptor.value
      : descriptor.get ? invoke(descriptor.get, receiver, []) : undefined;
  }
  private lookup(object: object, key: PropertyKey): PropertyDescriptor | undefined {
    let links = 0;
    for (let current: object | null = object; current !== null;) {
      const managed = this.has(current);
      const descriptor = managed ? this.descriptor(current, key) : Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return descriptor;
      current = managed ? this.getPrototypeOf(current) : Object.getPrototypeOf(current);
      if (current !== null && ++links % 16 === 0) this.tick();
    }
    return undefined;
  }
  hasProperty(object: object, key: PropertyKey): boolean {
    this.state(object);
    return this.lookup(object, key) !== undefined;
  }
  set(object: object, key: PropertyKey, value: unknown, receiver: unknown, invoke: HeapInvoke, number?: (value: any) => number): boolean {
    this.state(object);
    const descriptor = this.lookup(object, key) ?? {value: undefined, writable: true, enumerable: true, configurable: true};
    if (!('value' in descriptor)) {
      if (!descriptor.set) return false;
      invoke(descriptor.set, receiver, [value]);
      return true;
    }
    if (!descriptor.writable || receiver === null || typeof receiver !== 'object' && typeof receiver !== 'function') return false;
    // An explicit receiver can be a runtime exotic (notably a module
    // namespace). Preserve its own internal methods, including TDZ reads.
    const managed = this.has(receiver);
    const existing = managed ? this.descriptor(receiver, key) : Reflect.getOwnPropertyDescriptor(receiver, key);
    if (existing && (!('value' in existing) || !existing.writable)) return false;
    if (managed && existing && !(this.state(receiver).array && key === 'length')) {
      // Ordinary Set on an existing writable data property changes only its
      // value. All descriptor checks have already passed; array length keeps
      // its conversion/truncation path below. Replace, never mutate, the
      // descriptor because another branch may still reference it.
      const state = this.edit(receiver), slot = this.slot(receiver, key)!;
      const property = state.properties.get(slot)!;
      state.properties.set(slot, {...property, descriptor: {...existing, value}});
      return true;
    }
    const replacement = existing ? {value} : {value, writable: true, enumerable: true, configurable: true};
    return managed ? this.defineProperty(receiver, key, replacement, number) : Reflect.defineProperty(receiver, key, replacement);
  }
}
