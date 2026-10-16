import {CowIdentityStore} from './cow-identities.ts';
import {CowStore} from './cow-store.ts';

// Runtime bookkeeping must retain native ephemeron storage even when the
// language global exposes the controlled WeakMap constructor.
const NativeWeakMap = WeakMap;

type Entry = {key: WeakRef<WeakKey>; token: object};
type KeyInfo = {id: number; values: WeakMap<object, unknown>};
type Registry = {tables: WeakMap<object, number>; keys: WeakMap<WeakKey, KeyInfo>; nextTable: number; nextKey: number};
function weakKey(value: unknown): value is WeakKey {
  return value !== null && (typeof value === 'object' || typeof value === 'function'
    || typeof value === 'symbol' && Symbol.keyFor(value) === undefined);
}
/** Weak keys and weak version tokens keep value->key cycles collectible.
 * Roots retain only WeakRefs and tokens, never keys or values. Values live in
 * a native ephemeron chain: key -> WeakMap<version token, value>.
 */
export class CowWeakCollections {
  private roots = new CowIdentityStore<CowStore<Entry>>();
  private registry: Registry;
  constructor(registry: Registry = {tables: new NativeWeakMap(), keys: new NativeWeakMap(), nextTable: 0, nextKey: 0}) {this.registry = registry;}
  create(table: object): void {
    if (this.registry.tables.has(table)) throw new TypeError('Weak collection already registered');
    const id = this.registry.nextTable++; this.registry.tables.set(table, id);
    this.roots.register(id, table); this.roots.set(id, new CowStore(), table);
  }
  private root(table: object, write = false): CowStore<Entry> {
    const id = this.registry.tables.get(table);
    if (id === undefined || !this.roots.has(id, table)) throw new TypeError('Weak collection does not belong to this Context');
    return write ? this.roots.edit(id, root => root.fork(), table) : this.roots.get(id, table)!;
  }
  set(table: object, key: unknown, value: unknown): void {
    this.root(table);
    if (!weakKey(key)) throw new TypeError('Invalid weak collection key');
    let info = this.registry.keys.get(key);
    if (!info) {info = {id: this.registry.nextKey++, values: new NativeWeakMap()}; this.registry.keys.set(key, info);}
    const root = this.root(table, true), token = {};
    info.values.set(token, value); root.set(info.id, {key: new WeakRef(key), token});
  }
  has(table: object, key: unknown): boolean {
    const root = this.root(table), info = weakKey(key) ? this.registry.keys.get(key) : undefined;
    return info !== undefined && root.has(info.id);
  }
  get(table: object, key: unknown): unknown {
    const root = this.root(table), info = weakKey(key) ? this.registry.keys.get(key) : undefined;
    const entry = info && root.get(info.id);
    return entry ? info!.values.get(entry.token) : undefined;
  }
  delete(table: object, key: unknown): boolean {
    const root = this.root(table), info = weakKey(key) ? this.registry.keys.get(key) : undefined;
    return !!info && root.has(info.id) && this.root(table, true).delete(info.id);
  }
  *items(table: object): IterableIterator<[WeakKey, unknown]> {
    for (const [, entry] of this.root(table).entries()) {
      const key = entry.key.deref();
      if (key !== undefined) yield [key, this.registry.keys.get(key)!.values.get(entry.token)];
    }
  }
  fork(): CowWeakCollections {
    const branch = new CowWeakCollections(this.registry); branch.roots = this.roots.fork(); return branch;
  }
  clear(): void {this.roots.clear();}
}
