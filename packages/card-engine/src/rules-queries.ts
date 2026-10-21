import { ownRuleValue, readRuleValue } from './rules-values.ts';
import {prepareOrdering} from './rules-order.ts';
import { expression, handle, freezeAuthorInput } from './rules-internal.ts';
import { declareStatic, definitionOwners,staticDefinitions, resolveDefinition, stateOf } from './rules-module-internal.ts';
import type { ComponentOverlay, ModuleBindings } from './rules-module-internal.ts';
import type { Borrowed, Input, Value } from './rules.types.ts';
import type { Query, QuerySpec, QueryRead,EntityQuerySelection } from './rules-query.types.ts';
export type { Query, QuerySpec, QueryRead,EntityQuerySelection } from './rules-query.types.ts';

export function captureQuerySelections(input:readonly EntityQuerySelection<any,any,any,any>[]=[]):readonly EntityQuerySelection<any,any,any,any>[]{
  for(const selection of input){
    if(!selection||Object.getPrototypeOf(selection)!==Object.prototype||Object.values(Object.getOwnPropertyDescriptors(selection)).some(d=>!Object.hasOwn(d,'value')))throw Error('Query selection must be a literal with no accessors');
    if(staticDefinitions.get(selection.kind)?.kind!=='entity-kind'||typeof selection.select!=='function')throw Error('Query selection requires a kind and pure selector');Object.freeze(selection);
  }
  return Object.freeze([...input]);
}

export function bindQuerySelections(bindings:ModuleBindings,register:(definition:object)=>number):void{
  let previous=-1;
  const include=(query:Query<any,any>)=>{
    const metadata=staticDefinitions.get(query);if(metadata?.kind!=='query')throw Error('Query selection must return a query');
    if(!bindings.indices.has(query)){if(metadata.creator!==null)throw Error('Unlinked private selected query');register(query);}
  };
  while(previous!==bindings.definitions.length){
    previous=bindings.definitions.length;
    for(const definition of bindings.definitions){
      const metadata=staticDefinitions.get(definition);
      if(metadata?.kind!=='query'&&!(metadata?.kind==='ability'&&metadata.abilityKind==='modifier'))continue;
      for(const dependency of metadata.dependencies)include(dependency);
      for(const selection of metadata.selections){
        if(!bindings.indices.has(selection.kind))throw Error('Unlinked query selection kind');
        let table=bindings.querySelections.get(selection);if(!table){table=new Map();bindings.querySelections.set(selection,table);}
        for(const [index,entity]of bindings.definitions.entries()){
          const entry=staticDefinitions.get(entity);if(entry?.kind!=='entity'||entry.entityKind!==selection.kind||table.has(index))continue;
          const query=selection.select(entry.config as any);include(query);table.set(index,query);
        }
      }
    }
  }
}

