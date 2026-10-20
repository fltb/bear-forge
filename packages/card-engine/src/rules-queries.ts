import { dataCopy } from './rules-data.ts';
import {prepareOrdering,compareOrder} from './rules-order.ts';
import { expression, handle, freezeAuthorInput } from './rules-internal.ts';
import { declareStatic, definitionOwners,staticDefinitions, resolveDefinition, stateOf } from './rules-module-internal.ts';
import type { ComponentOverlay, ModuleBindings } from './rules-module-internal.ts';
import type { Input, Value } from './rules.types.ts';
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
}
function queryRead(reads:readonly object[],kinds:readonly object[],dependencies:readonly object[],selections:readonly object[],world:unknown,bindings:ModuleBindings,active:Set<object>,overlay?:ComponentOverlay):QueryRead{
  const definitionIndex=(value:any):number|null=>{
    if(!value||typeof value!=='object')return null;
    if(staticDefinitions.get(value)?.kind==='entity')return bindings.indices.get(value)??null;
    if(value.program!==bindings.programIdentity||!Number.isSafeInteger(value.definition)||value.definition<0||staticDefinitions.get(bindings.definitions[value.definition]!)?.kind!=='entity')return null;
    return value.definition;
  };
  return Object.freeze({
    entities(component:any):readonly number[]{
      const target=resolveDefinition(component),index=bindings.indices.get(target);
      if(!reads.includes(target)||index===undefined)throw Error('Undeclared rule query read');
      return Object.freeze(Object.keys(stateOf(world).entities).map(Number).filter(id=>Object.hasOwn(stateOf(world).entities[id]!.components,index)).sort((a,b)=>a-b));
    },
    component<T>(entity:number,component:any):Readonly<T>{
      const target=resolveDefinition(component),index=bindings.indices.get(target);
      if(!reads.includes(target)||index===undefined)throw Error('Undeclared rule query read');
      const record=stateOf(world).entities[entity];
      if(!record||!Object.hasOwn(record.components,index))throw Error('Missing query component');
      return dataCopy(overlay?.get(entity)?.has(index)?overlay.get(entity)!.get(index):record.components[index],true);
    },
    configuration<C,S>(entity:number,kind:import('./rules-entities.types.ts').EntityKind<C,S>):Readonly<C>{
      if(!kinds.includes(kind))throw Error('Undeclared entity configuration read');
      const record=stateOf(world).entities[entity],definition=record&&record.definition!==null?staticDefinitions.get(bindings.definitions[record.definition]!):null;
      if(definition?.kind!=='entity'||definition.entityKind!==kind)throw Error('Entity kind does not match configuration read');
      return definition.config as Readonly<C>;
    },
    definitionConfiguration<C,S>(reference:import('./rules-entities.types.ts').EntityDefinition<C,S>,kind:import('./rules-entities.types.ts').EntityKind<C,S>):Readonly<C>{
      if(!kinds.includes(kind))throw Error('Undeclared entity configuration read');
      const index=definitionIndex(reference),definition=index===null?null:staticDefinitions.get(bindings.definitions[index]!);
      if(definition?.kind!=='entity'||definition.entityKind!==kind)throw Error('Definition kind does not match configuration read');
      return definition.config as Readonly<C>;
    },
    query<A,B>(other:Query<A,B>,args:A):B{
      if(!dependencies.includes(other))throw Error('Undeclared rule query dependency');
      return evaluateQuery(other,args,world,bindings,active,overlay);
    },
    selected<C,I,O,S>(selection:EntityQuerySelection<C,I,O,S>,entity:number,input:I):O{
      if(!selections.includes(selection))throw Error('Undeclared entity query selection');
      const record=stateOf(world).entities[entity],target=record?.definition===null?null:record&&bindings.querySelections.get(selection)?.get(record.definition);
      if(!target)throw Error('Entity query selection kind mismatch');return evaluateQuery(target,input,world,bindings,active,overlay);
    },
    selectedDefinition<C,I,O,S>(selection:EntityQuerySelection<C,I,O,S>,definition:import('./rules-entities.types.ts').EntityDefinition<C,S>,input:I):O{
      if(!selections.includes(selection))throw Error('Undeclared entity query selection');
      const index=definitionIndex(definition),target=index===null?null:bindings.querySelections.get(selection)?.get(index);
      if(!target)throw Error('Definition query selection kind mismatch');return evaluateQuery(target,input,world,bindings,active,overlay);
    },
    sameDefinition(first:any,second:any):boolean{
      const a=definitionIndex(first),b=definitionIndex(second);return a!==null&&b!==null&&a===b;
    },
  });
}
export function evaluateQuery<I,O>(definition:Query<I,O>,input:I,world:unknown,bindings:ModuleBindings,active=new Set<object>(),overlay?:ComponentOverlay):O{
  const d=staticDefinitions.get(definition);
  if(!bindings.indices.has(definition)||d?.kind!=='query')throw Error('Unbound rule query');
  if(active.has(definition))throw Error('Reentrant rule query');active.add(definition);
  try{
    const parsed=d.input.parse(dataCopy(input,false,value=>{
      const index=bindings.indices.get(value);
      if(staticDefinitions.get(value)?.kind!=='entity'||index===undefined)throw Error('Unbound static entity query argument');
      return{program:bindings.programIdentity,definition:index};
    }));
    let result=d.base(queryRead(d.reads,d.kinds,d.dependencies,d.selections,world,bindings,active,overlay),dataCopy(parsed,true));
    if(result&&typeof result.then==='function')throw Error('Rule query must be synchronous');
    result=dataCopy(d.output.parse(dataCopy(result)));
    const state=stateOf(world);
    const candidates=Object.values(state.registrations).filter(registration=>{
      const metadata=staticDefinitions.get(bindings.definitions[registration.definition]!);
      return metadata?.kind==='ability'&&metadata.abilityKind==='modifier'&&metadata.target===definition;
    }).sort((a,b)=>{
      const ma=staticDefinitions.get(bindings.definitions[a.definition]!)!,mb=staticDefinitions.get(bindings.definitions[b.definition]!)!;
      if(ma.kind!=='ability'||mb.kind!=='ability')throw Error('Invalid modifier order');return compareOrder(ma,mb)||a.sequence-b.sequence;
    });
    for(const registration of candidates){
      const modifier=staticDefinitions.get(bindings.definitions[registration.definition]!);
      if(modifier?.kind!=='ability'||modifier.abilityKind!=='modifier')throw Error('Invalid query modifier');
      const context={input:parsed,value:result,source:registration.source,owner:registration.owner,environment:registration.environment,registration:registration.id};
      if(modifier.eligible!=='captured'&&!Object.hasOwn(state.entities,registration.source))continue;
      if(typeof modifier.eligible==='object'&&!evaluateQuery(modifier.eligible,context,world,bindings,active,overlay))continue;
      if(modifier.condition&&!evaluateQuery(modifier.condition,context,world,bindings,active,overlay))continue;
      const next=modifier.transform(queryRead(modifier.reads,[],modifier.dependencies,modifier.selections,world,bindings,active,overlay),dataCopy(context,true));
      if(next&&typeof next.then==='function')throw Error('Rule modifier must be synchronous');
      result=dataCopy(d.output.parse(dataCopy(next)));
    }
    return result;
  }finally{active.delete(definition);}
}
