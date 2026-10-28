import type {ChoiceReply} from './rules-choices.types.ts';
import type {PreparedOrdering} from './rules-order.types.ts';
import type {RuleTask} from './rules-tasks.types.ts';
import type { LifecycleBinding } from './rules-entities.types.ts';
import { markStaticHandle } from './rules-internal.ts';
import { bindRuleSchema } from './rules-schema.ts';
import type { RuleSchemaPlan } from './rules-schema.ts';
import { createRuleIndexes, indexEntity } from './rules-indexes.ts';
import type { RuleIndexes } from './rules-indexes.ts';
import { createDeque } from './rules-deque.ts';
import type { RuleDeque } from './rules-deque.ts';
import type { Component, RuleEvent, RuleModule, Schema } from './rules-module.types.ts';
import type { Registration, EventEnvelope } from './rules-reactions.types.ts';
import type { Query, QueryRead,EntityQuerySelection } from './rules-query.types.ts';
import type { AnyEffect } from './rules-internal.ts';
export type AbilityBase={kind:'ability';creator:object|null;target:object;condition:Query<any,boolean>|null;eligible:'captured'|'registered'|Query<any,boolean>;phase:number;order:number};
export type StaticDefinition =
  | { kind: 'component'; creator: object | null; schema: Schema<any>; schemaPlan:RuleSchemaPlan<any>; initial: () => any }
  | { kind: 'event'; creator: object | null; schema: Schema<any>; schemaPlan:RuleSchemaPlan<any>; dispatch:'queued'|'immediate';publicEmit:boolean;ordering:PreparedOrdering }
  | {kind:'entity-kind';creator:object|null;config:Schema<any>;setup:Schema<any>;setupPlan:RuleSchemaPlan<any>;components:readonly object[];initialize:AnyEffect|null;dispose:AnyEffect|null}
  | {kind:'entity';creator:object|null;entityKind:object;config:unknown;privateComponents:readonly object[]}
  | {kind:'choice-adapter';creator:object|null;port:string;request:Query<any,any>;reply:Schema<any>;decode:(request:any,reply:any)=>ChoiceReply}
  | {kind:'queue';creator:object|null}
  | {kind:'scope-kind';creator:object|null;ordering:PreparedOrdering}
  | { kind: 'checkpoint';creator:object|null;input:Schema<any>;output:Schema<any>;inputPlan:RuleSchemaPlan<any>;outputPlan:RuleSchemaPlan<any>;initial:(input:any)=>any;ordering:PreparedOrdering }
  | (AbilityBase & {abilityKind:'event'|'replacement';effect:AnyEffect})
  | (AbilityBase & {abilityKind:'modifier';reads:readonly object[];dependencies:readonly Query<any,any>[];selections:readonly EntityQuerySelection<any,any,any,any>[];transform:(read:QueryRead,input:any)=>any})
  | { kind: 'query'; creator: object | null; input:Schema<any>;output:Schema<any>;inputPlan:RuleSchemaPlan<any>;outputPlan:RuleSchemaPlan<any>;reads:readonly object[];kinds:readonly object[];dependencies:readonly Query<any,any>[];selections:readonly EntityQuerySelection<any,any,any,any>[];base:(read:QueryRead,input:any)=>any;ordering:PreparedOrdering };
