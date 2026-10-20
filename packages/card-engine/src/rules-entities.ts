import type { Component } from './rules-module.types.ts';
import {cancelTask} from './rules-tasks.ts';
import { card } from './card.ts';
import { dataCopy } from './rules-data.ts';
import { definitions,handle,statements,freezeAuthorInput,expression } from './rules-internal.ts';
import { declareStatic,staticDefinitions,resolveDefinition,stateOf } from './rules-module-internal.ts';
import type { ModuleBindings,StaticDefinition } from './rules-module-internal.ts';
import type { Command,Effect,Input,Value } from './rules.types.ts';
import type { EntityDefinition,EntityKind,EntityKindSpec,EntityLifecycle,SpawnSpec } from './rules-entities.types.ts';
export type { EntityDefinition,EntityKind,EntityKindSpec,EntityLifecycle,ScopeKind,LifecycleSpec,ScopeLifecycle,SpawnSpec } from './rules-entities.types.ts';
export function makeEntityKind<C,S=undefined>(spec:EntityKindSpec<C,S>):EntityKind<C,S>{
  if(typeof spec.config?.parse!=='function')throw Error('Entity kind requires a config schema');
  for(const effect of [spec.initialize,spec.dispose])if(effect&&!definitions.has(effect))throw Error('Unknown entity lifecycle effect');
  const kind=handle<EntityKind<C,S>>();declareStatic(kind,{kind:'entity-kind',config:spec.config,setup:spec.setup??{parse(value:unknown){if(value!==undefined)throw Error('This entity kind has no setup input');return undefined;}},components:Object.freeze(spec.components.map(resolveDefinition)),initialize:spec.initialize??null,dispose:spec.dispose??null});return kind;
}
export function defineEntity<C,S=undefined>(kind:EntityKind<C,S>,config:C,options:{components?:readonly Component<any>[]}={}):EntityDefinition<C,S>{
  const metadata=staticDefinitions.get(kind);if(metadata?.kind!=='entity-kind')throw Error('Unknown entity kind');
  const definition=handle<EntityDefinition<C,S>>();declareStatic(definition,{kind:'entity',entityKind:kind,config:freezeAuthorInput(metadata.config.parse(config)),privateComponents:Object.freeze([...(options.components??[])])});return definition;
}
function kindFor(bindings:ModuleBindings,definition:number):Extract<StaticDefinition,{kind:'entity-kind'}>{
  const entity=staticDefinitions.get(bindings.definitions[definition]!);
  const kind=entity?.kind==='entity'&&staticDefinitions.get(entity.entityKind);
  if(!kind||kind.kind!=='entity-kind')throw Error('Invalid entity definition index');return kind;
}
function command<I,O>(effect:Effect<I,O>,input:Input<I>):Command<O>{const value=handle<Command<O>>();statements.set(value,{kind:'call',definition:effect,input});return value;}
export function spawnEntity<C,S=undefined>(spec:SpawnSpec<C,S>):Command<number>{
  const effect=handle<Effect<{definition:{program:string;definition:number};owner:number|null;scope:number;setup:S},number>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const staticEntity=staticDefinitions.get(spec.definition),kindRef=spec.kind??(staticEntity?.kind==='entity'?staticEntity.entityKind:null),kind=kindRef&&staticDefinitions.get(kindRef);
    if(!kind||kind.kind!=='entity-kind'||!link.bindings.indices.has(kindRef!))throw Error('Unlinked entity kind');
    if(staticEntity?.kind==='entity'&&staticEntity.entityKind!==kindRef)throw Error('Spawn definition kind mismatch');
    for(const component of kind.components)if(staticDefinitions.get(component)?.kind!=='component'||!link.bindings.indices.has(component))throw Error('Unlinked entity component');
    const initialize=kind.initialize?link.ensure(kind.initialize):null;
    if(kind.dispose)link.ensure(kind.dispose);
    return[card.operation(s=>{
      const state=stateOf(s.state),input=s.input,scope=state.scopes[input.scope];
      const reference=input.definition;
      if(!reference||reference.program!==link.identity()||!Number.isSafeInteger(reference.definition)||reference.definition<0)throw Error('Invalid entity definition reference');
      const index=reference.definition,entity=staticDefinitions.get(link.bindings.definitions[index]!);
      if(entity?.kind!=='entity'||entity.entityKind!==kindRef)throw Error('Spawn definition kind mismatch');
      const componentDefinitions=[...kind.components,...entity.privateComponents];
      if(new Set(componentDefinitions).size!==componentDefinitions.length)throw Error('Duplicate entity component');
      s.locals.setup=dataCopy(kind.setup.parse(dataCopy(input.setup)));
      if(!Number.isSafeInteger(input.scope)||!scope||scope.phase==='ending'||scope.phase==='closed')throw Error('Invalid entity scope');
      if(input.owner!==null&&(!Number.isSafeInteger(input.owner)||!Object.hasOwn(state.entities,input.owner)))throw Error('Invalid entity owner');
      const components:Record<number,unknown>={};
      for(const component of componentDefinitions){
        const metadata=staticDefinitions.get(component),componentIndex=link.bindings.indices.get(component);
        if(metadata?.kind!=='component'||componentIndex===undefined)throw Error('Invalid entity component');
        components[componentIndex]=dataCopy(metadata.schema.parse(dataCopy(metadata.initial())));
      }
      const id=state.nextEntity;if(!Number.isSafeInteger(id)||id>=Number.MAX_SAFE_INTEGER)throw Error('Entity identity exhausted');
      state.entities[id]={components,definition:index,scope:input.scope,owner:input.owner,phase:'initializing'};state.nextEntity++;
      return id;
    },'entity'),...(initialize?[card.operation(s=>{stateOf(s.state).sources.push(s.locals.entity);}),card.invoke(initialize,s=>({entity:s.locals.entity,owner:s.input.owner,scope:s.input.scope,setup:s.locals.setup})),card.operation(s=>{if(stateOf(s.state).sources.pop()!==s.locals.entity)throw Error('Invalid entity source stack');})]:[]),
    card.operation(s=>{
      const entity=stateOf(s.state).entities[s.locals.entity];if(!entity||entity.phase!=='initializing')throw Error('Entity removed during initialization');entity.phase='active';
    }),card.return(s=>s.locals.entity)];
  }});return command(effect,{definition:spec.definition,owner:spec.owner,scope:spec.scope,setup:spec.setup} as any);
}

