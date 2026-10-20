import type {ChoiceReply} from './rules-choices.types.ts';
import type {PreparedOrdering} from './rules-order.types.ts';
import type {RuleTask} from './rules-tasks.types.ts';
import type { LifecycleBinding } from './rules-entities.types.ts';
import { markStaticHandle } from './rules-internal.ts';
import { dataCopy } from './rules-data.ts';
import type { Component, RuleEvent, RuleModule, Schema } from './rules-module.types.ts';
import type { Registration, EventEnvelope } from './rules-reactions.types.ts';
import type { Query, QueryRead,EntityQuerySelection } from './rules-query.types.ts';
import type { AnyEffect } from './rules-internal.ts';
export type AbilityBase={kind:'ability';creator:object|null;target:object;condition:Query<any,boolean>|null;eligible:'captured'|'registered'|Query<any,boolean>;phase:number;order:number};
export type StaticDefinition =
  | { kind: 'component'; creator: object | null; schema: Schema<any>; initial: () => any }
  | { kind: 'event'; creator: object | null; schema: Schema<any>; dispatch:'queued'|'immediate';publicEmit:boolean;ordering:PreparedOrdering }
  | {kind:'entity-kind';creator:object|null;config:Schema<any>;setup:Schema<any>;components:readonly object[];initialize:AnyEffect|null;dispose:AnyEffect|null}
  | {kind:'entity';creator:object|null;entityKind:object;config:unknown;privateComponents:readonly object[]}
  | {kind:'choice-adapter';creator:object|null;port:string;request:Query<any,any>;reply:Schema<any>;decode:(request:any,reply:any)=>ChoiceReply}
  | {kind:'queue';creator:object|null}
  | {kind:'scope-kind';creator:object|null;ordering:PreparedOrdering}
  | { kind: 'checkpoint';creator:object|null;input:Schema<any>;output:Schema<any>;initial:(input:any)=>any;ordering:PreparedOrdering }
  | (AbilityBase & {abilityKind:'event'|'replacement';effect:AnyEffect})
  | (AbilityBase & {abilityKind:'modifier';reads:readonly object[];dependencies:readonly Query<any,any>[];selections:readonly EntityQuerySelection<any,any,any,any>[];transform:(read:QueryRead,input:any)=>any})
  | { kind: 'query'; creator: object | null; input:Schema<any>;output:Schema<any>;reads:readonly object[];kinds:readonly object[];dependencies:readonly Query<any,any>[];selections:readonly EntityQuerySelection<any,any,any,any>[];base:(read:QueryRead,input:any)=>any;ordering:PreparedOrdering };
export type ModuleData = {
  owner: object;
  requires: readonly RuleModule<any>[];
  owned: object[];
  declared: object[];
  effects: AnyEffect[];
  exports: unknown;
  lifecycles:LifecycleBinding[];
};
export type ModuleBindings = {
  indices: ReadonlyMap<object, number>;
  definitions: object[];
  owners: ReadonlyMap<object, object>;
  readable: ReadonlyMap<object, ReadonlySet<object>>;
  publicComponents:ReadonlySet<object>;
  lifecycles:readonly LifecycleBinding[];
  querySelections:Map<object,Map<number,Query<any,any>>>;
  programIdentity:string;
};
export type ModuleState = {
  entities: Record<number, { components: Record<number, any>;definition:number|null;scope:number;owner:number|null;phase:'initializing'|'active'|'removing' }>;
  scopes:Record<number,{kind:number|null;parent:number|null;phase:'initializing'|'active'|'ending'|'closed'}>;
  nextEntity:number;
  nextScope:number;
  sources:number[];
  tasks:Record<number,RuleTask>;
  queues:Record<number,number[]>;
  nextTask:number;
  outbox: EventEnvelope[];
  registrations: Record<number,Registration>;
  nextRegistration:number;
  nextEvent:number;
};
export const declarationCapture: { owner:object|null; definitions:object[]|null }={owner:null,definitions:null};
export function declareStatic(definition:object,metadata:StaticDeclaration):void{
  markStaticHandle(definition);
  staticDefinitions.set(definition,{...metadata,creator:declarationCapture.owner} as StaticDefinition);
  declarationCapture.definitions?.push(definition);
}
type WithoutCreator<T> = T extends {creator:unknown}?Omit<T,'creator'>:never;
export type StaticDeclaration=WithoutCreator<StaticDefinition>;
export const staticDefinitions = new WeakMap<object, StaticDefinition>();
export const definitionOwners = new WeakMap<object,object>();
export const authorities = new WeakMap<object, { owner: object; definition: object }>();
export const modules = new WeakMap<object, ModuleData>();
export function resolveDefinition(value: object): object { return authorities.get(value)?.definition ?? value; }
export function stateOf(root: any): ModuleState {
  if (!root || !root.$rules || !root.$rules.entities || !Array.isArray(root.$rules.outbox)||!root.$rules.registrations||!Number.isSafeInteger(root.$rules.nextRegistration)||!Number.isSafeInteger(root.$rules.nextEvent)) throw Error('Rule module state is missing');
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
  return { bindings: { owners, indices, definitions:[...indices.keys()], readable, publicComponents, lifecycles,querySelections:new Map(),programIdentity:'' }, effects };
}
export function createModuleState(bindings: ModuleBindings, entities: readonly number[]): ModuleState {
  const state: ModuleState = { entities: {}, outbox: [], registrations:{}, nextRegistration:1, nextEvent:1,scopes:{0:{kind:null,parent:null,phase:'active'}},nextScope:1,nextEntity:1,sources:[],tasks:{},queues:{},nextTask:1 };
  for (const entity of entities) {
    if (!Number.isSafeInteger(entity) || entity < 0 || entity>=Number.MAX_SAFE_INTEGER || Object.hasOwn(state.entities, entity)) throw Error('Invalid initial rule entity');
    const components: Record<number, any> = {};
    for (const [definition, index] of bindings.indices) {
      const metadata = staticDefinitions.get(definition)!;
      if (metadata.kind === 'component' && definitionOwners.has(definition)) components[index] = dataCopy(metadata.schema.parse(dataCopy(metadata.initial())));
    }
    state.entities[entity] = { components,definition:null,scope:0,owner:null,phase:'active' };
    state.nextEntity=Math.max(state.nextEntity,entity+1);
  }
  return state;
}
export type AnyComponent = Component<any>;
export type AnyEvent = RuleEvent<any>;

export type ComponentOverlay=ReadonlyMap<number,ReadonlyMap<number,unknown>>;
