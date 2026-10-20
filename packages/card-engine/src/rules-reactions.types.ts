import type { Effect, Input } from './rules.types.ts';
import type { RuleEvent } from './rules-module.types.ts';
import type { Query } from './rules-query.types.ts';
import type {RuleOrder} from './rules-order.types.ts';
declare const abilityBrand:unique symbol;
export type ReactionContext<T,E={}>={event:T;source:number;owner:number;environment:E;registration:number};
export type Ability<E={}>={readonly [abilityBrand]:E};
export type ReactionSpec<T,E>={
  effect:Effect<ReactionContext<T,E>,void>;
  condition?:Query<ReactionContext<T,E>,boolean>;
  eligible?:'captured'|'registered'|Query<ReactionContext<T,E>,boolean>;
  order?:RuleOrder;
};
export type InstallSpec<E>={source:Input<number>;owner:Input<number>;ability:Ability<E>;environment:Input<E>;lifetime:Input<number>};
export type Registration={id:number;definition:number;source:number;owner:number;environment:any;lifetime:number;sequence:number};
export type CapturedReaction={registration:Registration;};
export type EventEnvelope={id:number;event:number;payload:any;handlers:CapturedReaction[];scheduled:number[]};
