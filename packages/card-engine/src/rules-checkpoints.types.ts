import type { Input, Command } from './rules.types.ts';
import type { Schema, Owned } from './rules-module.types.ts';
import type { Ability, ReactionSpec } from './rules-reactions.types.ts';
import type {RuleOrder,RuleOrdering} from './rules-order.types.ts';
declare const checkpointBrand:unique symbol;
export type Checkpoint<I,O=I>={readonly [checkpointBrand]:(input:I)=>O};
export type ReplacementResult<T>={kind:'keep';value:T}|{kind:'change';value:T}|{kind:'cancel';reason:unknown};
export type ReplacementContext<T,E={}>={value:T;source:number;owner:number;environment:E;registration:number};
export type CheckpointSpec<I,O>={input:Schema<I>;output:Schema<O>;initial?:(input:I)=>O;order?:RuleOrdering};
export type ReplacementSpec<T,E>={
  effect:import('./rules.types.ts').Effect<ReplacementContext<T,E>,ReplacementResult<T>>;
  condition?:import('./rules-query.types.ts').Query<ReplacementContext<T,E>,boolean>;
  eligible?:'captured'|'registered'|import('./rules-query.types.ts').Query<ReplacementContext<T,E>,boolean>;
  order?:RuleOrder;
};
