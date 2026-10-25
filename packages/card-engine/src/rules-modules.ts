import {atomProbabilityFor} from './rules-probability.ts';
import {probabilityOperation,type ProbabilityCoordinate} from './probability.ts';
import { makeEntityKind } from './rules-entities.ts';
import type { LifecycleBinding } from './rules-entities.types.ts';
import { resolveCheckpoint } from './rules-checkpoints.ts';
import type { Checkpoint } from './rules-checkpoints.types.ts';
import { captureEvent, commitEvent } from './rules-reactions.ts';
import { readRuleValue } from './rules-values.ts';
import { bindRuleSchema } from './rules-schema.ts';
import {prepareOrdering,resolveOrder} from './rules-order.ts';
import type {RuleOrdering} from './rules-order.types.ts';
import type { CardScope } from './card.types.ts';
import { definitionCapture, definitions, handle } from './rules-internal.ts';
import { declarationCapture, declareStatic, authorities, definitionOwners, modules, resolveDefinition, stateOf, staticDefinitions } from './rules-module-internal.ts';
import type { ModuleBindings } from './rules-module-internal.ts';
import type { AnyEffect } from './rules-internal.ts';
import type { Borrowed, Effect } from './rules.types.ts';
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
        const inputPlan=bindRuleSchema(inputSchema),outputPlan=bindRuleSchema(outputSchema);
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
        const readBindings=new Map<object,number>();
        for(const reference of reads){const definition=resolveDefinition(reference),index=bindings.indices.get(definition)!;readBindings.set(reference,index);readBindings.set(definition,index);}
        const writeBindings=new Map(writes.map(capability=>{
          const definition=resolveDefinition(capability),metadata=staticDefinitions.get(definition)!;
          if(metadata.kind!=='component')throw Error('Atom writes require component authority');
          return[capability,{index:bindings.indices.get(definition)!,plan:metadata.schemaPlan}] as const;
        }));
        const eventBindings=new Map(emits.map(capability=>{
          const definition=resolveDefinition(capability),metadata=staticDefinitions.get(definition)!;
          if(metadata.kind!=='event')throw Error('Atom emissions require event authority');
          return[capability,{index:bindings.indices.get(definition)!,plan:metadata.schemaPlan,dispatch:metadata.dispatch}] as const;
        }));
        const probability = atomProbabilityFor(effect);
        const read=(scope:CardScope<any>)=>{
          const state=stateOf(scope.state);
          return Object.freeze({component(entity:number,component:any){
            const index=readBindings.get(component);
            if(index===undefined)throw Error('Undeclared rule atom read');
            const record=state.entities[entity];
            if(!record||!Object.hasOwn(record.components,index))throw Error('Missing rule component');
            return readRuleValue(record.components[index]);
          }});
        };
        const execute = (scope:CardScope<any>,raw:I,coordinate?:ProbabilityCoordinate):Borrowed<O>=>{
          const state=stateOf(scope.state);
          const input=inputPlan.own(raw);
          const reader=read(scope);
          const proposal=coordinate === undefined ? run(reader,input) : probability!.run(reader,input,coordinate);
          const checkedWrites:{entity:number;index:number;value:unknown}[]=[],checkedEvents:{event:number;payload:unknown;dispatch:'immediate'|'queued'}[]=[];
          const touched=new Map<number,Set<number>>();
          for(const write of proposal.writes){
            const binding=writeBindings.get(write.component);if(!binding)throw Error('Unauthorized rule proposal write');
            const {index,plan}=binding;
            if(!state.entities[write.entity]||!Object.hasOwn(state.entities[write.entity]!.components,index))throw Error('Missing rule proposal entity/component');
            let components=touched.get(write.entity);if(!components){components=new Set();touched.set(write.entity,components);}
            if(components.has(index))throw Error('Duplicate rule proposal write');components.add(index);
            checkedWrites.push({entity:write.entity,index,value:plan.own(write.value)});
          }
          for(const event of proposal.events){
            const binding=eventBindings.get(event.event);if(!binding)throw Error('Unauthorized rule proposal event');
            checkedEvents.push({event:binding.index,payload:binding.plan.own(event.payload),dispatch:binding.dispatch});
          }
          const result=outputPlan.own(proposal.result);
          const overlay=checkedEvents.length?new Map<number,Map<number,unknown>>():undefined;
          if(overlay)for(const write of checkedWrites){let values=overlay.get(write.entity);if(!values){values=new Map();overlay.set(write.entity,values);}values.set(write.index,write.value);}
          const envelopes=checkedEvents.map(event=>captureEvent(event.event,event.payload,scope.state,bindings,overlay));
          if(!Number.isSafeInteger(state.nextEvent)||state.nextEvent+envelopes.length>=Number.MAX_SAFE_INTEGER)throw Error('Event identity exhausted');
          // All author queries, validation and handler capture finish before this commit.

          for(const write of checkedWrites)state.entities[write.entity]!.components[write.index]=write.value;
          for(let index=0;index<envelopes.length;index++)commitEvent(scope.state,envelopes[index]!,checkedEvents[index]!.dispatch);
          return result;
        };
        if (probability) probabilityOperation(execute,{
          space:scope=>probability.space(inputPlan.own(scope.input)),
          ...(probability.boundaryValue?{boundaryValue:(scope:CardScope<any>)=>probability.boundaryValue!(inputPlan.own(scope.input))}:{}),
          ...(probability.publication?{publication:(scope:CardScope<any>,result:unknown)=>probability.publication!(read(scope),inputPlan.own(scope.input),result)}:{}),
          ...(probability.constraints?{constraints:(scope:CardScope<any>,result:unknown)=>probability.constraints!(read(scope),inputPlan.own(scope.input),result)}:{}),
          resolve:(scope,coordinate)=>execute(scope,scope.input,coordinate),
        });
        return execute;
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
