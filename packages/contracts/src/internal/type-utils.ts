export type ReadView<T> = T extends object
  ? { readonly [K in keyof T]: ReadView<T[K]> }
  : T;
type IsUnion<T, Whole = T> = T extends unknown
  ? [Whole] extends [T] ? false : true
  : never;
type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];
export type FixedTable<T> = true extends IsUnion<T> ? never
  : string extends keyof T ? never
  : Exclude<keyof T, string> extends never
    ? [OptionalKeys<T>] extends [never] ? unknown : never
    : never;
export type TableKeys<T> = FixedTable<T> extends never ? never : keyof T & string;

/** Empty mapped tables must reject scalar values and undeclared own keys. */
export type EmptyTableGuard<T> = [keyof T] extends [never] ? Record<PropertyKey, never> : unknown;
