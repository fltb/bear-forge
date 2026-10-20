import {activateScheduled} from './rules-tasks.ts';
import { makeEntityKind } from './rules-entities.ts';
import type { LifecycleBinding } from './rules-entities.types.ts';
import { resolveCheckpoint } from './rules-checkpoints.ts';
import type { Checkpoint } from './rules-checkpoints.types.ts';
import { captureEvent } from './rules-reactions.ts';
import { dataCopy } from './rules-data.ts';
import {prepareOrdering,resolveOrder} from './rules-order.ts';
import type {RuleOrdering} from './rules-order.types.ts';
import type { CardScope } from './card.types.ts';
import { definitionCapture, definitions, handle } from './rules-internal.ts';
import { declarationCapture, declareStatic, authorities, definitionOwners, modules, resolveDefinition, stateOf, staticDefinitions } from './rules-module-internal.ts';
import type { ModuleBindings } from './rules-module-internal.ts';
import type { AnyEffect } from './rules-internal.ts';
import type { Effect } from './rules.types.ts';
import type { AtomSpec, Component, ComponentReference, ModuleBuilder, Owned, RuleEvent, RuleModule, Schema } from './rules-module.types.ts';
export type { AtomRead, AtomSpec, Component, ModuleBuilder, Owned, RuleEvent, RuleModule, Schema } from './rules-module.types.ts';

