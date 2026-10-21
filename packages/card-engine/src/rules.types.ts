import type { Query } from './rules-query.types.ts';
/** Authoring handles exist only in the shared Program, never in instance data. */
declare const valueType: unique symbol;
declare const localType: unique symbol;
declare const effectType: unique symbol;
declare const statementType: unique symbol;
declare const commandType: unique symbol;
export type Value<T> = { readonly [valueType]: T };
export type Local<T> = Value<T> & { readonly [localType]: true };
export type Effect<I, O> = { readonly [effectType]: (input: I) => O };
export type Statement = { readonly [statementType]: true };
export type Command<T> = Statement & { readonly [commandType]: T };
/** A read borrows data recursively. Nominal authoring handles and functions
 * retain their signatures; neither represents writable instance data. */
export type Borrowed<T> = T extends (...args: any[]) => any ? T
  : T extends readonly unknown[] ? { readonly [K in keyof T]: Borrowed<T[K]> }
  : T extends object ? Extract<keyof T, symbol> extends never
    ? { readonly [K in keyof T]: Borrowed<T[K]> } : T : T;
export type Input<T> = Value<T> | Value<Borrowed<T>> | (T extends readonly unknown[]
  ? { readonly [K in keyof T]: Input<T[K]> }
  : T extends object ? { readonly [K in keyof T]: Input<T[K]> } : T);
export type ReadView<I> = {
  readonly input: Borrowed<I>;
  get<T>(value: Value<T>): Borrowed<T>;
  /** Invoke a linked query with values computed in this read callback. This
   * uses the Program executor directly and creates no author IR at runtime. */
  query<A,B>(definition:Query<A,B>,input:Borrowed<A>):Borrowed<B>;
};
export type Builder<I, O> = {
  readonly input: Value<I>;
  local<T>(): Local<T>;
  assign<T>(slot: Local<T>, value: Input<T> | Command<T>): Statement;
  read<T>(expression: (view: ReadView<I>) => T): Value<T>;
  return(value: Input<O>): Statement;
};
