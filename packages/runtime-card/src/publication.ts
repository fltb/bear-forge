import { arrayPrototypeIsPlain, retainOwned } from '../../boundary/src/values.ts';
import { isImmutableRuleValue } from '../../card-engine/src/rules-values.ts';
import { types } from 'node:util';

/** Private publications share owned rule blocks. Repeated nodes still count
 * toward alias topology even though their data never needs to be copied. */
export class Publication {
  tree = true;
  dense = true;
  private readonly blocks = new Set<object>();
  private readonly nodes = new Set<object>();
  add(value: object, dense = true): void { this.nodes.add(value); this.dense &&= dense; }
  borrow<T extends object>(value: T): T {
    if (this.blocks.has(value)) { this.tree = false; return value; }
    this.blocks.add(value);
    const keys = Object.keys(value), array = Array.isArray(value);
    this.add(value, !array || keys.length === value.length && (value.length === 0 || keys[value.length - 1] === String(value.length - 1)));
    for (const key of keys) { const child = (value as Record<string, unknown>)[key]; if (child !== null && typeof child === 'object') this.borrow(child); }
    return value;
  }
  finish<T>(value: T): T {
    // Every projection was included in this construction walk already.
    for (const node of this.nodes) retainOwned(node, this.tree, this.dense, this.tree);
    return value;
  }
}

/** A no-projection native stop is private. Copy its mutable containers once,
 * retaining immutable blocks. Exotic structured-clone semantics (including
 * getters) remain with the original cloner, before any getter is invoked here. */
export function publishNativeStop<T>(value: T, clone: <V>(value: V) => V): T {
  if (!arrayPrototypeIsPlain()) return clone(value);
  const publication = new Publication(), seen = new Map<object, unknown>();
  const unsupported = {};
  const visit = (source: unknown): unknown => {
    if (source === null || typeof source !== 'object') {
      if (typeof source === 'function' || typeof source === 'symbol') throw unsupported;
      return source;
    }
    if (isImmutableRuleValue(source)) return publication.borrow(source);
    if (seen.has(source)) { publication.tree = false; return seen.get(source); }
    if (types.isProxy(source)) throw unsupported;
    const array = Array.isArray(source), prototype = Object.getPrototypeOf(source);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw unsupported;
    const keys = Reflect.ownKeys(source), output: Record<string, unknown> = array ? new Array(source.length) as unknown as Record<string, unknown> : {};
    seen.set(source, output);
    publication.add(output, !array || keys.length === source.length + 1 && keys[source.length] === 'length');
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw unsupported;
      const descriptor = Object.getOwnPropertyDescriptor(source, key)!;
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw unsupported;
      const item = visit(descriptor.value);
      if (key in (array ? Array.prototype : Object.prototype)) Object.defineProperty(output, key, {value:item,writable:true,enumerable:true,configurable:true});
      else output[key] = item;
    }
    return output;
  };
  try { return publication.finish(visit(value) as T); }
  catch (error) { if (error !== unsupported) throw error; return clone(value); }
}
