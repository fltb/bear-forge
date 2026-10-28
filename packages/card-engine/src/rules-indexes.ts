import { staticDefinitions } from './rules-module-internal.ts';
import type { ModuleBindings, ModuleState, StaticDefinition } from './rules-module-internal.ts';
import type { Registration } from './rules-reactions.types.ts';
import type { RuleTask } from './rules-tasks.types.ts';
import { compareOrder } from './rules-order.ts';

/** Numeric identity order is explicit rather than Object.keys order, which
 * changes above the array-index range. Flat links live in ordinary Context
 * numeric tables: no per-member object/proxy or opaque host collection.
 * Singleton buckets retain only their endpoints, without two extra rows. */
export type RuleIndex = {
  first: number | null;
  last: number | null;
  size: number;
  previous: Record<number, number | null> | null;
  next: Record<number, number | null> | null;
};
type Buckets = Record<number, RuleIndex>;
export function createIndex(): RuleIndex { return {first:null,last:null,size:0,previous:null,next:null}; }
function singletonIndex(id:number):RuleIndex { return {first:id,last:id,size:1,previous:null,next:null}; }
function insertAfter(index:RuleIndex,id:number,previous:number|null):void {
  const nextIds=index.next;
  if(nextIds===null){
    const existing=index.first;
    if(existing===null){index.first=id;index.last=id;index.size=1;return;}
    const first=previous===null?id:existing,last=previous===null?existing:id;
    // Both complete tables transfer once; never mutate a transferred host row.
    index.previous={[first]:null,[last]:first};index.next={[first]:last,[last]:null};
    index.first=first;index.last=last;index.size=2;return;
  }
  const previousIds=index.previous!,next=previous===null?index.first:nextIds[previous]!;
  previousIds[id]=previous;nextIds[id]=next;
  if(previous===null)index.first=id;else nextIds[previous]=id;
  if(next===null)index.last=id;else previousIds[next]=id;
  index.size++;
}
/** A detached iteration snapshot; consumers that can mutate membership keep
 * the same captured-ID semantics as the previous array copy. */
export function indexIds(buckets:Buckets,key:number):number[]{
  const index=buckets[key],ids:number[]=[];
  if(index){
    const next=index.next;
    for(let id=index.first;id!==null;id=next===null?null:next[id]!)ids.push(id);
  }
  return ids;
}
export type RuleIndexes = {
  registrationsByTarget: Buckets;
  registrationsByTargetArrival: Buckets;
  registrationsBySource: Buckets;
  registrationsByScope: Buckets;
  entitiesByComponent: Buckets;
  entitiesByScope: Buckets;
  childrenByScope: Buckets;
  tasksBySource: Buckets;
  tasksByScope: Buckets;
  tasksByEvent: Buckets;
};

/** Every bucket is Context data. No Program or module cache owns live IDs. */
export function createRuleIndexes(): RuleIndexes {
  return {
    registrationsByTarget: {}, registrationsByTargetArrival: {}, registrationsBySource: {}, registrationsByScope: {},
    entitiesByComponent: {}, entitiesByScope: {}, childrenByScope: {},
    tasksBySource: {}, tasksByScope: {}, tasksByEvent: {},
  };
}

export function insertIndex(buckets: Buckets, key: number, id: number): void {
  const index=buckets[key];
  // Transfer a complete first member once. Small buckets need no follow-up
  // proxy reads/writes, and the transferred host object is never mutated.
  if(!index){buckets[key]=singletonIndex(id);return;}
  const next=index.next;
  if(next===null?index.first===id:next[id]!==undefined)return;
  // Runtime identities arrive monotonically. Initialization/restoration build
  // indexes in numeric order; the fallback retains internal insertion semantics.
  let previous=index.last;const previousIds=index.previous;
  while(previous!==null&&previous>id)previous=previousIds===null?null:previousIds[previous]!;
  insertAfter(index,id,previous);
}

