import type {EntityKind,EntityDefinition} from './rules-entities.types.ts';
import type { Component, Owned, Schema } from './rules-module.types.ts';
import type {RuleOrdering} from './rules-order.types.ts';
import type {Borrowed} from './rules.types.ts';
declare const queryBrand: unique symbol;
export type Query<I,O> = { readonly [queryBrand]: (input:I)=>O };
export type EntityQuerySelection<C,I,O,S=undefined>=Readonly<{kind:EntityKind<C,S>;select:(config:Borrowed<C>)=>Query<I,O>}>;
export type QueryRead = {
  entities<T>(definition:Component<T>|Owned<Component<T>>):readonly number[];
  component<T>(entity:number,definition:Component<T>|Owned<Component<T>>):Borrowed<T>;
  configuration<C,S>(entity:number,kind:EntityKind<C,S>):Borrowed<C>;
  definitionConfiguration<C,S>(definition:EntityDefinition<C,S>,kind:EntityKind<C,S>):Borrowed<C>;
  query<I,O>(definition:Query<I,O>,input:Borrowed<I>):Borrowed<O>;
  selected<C,I,O,S>(selection:EntityQuerySelection<C,I,O,S>,entity:number,input:Borrowed<I>):Borrowed<O>;
  selectedDefinition<C,I,O,S>(selection:EntityQuerySelection<C,I,O,S>,definition:EntityDefinition<C,S>,input:Borrowed<I>):Borrowed<O>;
  sameDefinition<C,S>(first:EntityDefinition<C,S>,second:EntityDefinition<C,S>):boolean;
};
export type QuerySpec<I,O> = {
  input:Schema<I>;
  output:Schema<O>;
  reads?:readonly (Component<any>|Owned<Component<any>>)[];
  kinds?:readonly EntityKind<any,any>[];
  dependencies?:readonly Query<any,any>[];
  order?:RuleOrdering;
  selections?:readonly EntityQuerySelection<any,any,any,any>[];
  base:(read:QueryRead,input:Borrowed<NoInfer<I>>)=>NoInfer<O|Borrowed<O>>;
};
