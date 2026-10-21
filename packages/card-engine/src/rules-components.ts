import { card } from './card.ts';
import { readRuleValue } from './rules-values.ts';
import { definitions,handle,statements,expression,freezeAuthorInput } from './rules-internal.ts';
import { staticDefinitions,stateOf,definitionOwners } from './rules-module-internal.ts';
import type { Borrowed,Command,Effect,Input,Value } from './rules.types.ts';
import type { Component } from './rules-module.types.ts';
export function readComponent<T>(entity:Input<number>,component:Component<T>):Value<Borrowed<T>>{
  const saved=freezeAuthorInput(entity);
  return expression<Borrowed<T>>(null,c=>{
    const index=c.bindings.indices.get(component),metadata=staticDefinitions.get(component),id=c.evaluate(saved);
    if(index===undefined||metadata?.kind!=='component'||definitionOwners.has(component)&&!c.bindings.publicComponents.has(component))throw Error('Component view is not public');
    const record=stateOf(c.world).entities[id];if(!record||!Object.hasOwn(record.components,index))throw Error('Missing component view');
    return readRuleValue(record.components[index]);
  },{inputs:[saved],references:[component]});
}
export function updateLocalComponent<T>(entity:Input<number>,component:Component<T>,update:((value:Borrowed<T>)=>T|Borrowed<T>)|Input<T>):Command<void>{
  const calculate=typeof update==='function'?update as (value:Borrowed<T>)=>T|Borrowed<T>:null;
  const effect=handle<Effect<{entity:number;value?:T},void>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const metadata=staticDefinitions.get(component);
    const index=metadata?.kind==='component'&&!definitionOwners.has(component)?link.register(component):link.bindings.indices.get(component);
    if(metadata?.kind!=='component'||definitionOwners.has(component)||index===undefined)throw Error('Protected components require their owner action');
    return[card.operation(s=>{
      const state=stateOf(s.state),record=state.entities[s.input.entity];
      if(state.sources.at(-1)!==s.input.entity||!record||!Object.hasOwn(record.components,index))throw Error('Private component write requires the active source');
      const next=calculate?calculate(readRuleValue(record.components[index])):s.input.value;
      if(next&&typeof (next as any).then==='function')throw Error('Private component update must be synchronous');
      const value=metadata.schemaPlan.own(next);
      record.components[index]=value;
    }),card.return()];
  }});
  const value=handle<Command<void>>();statements.set(value,{kind:'call',definition:effect,input:{entity,value:calculate?undefined:update}});return value;
}
