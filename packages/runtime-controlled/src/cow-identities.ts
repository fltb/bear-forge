import {CowStore} from './cow-store.ts';

const NativeWeakMap = WeakMap;
const NativeWeakRef = WeakRef;
const NativeFinalizationRegistry = FinalizationRegistry;
type Versions<T> = {id: number; values: WeakMap<object, T>};
class Registry<T> {
  nextId = 0;
  readonly identities = new NativeWeakMap<object, Versions<T>>();
  readonly ids = new Set<number>();
  readonly stores = new Set<WeakRef<CowIdentityStore<T>>>();
  readonly collectedStore = new NativeFinalizationRegistry<WeakRef<CowIdentityStore<T>>>(reference => {
    this.stores.delete(reference);
  });
  readonly collectedIdentity = new NativeFinalizationRegistry<number>(id => {
    this.ids.delete(id);
    // This is native GC housekeeping, outside author execution. Neither fork
    // nor a branch's first write scans identities or runs this cleanup.
    for (const reference of this.stores) {
      const store = reference.deref();
      if (store) store.reclaim(id);
      else this.stores.delete(reference);
    }
  });
}

/** COW identity records with native ephemeron lifetime.
 * The persistent index retains only version tokens. Payloads require BOTH a
 * live object identity and a live version token: identity -> WeakMap<token,T>.
 * Consequently a payload pointing back to its identity does not keep that
 * identity alive, and dropping a branch releases its obsolete payloads.
 */
export class CowIdentityStore<T> {
  private tokens = new CowStore<object>();
  private cache = new NativeWeakMap<object, {id: number; value: T; owned: boolean}>();
  private registry: Registry<T>;
  private reference: WeakRef<CowIdentityStore<T>>;
  private attached = false;
  constructor(registry = new Registry<T>()) {
    this.registry = registry;
    this.reference = new NativeWeakRef(this);
  }
  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.registry.stores.add(this.reference);
    this.registry.collectedStore.register(this, this.reference, this.reference);
  }
  private detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.registry.stores.delete(this.reference);
    this.registry.collectedStore.unregister(this.reference);
  }
  get size(): number { return this.tokens.size; }
  // Internal structural diagnostics use the same root identity as CowStore.
  get root(): unknown { return (this.tokens as any).root; }
  register(id: number, identity: object): void {
    const known = this.registry.identities.get(identity);
    if (known) {
      if (known.id !== id) throw new TypeError('Identity registered with another index');
      return;
    }
    if (this.registry.ids.has(id)) throw new TypeError('Identity index already registered');
    this.registerVersion(id, identity);
  }
  private registerVersion(id: number, identity: object): Versions<T> {
    this.registry.nextId = Math.max(this.registry.nextId, id + 1);
    const versions = {id, values: new NativeWeakMap<object, T>()};
    this.registry.identities.set(identity, versions);
    this.registry.ids.add(id);
    this.registry.collectedIdentity.register(identity, id);
    return versions;
  }
  /** Intrinsic state uses this registry directly instead of maintaining a
   * second identity-to-index WeakMap in the adapter. Forks share the registry. */
  getIdentity(identity: object): T | undefined {
    const cached = this.cache.get(identity);
    if (cached) return cached.value;
    const versions = this.registry.identities.get(identity);
    if (!versions) return undefined;
    const token = this.tokens.get(versions.id);
    if (!token) return undefined;
    const value = versions.values.get(token)!;
    this.cache.set(identity, {id: versions.id, value, owned: false});
    return value;
  }
  setIdentity(identity: object, value: T): void {
    const versions = this.registry.identities.get(identity)
      ?? this.registerVersion(this.registry.nextId, identity);
    this.install(versions, identity, value);
  }
  /** Replace a scalar/reference slot without allocating a wrapper payload.
   * Shared versions are never modified; an owned version can be reused. */
  writeIdentity(identity: object, value: T): void {
    const cached = this.cache.get(identity);
    if (!cached?.owned) {this.setIdentity(identity, value); return;}
    const versions = this.registry.identities.get(identity)!;
    versions.values.set(this.tokens.get(versions.id)!, value);
    cached.value = value;
  }
  editIdentity(identity: object, clone: (value: T) => T): T {
    const cached = this.cache.get(identity);
    if (cached?.owned) return cached.value;
    const versions = this.registry.identities.get(identity);
    if (!versions || !cached && !this.tokens.has(versions.id)) throw new TypeError('Incompatible intrinsic receiver');
    return this.edit(versions.id, clone, identity);
  }
  private versions(id: number, identity: object): Versions<T> | undefined {
    const versions = this.registry.identities.get(identity);
    return versions?.id === id ? versions : undefined;
  }
  has(id: number, identity: object): boolean {
    return this.cache.get(identity)?.id === id || this.tokens.has(id) && this.versions(id, identity) !== undefined;
  }
  get(id: number, identity: object): T | undefined {
    const cached = this.cache.get(identity);
    if (cached?.id === id) return cached.value;
    const token = this.tokens.get(id);
    const versions = token && this.versions(id, identity);
    if (!token || !versions) return undefined;
    const value = versions.values.get(token)!;
    this.cache.set(identity, {id, value, owned: false});
    return value;
  }
  set(id: number, value: T, identity: object): void {
    const versions = this.versions(id, identity);
    if (!versions) throw new TypeError('Unknown state identity');
    this.install(versions, identity, value);
  }
  private install(versions: Versions<T>, identity: object, value: T): void {
    const id = versions.id;
    this.attach();
    const token = {};
    versions.values.set(token, value);
    this.tokens.set(id, token);
    this.cache.set(identity, {id, value, owned: true});
  }
  edit(id: number, clone: (value: T) => T, identity: object): T {
    const cached = this.cache.get(identity);
    if (cached?.id === id && cached.owned) return cached.value;
    const versions = this.versions(id, identity);
    if (!versions) throw new TypeError('Unknown state identity');
    const token = this.tokens.edit(id, previous => {
      const value = clone(versions.values.get(previous)!);
      const next = {};
      versions.values.set(next, value);
      return next;
    });
    const value = versions.values.get(token)!;
    this.cache.set(identity, {id, value, owned: true});
    return value;
  }
  /** Called only after the identity has been collected; its cache entry is
   * already dead too. No author-accessible identity can observe this removal. */
  reclaim(id: number): void {
    this.tokens.delete(id);
    if (!this.tokens.size) this.detach();
  }
  clear(): void { this.tokens.clear(); this.cache = new NativeWeakMap(); this.detach(); }
  fork(): CowIdentityStore<T> {
    const branch = new CowIdentityStore(this.registry);
    branch.tokens = this.tokens.fork();
    if (branch.size) branch.attach();
    // Cached writable payloads belong to one branch. Invalidate in O(1), never
    // visit cached identities or warm a new branch by traversing its heap.
    this.cache = new NativeWeakMap();
    return branch;
  }
}
