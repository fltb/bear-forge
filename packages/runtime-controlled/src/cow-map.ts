import {CowIdentityStore} from './cow-identities.ts';
import {CowStore} from './cow-store.ts';

// Runtime bookkeeping must retain native ephemeron storage even when the
// language global exposes the controlled WeakMap constructor.
const NativeWeakMap = WeakMap;

type Entry<V> = {key: unknown; value: V; order: number};
type Node<V> = {entry: Entry<V>; left: Node<V> | undefined; right: Node<V> | undefined; height: number};
type Identities = {ids: WeakMap<WeakKey, number>; next: number};
const noTick = () => {};
const height = <V>(node?: Node<V>): number => node?.height ?? 0;
function node<V>(entry: Entry<V>, left?: Node<V>, right?: Node<V>): Node<V> {
  return {entry, left, right, height: 1 + Math.max(height(left), height(right))};
}
function balance<V>(entry: Entry<V>, left?: Node<V>, right?: Node<V>): Node<V> {
  if (height(left) > height(right) + 1) {
    const top = left!;
    if (height(top.left) >= height(top.right)) return node(top.entry, top.left, node(entry, top.right, right));
    const pivot = top.right!;
    return node(pivot.entry, node(top.entry, top.left, pivot.left), node(entry, pivot.right, right));
  }
  if (height(right) > height(left) + 1) {
    const top = right!;
    if (height(top.right) >= height(top.left)) return node(top.entry, node(entry, left, top.left), top.right);
    const pivot = top.left!;
    return node(pivot.entry, node(entry, left, pivot.left), node(top.entry, pivot.right, top.right));
  }
  return node(entry, left, right);
}
function rank(value: unknown): number {
  if (value === undefined) return 0;
  if (value === null) return 1;
  switch (typeof value) {
    case 'boolean': return 2;
    case 'number': return 3;
    case 'bigint': return 4;
    case 'string': return 5;
    case 'symbol': return Symbol.keyFor(value) === undefined ? 7 : 6;
    default: return 8;
  }
}
/** Persistent SameValueZero map with a separate insertion-order index.
 * Balanced lookup copies O(log n) nodes per edit; fork shares both roots.
 * Key ordering never coerces author objects. Identity metadata is weak, so
 * deleting an object key does not retain it outside surviving branch roots.
 */
