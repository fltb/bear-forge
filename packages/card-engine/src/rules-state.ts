import {z} from 'zod';
import type {ModuleBindings,ModuleState} from './rules-module-internal.ts';
import {staticDefinitions} from './rules-module-internal.ts';
import {createRuleIndexes,indexEntity,indexTask,insertIndex,addRegistration} from './rules-indexes.ts';
import {sameRuleValue} from './rules-values.ts';
import type {RuleDeque} from './rules-deque.ts';

const id=z.number().int().nonnegative(),positive=id.min(1),reference=id.nullable();
const key=z.string().regex(/^(?:0|[1-9][0-9]*)$/).refine(value=>Number.isSafeInteger(Number(value))&&String(Number(value))===value);
const bucket=z.record(key,z.array(id));
const deque=z.object({first:reference,last:reference,size:id,links:z.record(key,z.object({previous:reference,next:reference}).strict())}).strict();
const registration=z.object({id:positive,definition:id,source:id,owner:id,environment:z.unknown(),lifetime:id,sequence:positive}).strict();
const schema=z.object({
  probabilityAccount:z.object({random:z.object({state:z.number().int().min(0).max(0xffffffff),position:z.number().int().nonnegative()}).strict(),milliseconds:z.number().finite().nonnegative(),nodes:id,advances:id,words:id,captures:id}).strict().optional(),
  indexes:z.object({registrationsByTarget:bucket,registrationsByTargetArrival:bucket,registrationsBySource:bucket,registrationsByScope:bucket,entitiesByComponent:bucket,entitiesByScope:bucket,childrenByScope:bucket,tasksBySource:bucket,tasksByScope:bucket,tasksByEvent:bucket}).strict(),
  entities:z.record(key,z.object({components:z.record(key,z.unknown()),definition:reference,scope:id,owner:reference,phase:z.enum(['initializing','active','removing'])}).strict()),
  scopes:z.record(key,z.object({kind:reference,parent:reference,phase:z.enum(['initializing','active','ending','closed'])}).strict()),
  nextEntity:positive,nextScope:positive,sources:z.array(id),
  tasks:z.record(key,z.object({id:positive,effect:z.object({program:z.string(),effect:id,source:reference,selector:reference}).strict(),input:z.unknown(),queue:id,source:reference,lifetime:id,eligible:z.enum(['captured','source-present']),state:z.enum(['scheduled','pending','staged','running']),at:reference,condition:reference,position:z.enum(['front','back'])}).strict()),
  queues:z.record(key,deque),nextTask:positive,
  outbox:z.record(key,z.object({id:positive,event:id,payload:z.unknown(),handlers:z.array(z.object({registration}).strict()),scheduled:z.array(positive)}).strict()),
  eventQueues:z.object({queued:deque,immediate:deque}).strict(),
  registrations:z.record(key,registration),nextRegistration:positive,nextEvent:positive,
}).strict();

function inspectDeque(queue:RuleDeque):number[]{
  const visited:number[]=[],seen=new Set<number>();let previous:number|null=null,current=queue.first;
  while(current!==null){
    const link=queue.links[current];
    if(seen.has(current)||!link||link.previous!==previous)throw Error('Invalid saved rule queue links');
    seen.add(current);visited.push(current);previous=current;current=link.next;
  }
  if(previous!==queue.last||visited.length!==queue.size||Object.keys(queue.links).length!==queue.size)throw Error('Invalid saved rule queue extent');
  return visited;
}

/** Only real restore calls this. Recompute redundant indexes from authoritative
 * records, reject disagreement, and retain the original graph/alias topology. */
