import type {CardDefinition} from './card.types.ts';
import type {ModuleBindings} from './rules-module-internal.ts';
import type {Query} from './rules-query.types.ts';
import {evaluateQuery} from './rules-queries.ts';
import {stateOf} from './rules-module-internal.ts';
import type {RuleQueue} from './rules-tasks.types.ts';

const linkedQueries=new WeakMap<object,ModuleBindings>();
/** Static linker metadata only; it is never part of Context or a snapshot. */
export function attachRuleQueries(definition:object,bindings:ModuleBindings):void{linkedQueries.set(definition,bindings);}
/**
 * Internal read-only observation for difftest and diagnostics. The caller supplies
 * this definition's Context state. It uses the exact linked query permissions;
 * it cannot invoke effects, initialize entities, or substitute another World.
 */
export function inspectRuleQuery<I,O>(definition:CardDefinition<any,any,any,any>,state:unknown,query:Query<I,O>,input:I):O{
  const bindings=linkedQueries.get(definition);if(!bindings)throw Error('Definition has no linked rule queries');
  return evaluateQuery(query,input,state,bindings);
}
export function inspectRuleQueue(definition:object,state:unknown,queue:RuleQueue):number{
  const bindings=linkedQueries.get(definition),index=bindings?.indices.get(queue);if(index===undefined)throw Error('Queue is not linked');
  return stateOf(state).queues[index]?.length??0;
}
