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
export type Input<T> = Value<T> | (T extends readonly unknown[]
  ? { readonly [K in keyof T]: Input<T[K]> }
  : T extends object ? { readonly [K in keyof T]: Input<T[K]> } : T);
export type ReadView<I> = {
  readonly input: I;
  get<T>(value: Value<T>): T;
};
export type Builder<I, O> = {
  readonly input: Value<I>;
  local<T>(): Local<T>;
  assign<T>(slot: Local<T>, value: Input<T> | Command<T>): Statement;
  read<T>(expression: (view: ReadView<I>) => T): Value<T>;
  return(value: Input<O>): Statement;
};
