import {compareOrder} from './rules-order.ts';
import {cancelTask} from './rules-tasks.ts';
import { insertIndex, removeIndex, removeRegistration } from './rules-indexes.ts';
import { card } from './card.ts';
import { definitions,handle,statements,expression,freezeAuthorInput } from './rules-internal.ts';
import { stateOf,staticDefinitions,declareStatic } from './rules-module-internal.ts';
import { despawnEntity } from './rules-entities.ts';
import type { Command,Effect,Input,Value } from './rules.types.ts';
import type { ScopeKind,LifecycleBinding } from './rules-entities.types.ts';
function command<I,O>(effect:Effect<I,O>,input:Input<I>):Command<O>{const value=handle<Command<O>>();statements.set(value,{kind:'call',definition:effect,input});return value;}
/** Rule schedulers own scope transitions; these are not exported as entity-facing operations. */
export function openScope(kind:ScopeKind,parent:Input<number>):Command<number>{
  const effect=handle<Effect<number,number>>();definitions.set(effect,{kind:'compiled',lower(link){
    if(staticDefinitions.get(kind)?.kind!=='scope-kind'||!link.bindings.indices.has(kind))throw Error('Unlinked scope kind');
    const callbacks=link.bindings.lifecycles.filter(item=>item.scope===kind).sort((a,b)=>compareOrder(a,b)||a.sequence-b.sequence);
    const names=callbacks.filter(item=>item.initialize!==null).map(item=>link.ensure(item.initialize!));
    return[card.operation(s=>{
      const state=stateOf(s.state),parent=state.scopes[s.input];
      if(!Number.isSafeInteger(s.input)||!parent||parent.phase==='ending'||parent.phase==='closed')throw Error('Invalid parent scope');
      const id=state.nextScope;if(!Number.isSafeInteger(id)||id>=Number.MAX_SAFE_INTEGER)throw Error('Scope identity exhausted');
      state.scopes[id]={kind:link.bindings.indices.get(kind)!,parent:s.input,phase:'initializing'};insertIndex(state.indexes.childrenByScope,s.input,id);state.nextScope++;return id;
    },'scope'),...names.map(name=>card.invoke(name,s=>({scope:s.locals.scope,parent:s.input}))),
    card.operation(s=>{const scope=stateOf(s.state).scopes[s.locals.scope];if(!scope||scope.phase!=='initializing')throw Error('Scope ended during initialization');scope.phase='active';}),card.return(s=>s.locals.scope)];
  }});return command(effect,parent);
}
export function closeScope(scope:Input<number>):Command<boolean>{
  const effect=handle<Effect<number,boolean>>();
  const remove=despawnEntity({entity:0,reason:{kind:'scope-ended'}});
  const removeEffect=statements.get(remove)!.kind==='call'?(statements.get(remove) as Extract<import('./rules-internal.ts').Node,{kind:'call'}>).definition:null;
  definitions.set(effect,{kind:'compiled',lower(link){
    const self=link.ensure(effect),removeName=link.ensure(removeEffect as Effect<any,any>);
    for(const binding of link.bindings.lifecycles)if(binding.dispose)link.ensure(binding.dispose);
    const callbacksByKind=new Map<number,readonly string[]>();
    for(const [definition,index] of link.bindings.indices){
      if(staticDefinitions.get(definition)?.kind!=='scope-kind')continue;
      callbacksByKind.set(index,link.bindings.lifecycles.filter(b=>b.scope===definition&&b.dispose!==null)
        .sort((a,b)=>compareOrder(b,a)||b.sequence-a.sequence).map(b=>link.names.get(b.dispose!)!));
    }
    return[card.operation(s=>{
      if(!Number.isSafeInteger(s.input)||s.input<=0)throw Error('Root scope cannot be ended');
      const state=stateOf(s.state),record=state.scopes[s.input];if(!record||record.phase==='ending'||record.phase==='closed')return null;
      record.phase='ending';
      const callbacks=record.kind===null?[]:callbacksByKind.get(record.kind)??[];
      return{parent:record.parent,callbacks:[...callbacks],children:[...(state.indexes.childrenByScope[s.input]??[])].reverse()};
    },'ending'),card.branch(s=>s.locals.ending===null,[card.return(()=>false)]),
    card.forEach(s=>s.locals.ending.children,self),
    card.operation(()=>0,'cursor'),card.repeat(s=>s.locals.cursor<s.locals.ending.callbacks.length,[
      card.invoke(s=>s.locals.ending.callbacks[s.locals.cursor],s=>({scope:s.input,parent:s.locals.ending.parent})),card.operation(s=>{s.locals.cursor++;}),
    ]),card.operation(s=>(stateOf(s.state).indexes.entitiesByScope[s.input]??[]).map(entity=>({entity,reason:{kind:'scope-ended'}})),'entities'),
    card.forEach(s=>s.locals.entities,removeName),card.operation(s=>{
      const state=stateOf(s.state);for(const id of [...(state.indexes.registrationsByScope[s.input]??[])])removeRegistration(state,link.bindings,id);
      for(const id of [...(state.indexes.tasksByScope[s.input]??[])])cancelTask(state,id);
      const record=state.scopes[s.input]!;record.phase='closed';if(record.parent!==null)removeIndex(state.indexes.childrenByScope,record.parent,s.input);
    }),card.return(()=>true)];
  }});return command(effect,scope);
}
export function scopeOf(entity:Input<number>,kind:ScopeKind):Value<number>{
  const input=freezeAuthorInput(entity);
  return expression<number>(null,c=>{
    const id=c.evaluate(input),state=stateOf(c.world),record=state.entities[id];if(!record)throw Error('Unknown scope owner entity');
    let scope:number|null=record.scope;
    while(scope!==null){const current:typeof state.scopes[number]|undefined=state.scopes[scope];if(!current)throw Error('Invalid scope ancestry');if(current.kind!==null&&c.bindings.definitions[current.kind]===kind&&current.phase!=='closed')return scope;scope=current.parent;}
    throw Error('Requested lifetime scope is absent');
  },{inputs:[input],references:[kind]});
}