function requireSchema(value: Schema<any>): void {
  if (!value || typeof value.parse !== 'function') throw Error('Rule definition requires a schema');
}
export function defineComponent<T>(spec: { schema: Schema<T>; initial: () => T }): Component<T> {
  requireSchema(spec.schema); if (typeof spec.initial !== 'function') throw Error('Component requires an initial value factory');
  const definition=handle<Component<T>>(); declareStatic(definition,{kind:'component',schema:spec.schema,initial:spec.initial});return definition;
}
export function defineEvent<T>(spec: { payload: Schema<T>; dispatch?:'queued'|'immediate';publicEmit?:boolean;order?:RuleOrdering }): RuleEvent<T> {
  requireSchema(spec.payload);const definition=handle<RuleEvent<T>>();declareStatic(definition,{kind:'event',schema:spec.payload,dispatch:spec.dispatch??'queued',publicEmit:spec.publicEmit??false,ordering:prepareOrdering(spec.order)});return definition;
}
export function defineRules<E>(config: { requires: readonly RuleModule<any>[]; build: (module: ModuleBuilder) => { exports: E } }): RuleModule<E> {
  const owner={}, owned:object[]=[], declared:object[]=[], effects:AnyEffect[]=[],lifecycles:LifecycleBinding[]=[]; let building = true;
  const builder:ModuleBuilder={
    own<T extends Component<any>|RuleEvent<any>|Checkpoint<any,any>>(definition:T):Owned<T>{
      if (!building) throw Error('Rule module construction has finished');
      if (!staticDefinitions.has(definition)) throw Error('Cannot own an unknown rule definition');
      if (staticDefinitions.get(definition)!.creator !== owner) throw Error('Cannot claim another module definition');
      if (owned.includes(definition)) throw Error('Rule definition already owned in this module');
      const capability=Object.freeze({public:definition}) as Owned<T>;
      authorities.set(capability,{owner,definition});definitionOwners.set(definition,owner);owned.push(definition);return capability;
    },
    kind(spec){if(!building)throw Error('Rule module construction has finished');return makeEntityKind(spec);},
    lifecycle(scope,spec){
      if(!building)throw Error('Rule module construction has finished');
      if(!scope||typeof scope!=='object')throw Error('Lifetime requires a definition reference');
      if(!staticDefinitions.has(scope))declareStatic(scope,{kind:'scope-kind',ordering:prepareOrdering(scope.order)});
      else if(staticDefinitions.get(scope)?.kind!=='scope-kind')throw Error('Invalid lifetime definition');
      else if(!declared.includes(scope))declared.push(scope);
      const scopeMetadata=staticDefinitions.get(scope);if(scopeMetadata?.kind!=='scope-kind')throw Error('Invalid lifetime definition');
      for(const effect of [spec.initialize,spec.dispose])if(effect&&!definitions.has(effect))throw Error('Unknown scope lifecycle effect');
      lifecycles.push({scope,initialize:spec.initialize??null,dispose:spec.dispose??null,...resolveOrder(scopeMetadata.ordering,spec.order),sequence:lifecycles.length});
    },
    resolve(target,input){return resolveCheckpoint(owner,target,input);},
    atom<I,O,const R extends readonly ComponentReference[],const W extends readonly Owned<Component<any>>[],const E extends readonly Owned<RuleEvent<any>>[]>(spec:AtomSpec<I,O,R,W,E>):Effect<I,O>{
      if (!building) throw Error('Rule module construction has finished');
      requireSchema(spec.input);requireSchema(spec.output);
      if(typeof spec.run!=='function')throw Error('Atom requires a finite implementation');
      const reads=[...spec.reads], writes=[...spec.writes], emits=[...spec.emits];
      const inputSchema=spec.input, outputSchema=spec.output, run=spec.run;
      const effect=handle<Effect<I,O>>();
      definitions.set(effect,{kind:'bound',layout:{source:run.toString(),reads:reads.map(resolveDefinition),writes:writes.map(resolveDefinition),emits:emits.map(resolveDefinition)},bind(bindings:ModuleBindings){
        const readSet=new Set(reads.map(resolveDefinition));
        const writeSet=new Set(writes.map(resolveDefinition)), eventSet=new Set(emits.map(resolveDefinition));
        for(const capability of [...writes,...emits]) {
          const authority=authorities.get(capability);
          if(!authority||authority.owner!==owner||bindings.owners.get(authority.definition)!==owner)throw Error('Unauthorized rule atom authority');
        }
        for(const capability of writes) if(staticDefinitions.get(resolveDefinition(capability))?.kind!=='component')throw Error('Atom writes require component authority');
        for(const capability of emits) if(staticDefinitions.get(resolveDefinition(capability))?.kind!=='event')throw Error('Atom emissions require event authority');
        for(const definition of readSet) {
          if(!bindings.indices.has(definition)||staticDefinitions.get(definition)?.kind!=='component')throw Error('Unbound atom read component');
          if(bindings.owners.get(definition)!==owner && !bindings.readable.get(owner)?.has(definition))throw Error('Unauthorized rule atom read');
          // Read authority is currently explicit dependency/export access; writes remain owner-only.
        }
        return (scope:CardScope<any>,raw:I):O=>{
          const state=stateOf(scope.state);
          const input=inputSchema.parse(dataCopy(raw));
          const proposal=run(Object.freeze({component(entity:number,component:any){
            const definition=resolveDefinition(component);
            if(!readSet.has(definition))throw Error('Undeclared rule atom read');
            const index=bindings.indices.get(definition)!;
            const record=state.entities[entity];
            if(!record||!Object.hasOwn(record.components,index))throw Error('Missing rule component');
            return dataCopy(record.components[index],true);
          }}),dataCopy(input,true));
          if(!proposal||typeof (proposal as any).then==='function')throw Error('Rule atom must be synchronous');
          if(!Array.isArray(proposal.writes)||!Array.isArray(proposal.events))throw Error('Invalid rule proposal');
          const checkedWrites:{entity:number;index:number;value:unknown}[]=[],checkedEvents:{event:number;payload:unknown}[]=[];
          const touched=new Set<string>();
          for(const write of proposal.writes){
            const authority=authorities.get(write.component),definition=resolveDefinition(write.component);
            if(!authority||authority.owner!==owner||!writeSet.has(definition))throw Error('Unauthorized rule proposal write');
            const index=bindings.indices.get(definition);
            if(index===undefined||!state.entities[write.entity]||!Object.hasOwn(state.entities[write.entity]!.components,index))throw Error('Missing rule proposal entity/component');
            const metadata=staticDefinitions.get(definition)!;
            if(metadata.kind!=='component')throw Error('Invalid proposal component');
            const key=write.entity+':'+index;if(touched.has(key))throw Error('Duplicate rule proposal write');touched.add(key);
            checkedWrites.push({entity:write.entity,index,value:dataCopy(metadata.schema.parse(dataCopy(write.value)))});
          }
          for(const event of proposal.events){
            const authority=authorities.get(event.event),definition=resolveDefinition(event.event);
            if(!authority||authority.owner!==owner||!eventSet.has(definition))throw Error('Unauthorized rule proposal event');
            const metadata=staticDefinitions.get(definition)!;
            if(metadata.kind!=='event')throw Error('Invalid proposal event');
            checkedEvents.push({event:bindings.indices.get(definition)!,payload:dataCopy(metadata.schema.parse(dataCopy(event.payload)))});
          }
          const result=dataCopy(outputSchema.parse(dataCopy(proposal.result)));
          const overlay=new Map<number,Map<number,unknown>>();
          for(const write of checkedWrites){let values=overlay.get(write.entity);if(!values){values=new Map();overlay.set(write.entity,values);}values.set(write.index,write.value);}
          const envelopes=checkedEvents.map(event=>captureEvent(event.event,event.payload,scope.state,bindings,overlay));
          if(!Number.isSafeInteger(state.nextEvent)||state.nextEvent+envelopes.length>=Number.MAX_SAFE_INTEGER)throw Error('Event identity exhausted');
          // All author queries, validation and handler capture finish before this commit.

          for(const write of checkedWrites)state.entities[write.entity]!.components[write.index]=write.value;
          for(const envelope of envelopes){state.outbox.push({...envelope,id:state.nextEvent++});activateScheduled(scope.state,envelope.scheduled);}
          return result;
        };
      }});effects.push(effect);return effect;
    },
  };
  const previousModule=declarationCapture.owner, previousDeclarations=declarationCapture.definitions, previousCapture=definitionCapture.current;
  declarationCapture.owner=owner;declarationCapture.definitions=declared;definitionCapture.current=effects;
  let result: { exports: E };
  try { result=config.build(Object.freeze(builder)); }
  finally { declarationCapture.owner=previousModule; declarationCapture.definitions=previousDeclarations; definitionCapture.current=previousCapture; building=false; }
  if(!result||!Object.hasOwn(result,'exports'))throw Error('Rule module requires explicit exports');
  const visited = new Set<object>();
  const validateExports = (value: unknown): void => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    if (authorities.has(value)) throw Error('Module cannot export owner authority');
    if (staticDefinitions.has(value) || definitions.has(value)) return;
    visited.add(value);
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value,key)!;
      if (!Object.hasOwn(descriptor,'value')) throw Error('Module exports cannot contain accessors');
      validateExports(descriptor.value);
    }
    Object.freeze(value);
  };
  validateExports(result.exports);
  const module=Object.freeze({exports:Object.freeze({...result.exports})}) as RuleModule<E>;
  modules.set(module,{owner,requires:Object.freeze([...config.requires]),owned,declared,effects,lifecycles,exports:result.exports});return module;
}
