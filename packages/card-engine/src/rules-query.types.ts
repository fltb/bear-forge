import type {EntityKind,EntityDefinition} from './rules-entities.types.ts';
import type { Component, Owned, Schema } from './rules-module.types.ts';
import type {RuleOrdering} from './rules-order.types.ts';
declare const queryBrand: unique symbol;
export type Query<I,O> = { readonly [queryBrand]: (input:I)=>O };
export type EntityQuerySelection<C,I,O,S=undefined>=Readonly<{kind:EntityKind<C,S>;select:(config:Readonly<C>)=>Query<I,O>}>;
export type QueryRead = {
  entities<T>(definition:Component<T>|Owned<Component<T>>):readonly number[];
  component<T>(entity:number,definition:Component<T>|Owned<Component<T>>):Readonly<T>;
  configuration<C,S>(entity:number,kind:EntityKind<C,S>):Readonly<C>;
  definitionConfiguration<C,S>(definition:EntityDefinition<C,S>,kind:EntityKind<C,S>):Readonly<C>;
  query<I,O>(definition:Query<I,O>,input:I):O;
  selected<C,I,O,S>(selection:EntityQuerySelection<C,I,O,S>,entity:number,input:I):O;
  selectedDefinition<C,I,O,S>(selection:EntityQuerySelection<C,I,O,S>,definition:EntityDefinition<C,S>,input:I):O;
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
  base:(read:QueryRead,input:I)=>O;
};