export function removeIndex(buckets: Buckets, key: number, id: number): void {
  const index=buckets[key];if(!index)return;
  const nextIds=index.next;
  if(nextIds===null){if(index.first===id)delete buckets[key];return;}
  const next=nextIds[id];if(next===undefined)return;
  const size=index.size;
  if(size===2){
    const remaining=next===null?index.first:next;
    index.first=remaining;index.last=remaining;index.size=1;index.previous=null;index.next=null;return;
  }
  const previousIds=index.previous!,previous=previousIds[id]!;
  if(previous===null)index.first=next;else nextIds[previous]=next;
  if(next===null)index.last=previous;else previousIds[next]=previous;
  delete previousIds[id];delete nextIds[id];index.size=size-1;
}

type LinkedAbility = Extract<StaticDefinition, { kind: 'ability' }>;
function ability(bindings: ModuleBindings, definition: number): LinkedAbility {
  // Installation has already linked this definition and its target.
  return staticDefinitions.get(bindings.definitions[definition]!) as LinkedAbility;
}

export function addRegistration(state: ModuleState, bindings: ModuleBindings, registration: Registration): void {
  const metadata = ability(bindings, registration.definition), target = bindings.indices.get(metadata.target)!;
  state.registrations[registration.id] = registration;
  const buckets=state.indexes.registrationsByTarget;
  const index=buckets[target];
  if(!index)buckets[target]=singletonIndex(registration.id);
  else {
    // Equal priorities append in arrival order. An earlier priority walks only
    // the suffix it precedes; insertion remains O(k), as the former splice was,
    // while arbitrary removals no longer shift the remaining registrations.
    let previous=index.last;const previousIds=index.previous;
    while(previous!==null){
      const record=state.registrations[previous]!;
      if((compareOrder(ability(bindings,record.definition),metadata)||record.sequence-registration.sequence)<=0)break;
      previous=previousIds===null?null:previousIds[previous]!;
    }
    insertAfter(index,registration.id,previous);
  }
  insertIndex(state.indexes.registrationsBySource, registration.source, registration.id);
  insertIndex(state.indexes.registrationsByTargetArrival, target, registration.id);
  insertIndex(state.indexes.registrationsByScope, registration.lifetime, registration.id);
}

export function removeRegistration(state: ModuleState, bindings: ModuleBindings, id: number): boolean {
  const registration = state.registrations[id];
  if (!registration) return false;
  const target = bindings.indices.get(ability(bindings, registration.definition).target)!;
  removeIndex(state.indexes.registrationsByTarget, target, id);
  removeIndex(state.indexes.registrationsByTargetArrival, target, id);
  removeIndex(state.indexes.registrationsBySource, registration.source, id);
  removeIndex(state.indexes.registrationsByScope, registration.lifetime, id);
  delete state.registrations[id];
  return true;
}

export function indexEntity(state: ModuleState, id: number): void {
  const entity = state.entities[id]!;
  insertIndex(state.indexes.entitiesByScope, entity.scope, id);
  for (const component of Object.keys(entity.components)) insertIndex(state.indexes.entitiesByComponent, Number(component), id);
}

export function unindexEntity(state: ModuleState, id: number): void {
  const entity = state.entities[id]!;
  removeIndex(state.indexes.entitiesByScope, entity.scope, id);
  for (const component of Object.keys(entity.components)) removeIndex(state.indexes.entitiesByComponent, Number(component), id);
}

export function indexTask(state: ModuleState, task: RuleTask): void {
  insertIndex(state.indexes.tasksByScope, task.lifetime, task.id);
  if (task.source !== null) insertIndex(state.indexes.tasksBySource, task.source, task.id);
  if (task.effect.selector !== null && task.effect.source !== null && task.effect.source !== task.source)
    insertIndex(state.indexes.tasksBySource, task.effect.source, task.id);
  if (task.state === 'scheduled' && task.at !== null) insertIndex(state.indexes.tasksByEvent, task.at, task.id);
}

export function removeTask(state: ModuleState, id: number): void {
  const task = state.tasks[id];
  if (!task) return;
  removeIndex(state.indexes.tasksByScope, task.lifetime, id);
  if (task.source !== null) removeIndex(state.indexes.tasksBySource, task.source, id);
  if (task.effect.selector !== null && task.effect.source !== null && task.effect.source !== task.source)
    removeIndex(state.indexes.tasksBySource, task.effect.source, id);
  if (task.at !== null) removeIndex(state.indexes.tasksByEvent, task.at, id);
  delete state.tasks[id];
}
