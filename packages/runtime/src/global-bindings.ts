/** References capture an Instance's global object before a suspended RHS.
 * Module lexical declarations remain in their compiler-managed scope. */
export type GlobalReference = {
  object: object;
  name: string;
};

export function globalBindings(
  current: () => object,
  read: (object: object, name: string) => unknown,
  write: (object: object, name: string, value: unknown) => unknown,
  hasProperty: (object: object, name: string) => boolean,
) {
  const missing = (name: string): never => { throw new ReferenceError(name + ' is not defined'); };
  function reference(name: string): GlobalReference {
    return {object: current(), name};
  }
  function get(ref: GlobalReference): unknown {
    if (!hasProperty(ref.object, ref.name)) return missing(ref.name);
    return read(ref.object, ref.name);
  }
  function readName(name: string): unknown {
    const object = current();
    if (!hasProperty(object, name)) return missing(name);
    return read(object, name);
  }
  function set(ref: GlobalReference, value: unknown): unknown {
    if (!hasProperty(ref.object, ref.name)) return missing(ref.name);
    return write(ref.object, ref.name, value);
  }
  function typeOf(ref: GlobalReference): string {
    return !hasProperty(ref.object, ref.name) ? 'undefined' : typeof read(ref.object, ref.name);
  }
  return {reference, get, readName, set, typeOf};
}