export function admitRuleState(root:unknown,bindings:ModuleBindings,effectCount:number,selectorCount:number):void{
  if(root===null||typeof root!=='object'||!Object.hasOwn(root,'$rules'))throw Error('Missing saved rule state');
  const state=schema.parse((root as {$rules:unknown}).$rules) as ModuleState;
  const expected:ModuleState={...state,indexes:createRuleIndexes(),registrations:{}};
  const metadata=(index:number)=>staticDefinitions.get(bindings.definitions[index]!);
  const checkNext=(next:number,records:object)=>{for(const name of Object.keys(records))if(Number(name)>=next)throw Error('Invalid saved rule identity counter');};
  checkNext(state.nextEntity,state.entities);checkNext(state.nextScope,state.scopes);checkNext(state.nextTask,state.tasks);checkNext(state.nextRegistration,state.registrations);checkNext(state.nextEvent,state.outbox);
  const rootScope=state.scopes[0];
  if(!rootScope||rootScope.parent!==null||rootScope.kind!==null||rootScope.phase!=='active')throw Error('Invalid saved root scope');
  for(const [name,scope] of Object.entries(state.scopes)){
    const scopeId=Number(name);if(scopeId===0)continue;
    if(scope.kind===null||metadata(scope.kind)?.kind!=='scope-kind'||scope.parent===null||!state.scopes[scope.parent])throw Error('Invalid saved scope binding');
    const ancestry=new Set<number>([scopeId]);let parent:number|null=scope.parent;
    while(parent!==null){if(ancestry.has(parent))throw Error('Cyclic saved scope ancestry');ancestry.add(parent);const value:ModuleState['scopes'][number]|undefined=state.scopes[parent];if(!value)throw Error('Invalid saved scope parent');parent=value.parent;}
    if(scope.phase!=='closed')insertIndex(expected.indexes.childrenByScope,scope.parent,scopeId);
  }
  for(const [name,entity] of Object.entries(state.entities)){
    if(!state.scopes[entity.scope])throw Error('Invalid saved entity scope');
    const layout=entity.definition===null?bindings.initialComponents:bindings.entityLayouts.get(entity.definition)?.components;
    if(!layout||layout.length!==Object.keys(entity.components).length||layout.some(slot=>!Object.hasOwn(entity.components,slot.index)))throw Error('Invalid saved entity component layout');
    indexEntity(expected,Number(name));
  }
  const validRegistration=(record:ModuleState['registrations'][number])=>{
    if(!Object.hasOwn(record,'environment')||metadata(record.definition)?.kind!=='ability'||!state.scopes[record.lifetime]||record.id!==record.sequence||record.id>=state.nextRegistration)throw Error('Invalid saved ability binding');
  };
  for(const [name,record] of Object.entries(state.registrations)){
    validRegistration(record);if(Number(name)!==record.id||!state.entities[record.source])throw Error('Invalid saved registration source');
    addRegistration(expected,bindings,record);
  }
  const queuedTasks=new Set<number>();
  for(const [name,queue] of Object.entries(state.queues)){
    if(metadata(Number(name))?.kind!=='queue')throw Error('Invalid saved task queue');
    for(const taskId of inspectDeque(queue)){
      const task=state.tasks[taskId];
      if(!task||task.queue!==Number(name)||task.state!=='pending'||queuedTasks.has(taskId))throw Error('Invalid saved pending task');
      queuedTasks.add(taskId);
    }
  }
  for(const [name,task] of Object.entries(state.tasks)){
    if(!Object.hasOwn(task,'input')||Number(name)!==task.id||!state.scopes[task.lifetime]||metadata(task.queue)?.kind!=='queue'||task.effect.program!==bindings.programIdentity||task.effect.effect>=effectCount||task.effect.selector!==null&&task.effect.selector>=selectorCount)throw Error('Invalid saved task binding');
    if(task.at!==null&&metadata(task.at)?.kind!=='event'||task.condition!==null&&metadata(task.condition)?.kind!=='query')throw Error('Invalid saved task schedule');
    if(task.state==='scheduled'&&task.at===null||task.state==='pending'&&!queuedTasks.has(task.id))throw Error('Invalid saved task phase');
    indexTask(expected,task);
  }
  const queuedEvents=new Set<number>();
  for(const mode of ['queued','immediate'] as const)for(const eventId of inspectDeque(state.eventQueues[mode])){
    const envelope=state.outbox[eventId],definition=envelope&&metadata(envelope.event);
    if(!envelope||!Object.hasOwn(envelope,'payload')||envelope.id!==eventId||definition?.kind!=='event'||definition.dispatch!==mode||queuedEvents.has(eventId))throw Error('Invalid saved event queue');
    queuedEvents.add(eventId);
    for(const handler of envelope.handlers){validRegistration(handler.registration);const ability=metadata(handler.registration.definition);if(ability?.kind!=='ability'||ability.abilityKind!=='event'||bindings.indices.get(ability.target)!==envelope.event)throw Error('Invalid saved captured handler');}
  }
  if(queuedEvents.size!==Object.keys(state.outbox).length)throw Error('Unqueued saved event');
  if(!sameRuleValue(expected.indexes,state.indexes))throw Error('Invalid saved rule indexes');
}
