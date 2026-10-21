import { staticDefinitions } from './rules-module-internal.ts';
import type { ModuleBindings, ModuleState, StaticDefinition } from './rules-module-internal.ts';
import type { Registration } from './rules-reactions.types.ts';
import type { RuleTask } from './rules-tasks.types.ts';
import { compareOrder } from './rules-order.ts';

type Buckets = Record<number, number[]>;
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
  const values = buckets[key];
  if (!values) { buckets[key] = [id]; return; }
  if (!values.length || values[values.length - 1]! < id) { values.push(id); return; }
  let low = 0, high = values.length;
  while (low < high) { const middle = (low + high) >>> 1; if (values[middle]! < id) low = middle + 1; else high = middle; }
  if (values[low] !== id) values.splice(low, 0, id);
}

export function removeIndex(buckets: Buckets, key: number, id: number): void {
  const values = buckets[key];
  if (!values) return;
  const at = values.indexOf(id);
  if (at >= 0) values.splice(at, 1);
  if (!values.length) delete buckets[key];
}

type LinkedAbility = Extract<StaticDefinition, { kind: 'ability' }>;
function ability(bindings: ModuleBindings, definition: number): LinkedAbility {
  // Installation has already linked this definition and its target.
  return staticDefinitions.get(bindings.definitions[definition]!) as LinkedAbility;
}

export function addRegistration(state: ModuleState, bindings: ModuleBindings, registration: Registration): void {
  const metadata = ability(bindings, registration.definition), target = bindings.indices.get(metadata.target)!;
  state.registrations[registration.id] = registration;
  const buckets = state.indexes.registrationsByTarget, ids = buckets[target];
  if (!ids) buckets[target] = [registration.id];
  else {
    let low = 0, high = ids.length;
    while (low < high) {
      const middle = (low + high) >>> 1, previous = state.registrations[ids[middle]!]!;
      const order = compareOrder(ability(bindings, previous.definition), metadata) || previous.sequence - registration.sequence;
      if (order <= 0) low = middle + 1; else high = middle;
    }
    ids.splice(low, 0, registration.id);
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
