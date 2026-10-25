import type {CardDefinition} from './card.types.ts';
import type {ModuleBindings} from './rules-module-internal.ts';
import type {Query} from './rules-query.types.ts';
import {evaluateQuery} from './rules-queries.ts';
import {detachRuleValue} from './rules-values.ts';
import {stateOf} from './rules-module-internal.ts';
import type {RuleQueue} from './rules-tasks.types.ts';
import {cardDefinitionSource} from './card-admission.ts';

const linkedQueries=new WeakMap<object,ModuleBindings>();
/** Static linker metadata only; it is never part of Context or a snapshot. */
export function attachRuleQueries(definition:object,bindings:ModuleBindings):void{linkedQueries.set(definition,bindings);}
/**
 * Detached read-only observation for search and diagnostics; readers may edit their DTO. The caller supplies
 * this definition's Context state. It uses the exact linked query permissions;
 * it cannot invoke effects, initialize entities, or substitute another World.
 */
export function inspectRuleQuery<I,O>(definition:CardDefinition<any,any,any,any>,state:unknown,query:Query<I,O>,input:I):O{
  const bindings=linkedQueries.get(cardDefinitionSource(definition));if(!bindings)throw Error('Definition has no linked rule queries');
  return detachRuleValue<O>(evaluateQuery(query,input,state,bindings));
}
/** Diagnostic task count. Suspended group work is optional; scheduler queueSize
 * continues to report only immediately drainable entries. Running and future
 * scheduled tasks are excluded in either view. */
export function inspectRuleQueue(definition:object,state:unknown,queue:RuleQueue,options:{includeStaged?:boolean}={}):number{
  const bindings=linkedQueries.get(cardDefinitionSource(definition)),index=bindings?.indices.get(queue);if(index===undefined)throw Error('Queue is not linked');
  const current=stateOf(state);
  if(options.includeStaged)return Object.values(current.tasks).filter(task=>task.queue===index&&(task.state==='pending'||task.state==='staged')).length;
  return current.queues[index]?.size??0;
}
