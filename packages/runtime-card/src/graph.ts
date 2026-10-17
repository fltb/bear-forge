import { types } from 'node:util';
import { CowStore } from './cow-index.ts';
import { arrayPrototypeIsPlain, retainOwned } from '../../boundary/src/values.ts';

type Value = null | undefined | boolean | string | number | bigint | { ref: number };
type Row = { array: boolean; nullPrototype: boolean; length: number; props: Record<string, Value>; pages: CowStore<Record<string, Value>> | null; exportCache?: { value: any; dense: boolean } };
type Identity = { next: number; originals: WeakMap<object, number> };
const proxies = new WeakMap<object, { graph: CardGraph<any>; id: number }>();
// Only the loader's no-projection execution may keep detached exports private.
// Public graphs always produce fresh, unbranded values.
const privateGraphs = new WeakSet<object>();
export function privateCardGraph<T>(value: T): CardGraph<T> {
  const graph = new CardGraph(value); privateGraphs.add(graph); return graph;
}
const pageWidth = 64;
const numeric = (key: string): number | undefined => {
  const n = Number(key); return Number.isInteger(n) && n >= 0 && n < 0xffffffff && String(n) === key ? n : undefined;
};
const fields = (): Record<string, Value> => Object.create(null);
const clone = (row: Row): Row => ({ ...row, props: Object.assign(fields(), row.props), pages: row.pages?.fork() ?? null });