export type ModuleData = {
  owner: object;
  requires: readonly RuleModule<any>[];
  owned: object[];
  declared: object[];
  effects: AnyEffect[];
  exports: unknown;
  lifecycles:LifecycleBinding[];
};
export type ComponentSlot = { index: number; create: () => unknown };
export type EntityLayout = { kind: object; components: readonly ComponentSlot[]; dispose: AnyEffect | null };
export type ModuleBindings = {
  indices: ReadonlyMap<object, number>;
  definitions: object[];
  owners: ReadonlyMap<object, object>;
  readable: ReadonlyMap<object, ReadonlySet<object>>;
  publicComponents:ReadonlySet<object>;
  lifecycles:readonly LifecycleBinding[];
  querySelections:Map<object,Map<number,Query<any,any>>>;
  queryExecutors:Map<object,(input:unknown,world:unknown,overlay?:ComponentOverlay)=>unknown>;
  entityLayouts:Map<number,EntityLayout>;
  initialComponents:ComponentSlot[];
  reactions:Map<number,{metadata:Extract<StaticDefinition,{kind:'ability';abilityKind:'event'|'replacement'}>;effect:string}>;
  programIdentity:string;
};
export type ModuleState = {
  indexes: RuleIndexes;
  entities: Record<number, { components: Record<number, any>;definition:number|null;scope:number;owner:number|null;phase:'initializing'|'active'|'removing' }>;
  scopes:Record<number,{kind:number|null;parent:number|null;phase:'initializing'|'active'|'ending'|'closed'}>;
  nextEntity:number;
  nextScope:number;
  sources:number[];
  tasks:Record<number,RuleTask>;
  queues:Record<number,RuleDeque>;
  nextTask:number;
  outbox: Record<number,EventEnvelope>;
  eventQueues: { queued: RuleDeque; immediate: RuleDeque };
  registrations: Record<number,Registration>;
  nextRegistration:number;
  nextEvent:number;
};
export const declarationCapture: { owner:object|null; definitions:object[]|null }={owner:null,definitions:null};
export function declareStatic(definition:object,metadata:StaticDeclaration):void{
  markStaticHandle(definition);
  const plans=metadata.kind==='component'||metadata.kind==='event'?{schemaPlan:bindRuleSchema(metadata.schema)}
    :metadata.kind==='query'||metadata.kind==='checkpoint'?{inputPlan:bindRuleSchema(metadata.input),outputPlan:bindRuleSchema(metadata.output)}
    :metadata.kind==='entity-kind'?{setupPlan:bindRuleSchema(metadata.setup)}:{};
  staticDefinitions.set(definition,{...metadata,...plans,creator:declarationCapture.owner} as StaticDefinition);
  declarationCapture.definitions?.push(definition);
}
type WithoutCreator<T> = T extends {creator:unknown}?Omit<T,'creator'|'schemaPlan'|'inputPlan'|'outputPlan'|'setupPlan'>:never;
export type StaticDeclaration=WithoutCreator<StaticDefinition>;
export const staticDefinitions = new WeakMap<object, StaticDefinition>();
export const definitionOwners = new WeakMap<object,object>();
export const authorities = new WeakMap<object, { owner: object; definition: object }>();
export const modules = new WeakMap<object, ModuleData>();
export function resolveDefinition(value: object): object { return authorities.get(value)?.definition ?? value; }
export function stateOf(root: any): ModuleState {
  return root.$rules;
}
export function bindModules(input: readonly RuleModule<any>[]): { bindings: ModuleBindings; effects: AnyEffect[] } {
  if (new Set(input).size !== input.length) throw Error('Duplicate root rule module');
  const active = new Set<object>(), done = new Set<object>(), owners = new Map<object, object>(), indices = new Map<object, number>();
  const lifecycles:LifecycleBinding[]=[];
  const effects: AnyEffect[] = [], readable = new Map<object,Set<object>>();
  const visit = (module: RuleModule<any>) => {
    if (active.has(module)) throw Error('Cyclic rule module dependency');
    if (done.has(module)) return;
    const data = modules.get(module); if (!data) throw Error('Unbound rule module');
    active.add(module); for (const dependency of data.requires) visit(dependency);
    for (const definition of data.owned) {
      if (owners.has(definition)) throw Error('Rule definition has multiple owners');
      owners.set(definition, data.owner); indices.set(definition, indices.size);
    }
    for(const definition of data.declared){
      if(['query','entity-kind','scope-kind'].includes(staticDefinitions.get(definition)?.kind??'')){
        if(indices.has(definition))continue;
        owners.set(definition,data.owner);indices.set(definition,indices.size);
      }
    }
    const imports = new Set<object>(), seen = new Set<object>();
    const collect = (value: unknown): void => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (staticDefinitions.get(value)?.kind === 'component') { imports.add(value); return; }
      for (const item of Object.values(value)) collect(item);
    };
    for (const dependency of data.requires) collect(modules.get(dependency)!.exports);
    readable.set(data.owner,imports);
    lifecycles.push(...data.lifecycles.map(binding=>({...binding,sequence:lifecycles.length+binding.sequence})));
    effects.push(...data.effects); active.delete(module); done.add(module);
  };
  for (const module of input) visit(module);
  for(const definition of indices.keys()){
    const kind=staticDefinitions.get(definition);
    if(kind?.kind==='entity-kind'){
      if(new Set(kind.components).size!==kind.components.length)throw Error('Duplicate entity kind component');
      for(const component of kind.components){
        if(staticDefinitions.get(component)?.kind!=='component'||!indices.has(component))throw Error('Unbound entity kind component');
        if(owners.get(component)!==kind.creator&&!readable.get(kind.creator!)?.has(component))throw Error('Unauthorized entity component installation');
      }
    }
  }
  const publicComponents=new Set<object>(),seenPublic=new Set<object>();
  const collectPublic=(value:unknown):void=>{
    if(!value||typeof value!=='object'||seenPublic.has(value))return;seenPublic.add(value);
    if(staticDefinitions.get(value)?.kind==='component'){publicComponents.add(value);return;}
    for(const child of Object.values(value))collectPublic(child);
  };
  for(const module of done)collectPublic(modules.get(module)!.exports);
  return { bindings: { owners, indices, definitions:[...indices.keys()], readable, publicComponents, lifecycles,querySelections:new Map(),queryExecutors:new Map(),entityLayouts:new Map(),initialComponents:[],reactions:new Map(),programIdentity:'' }, effects };
}
/** Content registration is now complete. Build all component layouts once. */
export function bindEntityLayouts(bindings:ModuleBindings):void{
  const components=new Map<object,ComponentSlot>();
  for(const [definition,index] of bindings.indices){
    const metadata=staticDefinitions.get(definition)!;
    if(metadata.kind!=='component')continue;
    const slot={index,create:()=>metadata.schemaPlan.own(metadata.initial())};
    components.set(definition,slot);if(definitionOwners.has(definition))bindings.initialComponents.push(slot);
  }
  for(const [definition,index] of bindings.indices){
    const metadata=staticDefinitions.get(definition)!;if(metadata.kind!=='entity')continue;
    const kind=staticDefinitions.get(metadata.entityKind);
    if(kind?.kind!=='entity-kind')throw Error('Invalid entity definition kind');
    const definitions=[...kind.components,...metadata.privateComponents];
    if(new Set(definitions).size!==definitions.length)throw Error('Duplicate entity component');
    const slots=definitions.map(definition=>{const slot=components.get(definition);if(!slot)throw Error('Invalid entity component');return slot;});
    bindings.entityLayouts.set(index,{kind:metadata.entityKind,components:slots,dispose:kind.dispose});
  }
}
export function createModuleState(bindings: ModuleBindings, entities: readonly number[]): ModuleState {
  const state: ModuleState = { indexes:createRuleIndexes(), entities: {}, outbox: {}, eventQueues:{queued:createDeque(),immediate:createDeque()}, registrations:{}, nextRegistration:1, nextEvent:1,scopes:{0:{kind:null,parent:null,phase:'active'}},nextScope:1,nextEntity:1,sources:[],tasks:{},queues:{},nextTask:1 };
  for (const entity of entities) {
    const components: Record<number, any> = {};
    for (const slot of bindings.initialComponents) components[slot.index] = slot.create();
    state.entities[entity] = { components,definition:null,scope:0,owner:null,phase:'active' };
    state.nextEntity=Math.max(state.nextEntity,entity+1);
  }
  // Component factories retain caller order; only the redundant ID indexes sort.
  for(const entity of [...entities].sort((a,b)=>a-b))indexEntity(state,entity);
  return state;
}
export type AnyComponent = Component<any>;
export type AnyEvent = RuleEvent<any>;

export type ComponentOverlay=ReadonlyMap<number,ReadonlyMap<number,unknown>>;