export function defineQuery<I,O>(spec:QuerySpec<I,O>):Query<I,O>{
  if(typeof spec.input?.parse!=='function'||typeof spec.output?.parse!=='function'||typeof spec.base!=='function')throw Error('Query requires schemas and a pure base');
  const definition=handle<Query<I,O>>();
  declareStatic(definition,{kind:'query',input:spec.input,output:spec.output,
    reads:Object.freeze([...(spec.reads??[])].map(resolveDefinition)),kinds:Object.freeze([...(spec.kinds??[])]),dependencies:Object.freeze([...(spec.dependencies??[])]),selections:captureQuerySelections(spec.selections),base:spec.base,ordering:prepareOrdering(spec.order)});
  return definition;
}
export function query<I,O>(definition:Query<I,O>,input:Input<I>):Value<O>{
  if(staticDefinitions.get(definition)?.kind!=='query')throw Error('Unknown rule query');
  const saved=freezeAuthorInput(input);
  return expression<O>(null,c=>evaluateQuery(definition,c.evaluate(saved),c.world,c.bindings),{inputs:[saved],references:[definition]});
}
export function validateQueries(bindings:ModuleBindings):void{
  const active=new Set<object>(),done=new Set<object>();
  const validateReads=(creator:object|null,reads:readonly object[])=>{
    for(const component of reads){
      if(staticDefinitions.get(component)?.kind!=='component'||!bindings.indices.has(component))throw Error('Unbound query component');
      if(definitionOwners.has(component)&&!(creator!==null&&bindings.owners.get(component)===creator)&&!bindings.readable.get(creator!)?.has(component)&&!(creator===null&&bindings.publicComponents.has(component)))throw Error('Unauthorized rule query read');
    }
  };
  const visit=(definition:object):void=>{
    if(active.has(definition))throw Error('Cyclic rule query dependency');if(done.has(definition))return;
    const d=staticDefinitions.get(definition);
    if(!bindings.indices.has(definition)||d?.kind!=='query')throw Error('Unbound rule query dependency');
    validateReads(d.creator,d.reads);for(const kind of d.kinds)if(!bindings.indices.has(kind)||staticDefinitions.get(kind)?.kind!=='entity-kind')throw Error('Unlinked query entity kind');active.add(definition);
    for(const dependency of d.dependencies)visit(dependency);
    for(const selection of d.selections)for(const target of bindings.querySelections.get(selection)?.values()??[])visit(target);
    for(const candidate of bindings.definitions){
      const modifier=staticDefinitions.get(candidate);
      if(modifier?.kind==='ability'&&modifier.abilityKind==='modifier'&&modifier.target===definition){
        validateReads(modifier.creator,modifier.reads);
        for(const dependency of modifier.dependencies)visit(dependency);
        for(const selection of modifier.selections)for(const target of bindings.querySelections.get(selection)?.values()??[])visit(target);
        if(modifier.condition)visit(modifier.condition);
        if(typeof modifier.eligible==='object')visit(modifier.eligible);
      }
    }
    active.delete(definition);done.add(definition);
  };
  for(const definition of bindings.indices.keys())if(staticDefinitions.get(definition)?.kind==='query')visit(definition);
  for(const definition of done)bindings.queryExecutors.set(definition,compileQuery(definition,bindings));
}
function prepareRead(reads:readonly object[],kinds:readonly object[],dependencies:readonly object[],selections:readonly object[],bindings:ModuleBindings):(world:unknown,overlay?:ComponentOverlay)=>QueryRead{
  const components=new Map(reads.map(definition=>[definition,bindings.indices.get(definition)!]));
  const allowedKinds=new Set(kinds),allowedDependencies=new Set(dependencies),allowedSelections=new Set(selections);
  // These views carry no mutable query result or continuation. Weak keys avoid
  // retaining a closed Context; each fork/restore has a different world root.
  const views=new WeakMap<object,QueryRead>();
  const definitionIndex=(value:any):number|null=>{
    if(!value||typeof value!=='object')return null;
    if(staticDefinitions.get(value)?.kind==='entity')return bindings.indices.get(value)??null;
    if(value.program!==bindings.programIdentity||!Number.isSafeInteger(value.definition)||value.definition<0||staticDefinitions.get(bindings.definitions[value.definition]!)?.kind!=='entity')return null;
    return value.definition;
  };
  const create=(world:unknown,overlay?:ComponentOverlay):QueryRead=>Object.freeze({
    entities(component:any):readonly number[]{
      const index=components.get(resolveDefinition(component));
      if(index===undefined)throw Error('Undeclared rule query read');
      return Object.freeze([...(stateOf(world).indexes.entitiesByComponent[index]??[])]);
    },
    component<T>(entity:number,component:any):Borrowed<T>{
      const index=components.get(resolveDefinition(component));
      if(index===undefined)throw Error('Undeclared rule query read');
      const record=stateOf(world).entities[entity];
      if(!record||!Object.hasOwn(record.components,index))throw Error('Missing query component');
      return readRuleValue(overlay?.get(entity)?.has(index)?overlay.get(entity)!.get(index):record.components[index]) as Borrowed<T>;
    },
    configuration<C,S>(entity:number,kind:import('./rules-entities.types.ts').EntityKind<C,S>):Borrowed<C>{
      if(!allowedKinds.has(kind))throw Error('Undeclared entity configuration read');
      const record=stateOf(world).entities[entity],definition=record&&record.definition!==null?staticDefinitions.get(bindings.definitions[record.definition]!):null;
      if(definition?.kind!=='entity'||definition.entityKind!==kind)throw Error('Entity kind does not match configuration read');
      return definition.config as Borrowed<C>;
    },
    definitionConfiguration<C,S>(reference:import('./rules-entities.types.ts').EntityDefinition<C,S>,kind:import('./rules-entities.types.ts').EntityKind<C,S>):Borrowed<C>{
      if(!allowedKinds.has(kind))throw Error('Undeclared entity configuration read');
      const index=definitionIndex(reference),definition=index===null?null:staticDefinitions.get(bindings.definitions[index]!);
      if(definition?.kind!=='entity'||definition.entityKind!==kind)throw Error('Definition kind does not match configuration read');
      return definition.config as Borrowed<C>;
    },
    query<A,B>(other:Query<A,B>,args:Borrowed<A>):Borrowed<B>{
      if(!allowedDependencies.has(other))throw Error('Undeclared rule query dependency');
      return evaluateQuery(other,args,world,bindings,overlay);
    },
    selected<C,I,O,S>(selection:EntityQuerySelection<C,I,O,S>,entity:number,input:Borrowed<I>):Borrowed<O>{
      if(!allowedSelections.has(selection))throw Error('Undeclared entity query selection');
      const record=stateOf(world).entities[entity],target=record?.definition===null?null:record&&bindings.querySelections.get(selection)?.get(record.definition);
      if(!target)throw Error('Entity query selection kind mismatch');return evaluateQuery(target,input,world,bindings,overlay);
    },
    selectedDefinition<C,I,O,S>(selection:EntityQuerySelection<C,I,O,S>,definition:import('./rules-entities.types.ts').EntityDefinition<C,S>,input:Borrowed<I>):Borrowed<O>{
      if(!allowedSelections.has(selection))throw Error('Undeclared entity query selection');
      const index=definitionIndex(definition),target=index===null?null:bindings.querySelections.get(selection)?.get(index);
      if(!target)throw Error('Definition query selection kind mismatch');return evaluateQuery(target,input,world,bindings,overlay);
    },
    sameDefinition(first:any,second:any):boolean{
      const a=definitionIndex(first),b=definitionIndex(second);return a!==null&&b!==null&&a===b;
    },
  });
  return(world,overlay)=>{
    if(overlay)return create(world,overlay);
    const root=world as object;let view=views.get(root);
    if(!view){view=create(world);views.set(root,view);}return view;
  };
}
function compileQuery(definition:object,bindings:ModuleBindings):(input:unknown,world:unknown,overlay?:ComponentOverlay)=>unknown{
  const d=staticDefinitions.get(definition);
  if(d?.kind!=='query')throw Error('Unbound rule query');
  const index=bindings.indices.get(definition)!;
  const read=prepareRead(d.reads,d.kinds,d.dependencies,d.selections,bindings);
  const modifiers=new Map<number,{metadata:Extract<import('./rules-module-internal.ts').StaticDefinition,{kind:'ability';abilityKind:'modifier'}>;read:ReturnType<typeof prepareRead>}>();
  for(let candidate=0;candidate<bindings.definitions.length;candidate++){
    const metadata=staticDefinitions.get(bindings.definitions[candidate]!);
    if(metadata?.kind==='ability'&&metadata.abilityKind==='modifier'&&metadata.target===definition)
      modifiers.set(candidate,{metadata,read:prepareRead(metadata.reads,[],metadata.dependencies,metadata.selections,bindings)});
  }
  const lowerReference=(value:object)=>{
      const index=bindings.indices.get(value);
      if(staticDefinitions.get(value)?.kind!=='entity'||index===undefined)throw Error('Unbound static entity query argument');
      return{program:bindings.programIdentity,definition:index};
  };
  return(input,world,overlay)=>{
    const parsed=d.inputPlan.own(input,lowerReference);
    let result=d.base(read(world,overlay),parsed);
    if(result&&typeof result.then==='function')throw Error('Rule query must be synchronous');
    result=d.outputPlan.own(result,lowerReference);
    const state=stateOf(world);
    const candidates=state.indexes.registrationsByTarget[index];
    if(!candidates)return result;
    for(const id of candidates){
      const registration=state.registrations[id]!;
      const bound=modifiers.get(registration.definition)!,modifier=bound.metadata;
      const context={input:parsed,value:result,source:registration.source,owner:registration.owner,environment:registration.environment,registration:registration.id};
      if(modifier.eligible!=='captured'&&!Object.hasOwn(state.entities,registration.source))continue;
      if(typeof modifier.eligible==='object'&&!evaluateQuery(modifier.eligible,context,world,bindings,overlay))continue;
      if(modifier.condition&&!evaluateQuery(modifier.condition,context,world,bindings,overlay))continue;
      const next=modifier.transform(bound.read(world,overlay),ownRuleValue(context));
      if(next&&typeof next.then==='function')throw Error('Rule modifier must be synchronous');
      result=d.outputPlan.own(next,lowerReference);
    }
    return result;
  };
}
export function evaluateQuery<I,O>(definition:Query<I,O>,input:I|Borrowed<I>,world:unknown,bindings:ModuleBindings,overlay?:ComponentOverlay):Borrowed<O>{
  const evaluate=bindings.queryExecutors.get(definition);
  if(!evaluate)throw Error('Unbound rule query');
  return evaluate(input,world,overlay) as Borrowed<O>;
}