export class CowMap<V> {
  private root: Node<V> | undefined;
  private ordered = new CowStore<Entry<V>>();
  private sequence = 0;
  private identities: Identities;
  constructor(identities: Identities = {ids: new NativeWeakMap(), next: 0}) { this.identities = identities; }
  get size(): number { return this.ordered.size; }
  private identity(value: WeakKey): number {
    let id = this.identities.ids.get(value);
    if (id === undefined) {id = this.identities.next++; this.identities.ids.set(value, id);}
    return id;
  }
  private compare(a: any, b: any, tick: () => void): number {
    tick();
    if (typeof a === 'string' && typeof b === 'string') {
      for (let remaining = Math.min(a.length, b.length); remaining >= 1024; remaining -= 1024) tick();
    }
    if (a === b || typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b)) return 0;
    const ar = rank(a), br = rank(b);
    if (ar !== br) return ar - br;
    if (ar === 3) {
      if (Number.isNaN(a)) return 1;
      if (Number.isNaN(b)) return -1;
    }
    if (ar === 6) {a = Symbol.keyFor(a); b = Symbol.keyFor(b);}
    if (ar >= 7) {a = this.identity(a); b = this.identity(b);}
    return a < b ? -1 : 1;
  }
  private find(key: unknown, tick = noTick): Entry<V> | undefined {
    let current = this.root;
    while (current) {
      const order = this.compare(key, current.entry.key, tick);
      if (!order) return current.entry;
      current = order < 0 ? current.left : current.right;
    }
    return undefined;
  }
  has(key: unknown, tick = noTick): boolean { return this.find(key, tick) !== undefined; }
  get(key: unknown, tick = noTick): V | undefined { return this.find(key, tick)?.value; }
  set(key: unknown, value: V, tick = noTick): this {
    if (key === 0) key = 0; // Map iteration canonicalizes -0.
    const previous = this.find(key, tick);
    if (!previous && this.sequence === Number.MAX_SAFE_INTEGER) throw new RangeError('Collection insertion index exhausted');
    const entry = {key, value, order: previous?.order ?? this.sequence};
    const insert = (current?: Node<V>): Node<V> => {
      if (!current) return node(entry);
      const order = this.compare(key, current.entry.key, tick);
      if (!order) return node(entry, current.left, current.right);
      return order < 0 ? balance(current.entry, insert(current.left), current.right)
        : balance(current.entry, current.left, insert(current.right));
    };
    this.root = insert(this.root); this.ordered.set(entry.order, entry);
    if (!previous) this.sequence++;
    return this;
  }
  delete(key: unknown, tick = noTick): boolean {
    const previous = this.find(key, tick);
    if (!previous) return false;
    const remove = (current: Node<V>, target: unknown): Node<V> | undefined => {
      const order = this.compare(target, current.entry.key, tick);
      if (order < 0) return balance(current.entry, remove(current.left!, target), current.right);
      if (order > 0) return balance(current.entry, current.left, remove(current.right!, target));
      if (!current.left) return current.right;
      if (!current.right) return current.left;
      let successor = current.right;
      while (successor.left) successor = successor.left;
      return balance(successor.entry, current.left, remove(current.right, successor.entry.key));
    };
    this.root = remove(this.root!, key); this.ordered.delete(previous.order);
    return true;
  }
  clear(): void { this.root = undefined; this.ordered.clear(); }
  fork(): CowMap<V> {
    const branch = new CowMap<V>(this.identities);
    branch.root = this.root; branch.ordered = this.ordered.fork(); branch.sequence = this.sequence;
    return branch;
  }
  snapshot(): {sequence: number; entries: [number, unknown, V][]} {
    return {sequence: this.sequence, entries: Array.from(this.ordered.entries(), ([order, entry]) => [order, entry.key, entry.value])};
  }
  restore(entries: Iterable<[number, unknown, V]>, sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError('Invalid collection sequence');
    const restored = new CowMap<V>(this.identities); let previous = -1;
    for (const [order, key, value] of entries) {
      if (!Number.isSafeInteger(order) || order <= previous || order >= sequence || restored.has(key)) throw new TypeError('Invalid collection entry');
      restored.sequence = order; restored.set(key, value); previous = order;
    }
    this.root = restored.root; this.ordered = restored.ordered; this.sequence = sequence;
  }
  next(cursor: number): {key: unknown; value: V; cursor: number} | undefined {
    const item = this.ordered.entries(cursor).next().value;
    if (!item) return undefined;
    const [, entry] = item;
    return {key: entry.key, value: entry.value, cursor: entry.order + 1};
  }
  *entries(): IterableIterator<[unknown, V]> {
    for (const [, entry] of this.ordered.entries()) yield [entry.key, entry.value];
  }
}

/** Branch registry for native Map/Set brand identities. Native contents are
 * an admission baseline only; subsequent methods use the active indexed data.
 */
export class CowCollections {
  private records = new CowIdentityStore<CowMap<unknown>>();
  private identities: {ids: WeakMap<object, number>; next: number};
  constructor(identities = {ids: new NativeWeakMap<object, number>(), next: 0}) {this.identities = identities;}
  data(table: object, isMap: boolean, write = false, tick: () => void = () => {}): CowMap<unknown> {
    // Intrinsic getters validate the brand without invoking authored hooks.
    Object.getOwnPropertyDescriptor(isMap ? Map.prototype : Set.prototype, 'size')!.get!.call(table);
    let id = this.identities.ids.get(table);
    if (id !== undefined && !this.records.has(id, table)) throw new TypeError('Collection does not belong to this Context');
    if (id === undefined) {
      const data = new CowMap<unknown>();
      const entries = isMap ? Map.prototype.entries.call(table) : Set.prototype.entries.call(table);
      for (const [key, value] of entries) {tick(); data.set(key, value, tick);}
      // Publish only after all admission work succeeds. Clearing the brand
      // shell then releases deleted keys instead of retaining a native mirror.
      id = this.identities.next++;
      this.identities.ids.set(table, id); this.records.register(id, table); this.records.set(id, data, table);
      if (isMap) Map.prototype.clear.call(table); else Set.prototype.clear.call(table);
    }
    return write ? this.records.edit(id, data => data.fork(), table) : this.records.get(id, table)!;
  }
  fork(): CowCollections {
    const branch = new CowCollections(this.identities); branch.records = this.records.fork(); return branch;
  }
  clear(): void {this.records.clear();}
}
