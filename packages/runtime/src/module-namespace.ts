/** Module namespace exotic behavior (ECMA-262 10.4.6). The target contains only
 * invariant-compatible property placeholders; live bindings are explicit data.
 * Copy/serialization must use record(), allocate() and install(), never inspect
 * live property descriptors, which may read a TDZ binding. */
export type NamespaceRecord = { names: string[]; readers: readonly (() => unknown)[] };
export function createNamespaceRegistry() {
  const records = new WeakMap<object, NamespaceRecord>();
  function allocate(names: readonly string[]): object {
    const ordered = [...names].sort();
    if (new Set(ordered).size !== ordered.length) throw new TypeError('Duplicate namespace export');
    const target = Object.create(null);
    for (const name of ordered) Object.defineProperty(target, name, {
      value: undefined, writable: true, enumerable: true, configurable: false,
    });
    Object.defineProperty(target, Symbol.toStringTag, { value: 'Module' });
    Object.preventExtensions(target);
    const record: NamespaceRecord = { names: ordered, readers: [] };
    const index = new Map(ordered.map((name, index) => [name, index]));
    const read = (key: string): unknown => {
      const reader = record.readers[index.get(key)!];
      if (!reader) throw new ReferenceError('Module binding is not installed');
      return Reflect.apply(reader, undefined, []);
    };
    const namespace = new Proxy(target, {
      get(_target, key) { return typeof key === 'string' && index.has(key) ? read(key) : Reflect.get(target, key); },
      getOwnPropertyDescriptor(_target, key) {
        if (typeof key !== 'string' || !index.has(key)) return Reflect.getOwnPropertyDescriptor(target, key);
        return { value: read(key), writable: true, enumerable: true, configurable: false };
      },
      defineProperty(_target, key, descriptor) {
        if (typeof key === 'symbol') return Reflect.defineProperty(target, key, descriptor);
        if (!index.has(key)) return false;
        // GetOwnProperty precedes descriptor checks, including the TDZ read.
        const value = read(key);
        if (descriptor.configurable === true || descriptor.enumerable === false || descriptor.writable === false ||
          'get' in descriptor || 'set' in descriptor) return false;
        return !('value' in descriptor) || Object.is(descriptor.value, value);
      },
      set() { return false; },
      deleteProperty(_target, key) { return typeof key === 'string' ? !index.has(key) : Reflect.deleteProperty(target, key); },
      // V8 enumerates integer-index keys first; other exports were inserted sorted.
      ownKeys() { return Reflect.ownKeys(target); },
    });
    records.set(namespace, record);
    return namespace;
  }
  function install(namespace: object, readers: readonly (() => unknown)[]): void {
    const record = records.get(namespace);
    if (!record)
      throw new TypeError('Invalid module namespace bindings');
    // A decoder may install an allocated array before populating its elements.
    record.readers = readers;
  }
  function create(bindings: Readonly<Record<string, () => unknown>>): object {
    const namespace = allocate(Object.keys(bindings));
    const record = records.get(namespace)!;
    install(namespace, record.names.map(name => bindings[name]!));
    return namespace;
  }
  return { allocate, install, create, record: (namespace: object) => records.get(namespace) };
}
