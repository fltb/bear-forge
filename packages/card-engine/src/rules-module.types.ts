import type { EntityKind,EntityKindSpec,ScopeKind,LifecycleSpec } from './rules-entities.types.ts';
import type { Checkpoint, ReplacementResult } from './rules-checkpoints.types.ts';
import type { Borrowed, Command, Input } from './rules.types.ts';
import type { Effect } from './rules.types.ts';
declare const componentBrand: unique symbol;
declare const eventBrand: unique symbol;
declare const authorityBrand: unique symbol;
declare const moduleBrand: unique symbol;
export type Schema<T> = { parse: (value: unknown) => T };
export type Component<T> = { readonly [componentBrand]: T };
export type RuleEvent<T> = { readonly [eventBrand]: T };
export type Owned<T> = { readonly public: T; readonly [authorityBrand]: T };
export type RuleModule<E = unknown> = { readonly exports: E; readonly [moduleBrand]: true };
export type ComponentValue<C> = C extends Component<infer T> ? T : never;
export type EventValue<E> = E extends RuleEvent<infer T> ? T : never;
export type ComponentWrite<C extends Component<any>> = C extends Component<any>?{
  entity: number; component: Owned<C>; value: ComponentValue<C>|Borrowed<ComponentValue<C>>;
}:never;
export type EventProposal<E extends RuleEvent<any>> = E extends RuleEvent<any>?{ event: Owned<E>; payload: EventValue<E>|Borrowed<EventValue<E>> }:never;
export type AtomRead<C extends Component<any>> = {
  component<T extends C>(entity: number, component: Owned<T> | T): Borrowed<ComponentValue<T>>;
};
export type ComponentReference=Component<any>|Owned<Component<any>>;
export type PublicDefinition<T>=T extends Owned<infer U>?U:T;
export type AtomSpec<I, O, R extends readonly ComponentReference[], W extends readonly Owned<Component<any>>[], E extends readonly Owned<RuleEvent<any>>[]> = {
  input: Schema<I>;
  output: Schema<O>;
  reads: R;
  writes: W;
  emits: E;
  run: (read: AtomRead<PublicDefinition<R[number]>>, input: Borrowed<I>) => {
    writes: readonly ComponentWrite<PublicDefinition<W[number]>>[];
    events: readonly EventProposal<PublicDefinition<E[number]>>[];
    result: O|Borrowed<O>;
  };
};
export type ModuleBuilder = {
  own<T extends Component<any> | RuleEvent<any> | Checkpoint<any,any>>(definition: T): Owned<T>;
  kind<C,S=undefined>(spec:EntityKindSpec<C,S>):EntityKind<C,S>;
  lifecycle(scope:ScopeKind,spec:LifecycleSpec):void;
  resolve<I,O>(checkpoint:Owned<Checkpoint<I,O>>,input:Input<I>):Command<ReplacementResult<O>>;
  atom<I,O,const R extends readonly ComponentReference[],const W extends readonly Owned<Component<any>>[],const E extends readonly Owned<RuleEvent<any>>[]>(spec: AtomSpec<I,O,R,W,E>): Effect<I,O>;
};
