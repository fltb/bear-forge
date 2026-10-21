import type { Builder, Command, Effect, Input, Local, Statement, Value } from './rules.types.ts';
import { definitionCapture, definitions, handle, statements } from './rules-internal.ts';
import type { Node } from './rules-internal.ts';
export type { Borrowed, Builder, Command, Effect, Input, Local, ReadView, Statement, Value } from './rules.types.ts';

function statement(node: Node): Statement {
  const value = handle<Statement>(); statements.set(value, node); return value;
}
export function defineEffect<I, O>(build: (b: Builder<I, O>) => Statement): Effect<I, O> {
  if (typeof build !== 'function') throw Error('Rule effect requires a builder');
  const value = handle<Effect<I, O>>(); definitions.set(value, { kind: 'author', build }); definitionCapture.current?.push(value); return value;
}
export function sequence(...steps: Statement[]): Statement {
  return statement({ kind: 'sequence', steps: [...steps] });
}
export function when(test: Input<boolean>, yes: Statement, no: Statement = sequence()): Statement {
  return statement({ kind: 'when', test, yes, no });
}
export function whileDo(test: Input<boolean>, body: Statement): Statement {
  return statement({ kind: 'while', test, body });
}
export function forEach<T>(items: Input<readonly T[]>, body: (item: Value<T>) => Statement): Statement {
  // The linker binds this lexical item to the containing frame, rather than starting a new world.
  const item = handle<Value<T>>();
  return statement({ kind: 'each', items, item, body: body(item) });
}
export function call<I, O>(definition: Effect<I, O> | Value<Effect<I,O>>, input: Input<I>): Command<O> {
  return statement({ kind: 'call', definition, input }) as Command<O>;
}

export { defineComponent, defineEvent, defineRules } from './rules-modules.ts';
export type { Component, RuleEvent, RuleModule, Schema } from './rules-module.types.ts';

export { defineQuery, query } from './rules-queries.ts';
export type { Query, QuerySpec, QueryRead,EntityQuerySelection } from './rules-query.types.ts';

export { on, guardAbility, install, uninstall, emit } from './rules-reactions.ts';
export type { Ability, InstallSpec, ReactionContext, ReactionSpec } from './rules-reactions.types.ts';

export { defineCheckpoint, replace, restrict } from './rules-checkpoints.ts';
export type { Checkpoint, CheckpointSpec, ReplacementContext, ReplacementResult, ReplacementSpec } from './rules-checkpoints.types.ts';

export { modify } from './rules-modifiers.ts';
export type { ModifierContext, ModifierSpec } from './rules-modifiers.ts';

export { defineEntity, spawnEntity, despawnEntity, entityEffect,definitionOf,entityConfiguration } from './rules-entities.ts';
export type { EntityDefinition, EntityKind, EntityKindSpec, EntityLifecycle, ScopeKind, LifecycleSpec, ScopeLifecycle,SpawnSpec } from './rules-entities.types.ts';
export { scopeOf } from './rules-scopes.ts';

export { readComponent, updateLocalComponent } from './rules-components.ts';

export {enqueue,schedule,cancelScheduled,snapshot} from './rules-tasks.ts';
export type {QueueOptions,RuleQueue,ScheduleOptions,SchedulePoint} from './rules-tasks.types.ts';

export {chooseOne,chooseMany,chooseOrder} from './rules-choices.ts';
export type {RuleOrder,RuleOrdering,RulePhase,PhaseConstraint} from './rules-order.types.ts';
export type {ChoiceAdapter,ChoiceRequest,ChoiceReply,ChoiceResult,OneChoiceSpec,ManyChoiceSpec,OrderChoiceSpec} from './rules-choices.types.ts';