export function definitionOf<C,S=undefined>(kind:EntityKind<C,S>,entity:Input<number>):Value<EntityDefinition<C,S>>{
  if(staticDefinitions.get(kind)?.kind!=='entity-kind')throw Error('Definition lookup requires an entity kind');
  const input=freezeAuthorInput(entity);
  return expression<EntityDefinition<C,S>>(null,c=>{
    const record=stateOf(c.world).entities[c.evaluate(input)],definition=record?.definition===null?null:record&&staticDefinitions.get(c.bindings.definitions[record.definition]!);
    if(definition?.kind!=='entity'||definition.entityKind!==kind)throw Error('Entity kind does not match definition lookup');
    return{program:c.identity(),definition:record!.definition};
  },{inputs:[input],references:[kind]});
}
export function despawnEntity(spec:{entity:Input<number>;reason:Input<unknown>}):Command<boolean>{
  const effect=handle<Effect<{entity:number;reason:unknown},boolean>>();
  definitions.set(effect,{kind:'compiled',lower(link){return[
    card.operation(s=>{
      if(!Number.isSafeInteger(s.input.entity)||s.input.entity<0)throw Error('Invalid entity identity');
      const entity=stateOf(s.state).entities[s.input.entity];if(!entity||entity.phase==='removing')return null;
      const kind=entity.definition===null?null:kindFor(link.bindings,entity.definition);
      entity.phase='removing';return{entity:s.input.entity,owner:entity.owner,scope:entity.scope,dispose:kind?.dispose?link.names.get(kind.dispose):null};
    },'removing'),card.branch(s=>s.locals.removing===null,[card.return(()=>false)]),
    card.branch(s=>s.locals.removing.dispose!==null,[card.operation(s=>{stateOf(s.state).sources.push(s.input.entity);}),card.invoke(s=>s.locals.removing.dispose,s=>({entity:s.input.entity,owner:s.locals.removing.owner,scope:s.locals.removing.scope,reason:dataCopy(s.input.reason)})),card.operation(s=>{if(stateOf(s.state).sources.pop()!==s.input.entity)throw Error('Invalid entity source stack');})]),
    card.operation(s=>{
      const state=stateOf(s.state);
      for(const registration of Object.values(state.registrations))if(registration.source===s.input.entity)delete state.registrations[registration.id];
      for(const task of Object.values(state.tasks))if((task.source===s.input.entity&&task.eligible==='source-present')||(task.effect.source===s.input.entity&&task.effect.selector!==null))cancelTask(state,task.id);
      delete state.entities[s.input.entity];
    }),card.return(()=>true),
  ];}});return command(effect,{entity:spec.entity,reason:spec.reason});
}

/** Select static content code at link time; the instance retains only a checked data reference. */
export function entityEffect<C,I,O,S=undefined>(kind:EntityKind<C,S>,entity:Input<number>,select:(config:Readonly<C>)=>Effect<I,O>):Value<Effect<I,O>>{
  if(staticDefinitions.get(kind)?.kind!=='entity-kind'||typeof select!=='function')throw Error('Entity effect requires a kind and selector');
  const saved=freezeAuthorInput(entity);
  const value=expression<Effect<I,O>>(null,c=>c.entityEffect(value,c.evaluate(saved)),{inputs:[saved],references:[kind],source:select.toString(),effectSelector:{kind,select}});
  return value;
}