/** Branch-local views of data identities; shared nodes contain no live proxies. */
export class CardGraph<T> {
  private rows = new CowStore<Row>();
  private identity: Identity = { next: 0, originals: new WeakMap() };
  private views = new Map<number, object>();
  private version = 0;
  private collectionAt = 2048;
  private deferCollection = false;
  private rootValue: Value;
  constructor(value: T) {
    this.rootValue = this.encode(value);
    // The complete import already encoded every alias. Subsequent computation
    // uses managed references, never retained transferred source objects.
    if (this.identity.next) this.identity.originals = new WeakMap();
  }
  get root(): T { return this.decode(this.rootValue) as T; }
  private encode(value: any): Value {
    if (value === null || ['undefined', 'boolean', 'string', 'number', 'bigint'].includes(typeof value)) return value;
    if (typeof value !== 'object') throw TypeError('Card state must contain data only');
    const view = proxies.get(value);
    if (view) {
      if (view.graph !== this) throw TypeError('Foreign card instance reference');
      return { ref: view.id };
    }
    if (types.isProxy(value)) throw TypeError('External proxy in card state');
    const known = this.identity.originals.get(value);
    if (known !== undefined && this.rows.has(known)) return { ref: known };
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (!array && proto !== null && proto !== Object.prototype) throw TypeError('Non-data card object');
    if (array && proto !== Array.prototype) throw TypeError('Non-standard card array');
    const id = this.identity.next++, row: Row = { array, nullPrototype: proto === null, length: array ? value.length : 0, props: fields(), pages: array ? new CowStore() : null };
    this.identity.originals.set(value, id); this.rows.set(id, row);
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw TypeError('Symbol card property');
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(d, 'value') || !d.enumerable) throw TypeError('Accessor or hidden card property');
      this.put(row, key, this.encode(d.value));
    }
    return { ref: id };
  }
  private get(row: Row, key: string): Value {
    const index = row.array ? numeric(key) : undefined;
    return index === undefined ? row.props[key] : row.pages!.get(Math.floor(index / pageWidth))?.[key];
  }
  private has(row: Row, key: string): boolean {
    const index = row.array ? numeric(key) : undefined;
    return Object.hasOwn(index === undefined ? row.props : row.pages!.get(Math.floor(index / pageWidth)) ?? {}, key);
  }
  private put(row: Row, key: string, value: Value): void {
    const index = row.array ? numeric(key) : undefined;
    if (index === undefined) row.props[key] = value;
    else {
      const page = Math.floor(index / pageWidth);
      if (!row.pages!.has(page)) row.pages!.set(page, fields());
      row.pages!.edit(page, value => Object.assign(fields(), value))[key] = value;
      row.length = Math.max(row.length, index + 1);
    }
  }
  private decode(value: Value): any {
    if (value === null || typeof value !== 'object') return value;
    const id = value.ref, existing = this.views.get(id); if (existing) return existing;
    const graph = this, initial = this.rows.get(id), privateExport = privateGraphs.has(this); if (!initial) throw Error('Missing card node');
    let cached = initial, at = graph.version;
    const row = () => { if (at !== graph.version) { const result = graph.rows.get(id); if (!result) throw Error('Released card node'); cached = result; at = graph.version; } return cached; };
    const proxy: any = new Proxy(initial.array ? [] : Object.create(initial.nullPrototype ? null : Object.prototype), {
      get(_target, key, receiver) {
        const current = row();
        if (current.array && key === 'length') return current.length;
        if (typeof key === 'string') {
          const value = graph.get(current, key);
          if (value !== undefined || graph.has(current, key)) return graph.decode(value);
        }
        return current.nullPrototype ? undefined : Reflect.get(current.array ? Array.prototype : Object.prototype, key, receiver);
      },
      set(_target, key, value) {
        if (typeof key !== 'string') throw TypeError('Symbol card property');
        graph.version++;
        const current = graph.rows.edit(id, clone);
        if (privateExport) delete current.exportCache;
        if (current.array && key === 'length') {
          if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw RangeError('Invalid array length');
          if (value < current.length) for (const [page, values] of current.pages!.entries()) {
            if (page * pageWidth >= value) current.pages!.delete(page);
            else if ((page + 1) * pageWidth > value) {
              const values = current.pages!.edit(page, values => Object.assign(fields(), values));
              for (const name of Object.keys(values)) if (Number(name) >= value) delete values[name];
            }
          }
          current.length = value;
        } else graph.put(current, key, graph.encode(value));
        return true;
      },
      deleteProperty(_target, key) {
        if (typeof key !== 'string' || key === 'length' && row().array) return false;
        graph.version++;
        const current = graph.rows.edit(id, clone), index = current.array ? numeric(key) : undefined;
        if (privateExport) delete current.exportCache;
        if (index === undefined) delete current.props[key];
        else { const page = Math.floor(index / pageWidth); if (current.pages!.has(page)) delete current.pages!.edit(page, values => Object.assign(fields(), values))[key]; }
        return true;
      },
      has(_target, key) { return typeof key === 'string' && (key === 'length' && row().array || graph.has(row(), key)) || !row().nullPrototype && key in (row().array ? Array.prototype : Object.prototype); },
      ownKeys() {
        const current = row(), result: string[] = [];
        if (current.array) { for (const [, values] of current.pages!.entries()) result.push(...Object.keys(values)); result.push('length'); }
        result.push(...Object.keys(current.props)); return result;
      },
      getOwnPropertyDescriptor(_target, key) {
        if (key === 'length' && row().array) return { value: row().length, writable: true, enumerable: false, configurable: false };
        if (typeof key !== 'string' || !graph.has(row(), key)) return undefined;
        return { value: graph.decode(graph.get(row(), key)), writable: true, enumerable: true, configurable: true };
      },
      defineProperty(_target, key, d): boolean {
        if (!Object.hasOwn(d, 'value') || typeof key !== 'string' || key !== 'length' && (!d.configurable || !d.enumerable || !d.writable)) throw TypeError('Card properties must be mutable data');
        return Reflect.set(proxy, key, d.value);
      },
      setPrototypeOf() { throw TypeError('Card prototype is fixed'); },
      preventExtensions() { throw TypeError('Card state cannot be frozen'); },
    });
    this.views.set(id, proxy); proxies.set(proxy, { graph: this, id }); return proxy;
  }
  own<V>(value: V): V { return this.decode(this.encode(value)); }
  export<V>(value: V): V {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') throw TypeError('Non-data export');
      return value;
    }
    const root = privateGraphs.has(this) ? proxies.get(value) : undefined;
    if (root?.graph === this && Object.getPrototypeOf(Array.prototype) === Object.prototype) return this.exportPrivate(root.id);
    const seen = new Map<object, any>();
    const ids = new Map<number, any>();
    const plainArrayBase = arrayPrototypeIsPlain();
    const encoded = (value: Value): any => value !== null && typeof value === 'object' ? node(value.ref) : value;
    const node = (id: number): any => {
      if (ids.has(id)) return ids.get(id);
      const row = this.rows.get(id); if (!row) throw Error('Missing card node');
      const out = row.array ? new Array(row.length) : Object.create(row.nullPrototype ? null : Object.prototype); ids.set(id, out);
      const inherited = row.array ? Array.prototype : Object.prototype;
      const put = (key: string, value: Value) => {
        const item = encoded(value);
        if (row.array && !plainArrayBase || !row.nullPrototype && key in inherited) Object.defineProperty(out, key, { value: item, writable: true, configurable: true, enumerable: true });
        else out[key] = item;
      };
      if (row.array) for (const [, values] of row.pages!.entries()) for (const key of Object.keys(values)) put(key, values[key]!);
      for (const key of Object.keys(row.props)) put(key, row.props[key]!);
      return out;
    };
    const visit = (x: any): any => {
      if (x === null || typeof x !== 'object') { if (typeof x === 'function' || typeof x === 'symbol') throw TypeError('Non-data export'); return x; }
      if (seen.has(x)) return seen.get(x);
      const view = proxies.get(x);
      if (view && view.graph !== this) throw TypeError('Foreign card instance reference');
      if (view) return node(view.id);
      if (!view && types.isProxy(x)) throw TypeError('External proxy');
      const out = Array.isArray(x) ? new Array(x.length) : Object.create(Object.getPrototypeOf(x)); seen.set(x, out);
      for (const key of Reflect.ownKeys(x)) {
        if (Array.isArray(x) && key === 'length') continue;
        if (typeof key !== 'string') throw TypeError('Symbol data');
        const d = Object.getOwnPropertyDescriptor(x, key)!;
        if (!Object.hasOwn(d, 'value') || !d.enumerable) throw TypeError('Non-data export');
        Object.defineProperty(out, key, { value: visit(d.value), writable: true, configurable: true, enumerable: true });
      }
      return out;
    };
    return visit(value);
  }
  /** The caller has established a managed root in a no-projection execution.
   * Each output remains private; scalar leaves may outlive their source row. */
  private exportPrivate<V>(root: number): V {
    const ids = new Map<number, any>();
    const plainArrayBase = arrayPrototypeIsPlain();
    let tree = true, dense = true;
    const node = (id: number): any => {
      if (ids.has(id)) { tree = false; return ids.get(id); }
      const row = this.rows.get(id); if (!row) throw Error('Missing card node');
      const cached = Object.hasOwn(row, 'exportCache') ? row.exportCache : undefined;
      if (cached) {
        dense &&= cached.dense;
        ids.set(id, cached.value); return cached.value;
      }
      // Private publications have the same ordinary DTO prototypes as copy().
      // Read-only adapters can borrow them without another normalization pass.
      const out: any = row.array ? new Array(row.length) : {}; ids.set(id, out);
      const inherited = row.array ? Array.prototype : Object.prototype;
      let leaf = true, indexed = 0;
      const put = (key: string, value: Value) => {
        let item = value;
        if (value !== null && typeof value === 'object') { leaf = false; item = node(value.ref); }
        if (row.array && !plainArrayBase || key in inherited) Object.defineProperty(out, key, { value: item, writable: true, configurable: true, enumerable: true });
        else out[key] = item;
      };
      if (row.array) for (const [, values] of row.pages!.entries()) for (const key of Object.keys(values)) { indexed++; put(key, values[key]!); }
      const names = Object.keys(row.props);
      for (const key of names) put(key, row.props[key]!);
      const localDense = !row.array || indexed === row.length && names.length === 0;
      dense &&= localDense;
      // A non-enumerable derived field stays out of COW clones, snapshots and
      // logical graph edges; this cache needs no global weak-table write.
      if (leaf) Object.defineProperty(row, 'exportCache', { value: { value: out, dense: localDense }, writable: true, configurable: true });
      return out;
    };
    const result = node(root);
    return retainOwned(result, tree, dense);
  }
  fork(): CardGraph<T> {
    const next = new CardGraph<T>(undefined as T); next.rows = this.rows.fork(); next.identity.next = this.identity.next; next.rootValue = this.rootValue;
    next.collectionAt = this.collectionAt; this.deferCollection = next.deferCollection = true;
    if (privateGraphs.has(this)) privateGraphs.add(next);
    return next;
  }
  /** Collect only at complete external boundaries; never as deferred fork work.
   * Schema/IO exports may traverse their requested payload independently. */
  boundary(): void {
    this.identity.originals = new WeakMap();
    if (this.deferCollection) { this.deferCollection = false; return; }
    if (this.rows.size >= this.collectionAt) { this.collect(); this.collectionAt = Math.max(2048, this.rows.size * 2 + 512); }
  }
  collect(): void {
    const live = new Set<number>(), pending: Value[] = [this.rootValue];
    while (pending.length) {
      const value = pending.pop(); if (!value || typeof value !== 'object' || live.has(value.ref)) continue;
      live.add(value.ref); const row = this.rows.get(value.ref); if (!row) throw Error('Missing card node');
      pending.push(...Object.values(row.props));
      if (row.pages) for (const [, values] of row.pages.entries()) pending.push(...Object.values(values));
    }
    for (const [id] of this.rows.entries()) if (!live.has(id)) { this.rows.delete(id); this.views.delete(id); }
    this.version++;
  }
  close(): void { this.rows.clear(); this.views.clear(); this.version++; }
  get nodeCount() { return this.rows.size; }
}
