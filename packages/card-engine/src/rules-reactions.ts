import {temporaryLocalBlock} from './card-execution-hints.ts';
import {captureScheduled,activateScheduled} from './rules-tasks.ts';
import { card } from './card.ts';
import { detachRuleValue, ownRuleValue } from './rules-values.ts';
import {resolveOrder} from './rules-order.ts';
import { addRegistration, removeRegistration } from './rules-indexes.ts';
import { appendDeque, removeDeque } from './rules-deque.ts';
import { evaluateQuery } from './rules-queries.ts';
import { handle, definitions, statements } from './rules-internal.ts';
import { declareStatic, staticDefinitions, stateOf } from './rules-module-internal.ts';
import type { ComponentOverlay, ModuleBindings } from './rules-module-internal.ts';
import type { Command, Effect, Input } from './rules.types.ts';
import type { RuleEvent } from './rules-module.types.ts';
import type { Ability, InstallSpec, ReactionContext, ReactionSpec, Registration, EventEnvelope } from './rules-reactions.types.ts';
export type { Ability, InstallSpec, ReactionContext, ReactionSpec } from './rules-reactions.types.ts';

function command<I,O>(effect:Effect<I,O>,input:Input<I>):Command<O>{
  const node=handle<Command<O>>();statements.set(node,{kind:'call',definition:effect,input});return node;
}
export function on<T,E={}>(event:RuleEvent<T>,spec:ReactionSpec<T,E>):Ability<E>{
  const eventMetadata=staticDefinitions.get(event);
  if(eventMetadata?.kind!=='event'||!definitions.has(spec.effect))throw Error('Reaction requires a declared event and effect');
  const ability=handle<Ability<E>>();
  declareStatic(ability,{kind:'ability',abilityKind:'event',target:event,effect:spec.effect,
    condition:spec.condition??null,eligible:spec.eligible??'registered',...resolveOrder(eventMetadata.ordering,spec.order)});
  return ability;
}
function validEntity(state:ReturnType<typeof stateOf>,id:number):boolean{
  return Number.isSafeInteger(id)&&id>=0&&Object.hasOwn(state.entities,id);
}
export function install<E>(spec:InstallSpec<E>):Command<number>{
  const effect=handle<Effect<{source:number;owner:number;environment:E;lifetime:number},number>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const metadata=staticDefinitions.get(spec.ability);
    if(metadata?.kind!=='ability')throw Error('Unknown rule ability');
    if(!link.bindings.indices.has(metadata.target))throw Error('Reaction target is not linked');
    for(const query of [metadata.condition,typeof metadata.eligible==='object'?metadata.eligible:null])
      if(query&&!link.bindings.indices.has(query))throw Error('Reaction query is not linked');
    const index=link.register(spec.ability);if(metadata.abilityKind!=='modifier')link.ensure(metadata.effect);
    return[card.operation(s=>{
      const state=stateOf(s.state),input=s.input;
      if(!validEntity(state,input.source)||!validEntity(state,input.owner)||!Number.isSafeInteger(input.lifetime)||input.lifetime<0||!state.scopes[input.lifetime]||state.scopes[input.lifetime]!.phase==='closed'||state.scopes[input.lifetime]!.phase==='ending')throw Error('Invalid reaction installation');
      const environment=ownRuleValue(input.environment),id=state.nextRegistration;
      if(!Number.isSafeInteger(id)||id>=Number.MAX_SAFE_INTEGER)throw Error('Registration identity exhausted');
      const registration:Registration={id,definition:index,source:input.source,owner:input.owner,environment,lifetime:input.lifetime,sequence:id};
      addRegistration(state,link.bindings,registration);state.nextRegistration++;return id;
    },'registration'),card.return(s=>s.locals.registration)];
  }});
  return command(effect,{source:spec.source,owner:spec.owner,environment:spec.environment,lifetime:spec.lifetime});
}
export function uninstall(registration:Input<number>):Command<boolean>{
  const effect=handle<Effect<number,boolean>>();
  definitions.set(effect,{kind:'compiled',lower(link){return[card.operation(s=>{
    if(!Number.isSafeInteger(s.input)||s.input<1)throw Error('Invalid registration identity');
    return removeRegistration(stateOf(s.state),link.bindings,s.input);
  },'removed'),card.return(s=>s.locals.removed)];}});
  return command(effect,registration);
}
function reactionInput(registration:Registration,payload:any):ReactionContext<any,any>{
  return{event:payload,source:registration.source,owner:registration.owner,environment:registration.environment,registration:registration.id};
}
export function captureEvent(event:number,payload:any,world:unknown,bindings:ModuleBindings,overlay?:ComponentOverlay):Omit<EventEnvelope,'id'>{
  const state=stateOf(world);
  const handlers=(state.indexes.registrationsByTarget[event]??[]).map(id=>state.registrations[id]!).filter(registration=>{
    const {metadata}=bindings.reactions.get(registration.definition)!;
    return !metadata.condition||evaluateQuery(metadata.condition,reactionInput(registration,payload),world,bindings,overlay);
  }).map(registration=>({registration:detachRuleValue(registration)}));
  return{event,payload,handlers,scheduled:captureScheduled(event,payload,world,bindings,overlay)};
}
export function commitEvent(world:unknown,envelope:Omit<EventEnvelope,'id'>,mode:'immediate'|'queued'):void{
  const state=stateOf(world),id=state.nextEvent++;
  state.outbox[id]={...envelope,id};appendDeque(state.eventQueues[mode],id);
  activateScheduled(world,envelope.scheduled);
}
function dispatcher(mode:'queued'|'immediate'):Effect<void,void>{
  const effect=handle<Effect<void,void>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const eligible=(s:any):boolean=>{
      const captured=s.locals.envelope.handlers[s.locals.cursor].registration as Registration;
      const {metadata}=link.bindings.reactions.get(captured.definition)!;
      if(metadata.eligible==='captured')return true;
      const state=stateOf(s.state);
      if(!Object.hasOwn(state.registrations,captured.id)||!validEntity(state,captured.source))return false;
      return typeof metadata.eligible==='object'?evaluateQuery(metadata.eligible,reactionInput(captured,s.locals.envelope.payload),s.state,link.bindings):true;
    };
    const next=(s:any):number=>stateOf(s.state).eventQueues[mode].first??-1;
    return temporaryLocalBlock([card.repeat(()=>true,[
      card.operation(next,'position'),
      card.branch(s=>s.locals.position<0,[card.return()]),
      card.operation(s=>{
        const state=stateOf(s.state),id=s.locals.position;s.locals.envelope=state.outbox[id];delete state.outbox[id];removeDeque(state.eventQueues[mode],id);s.locals.cursor=0;
      }),
      card.repeat(s=>s.locals.cursor<s.locals.envelope.handlers.length,[
        card.branch(eligible,[card.operation(s=>{stateOf(s.state).sources.push(s.locals.envelope.handlers[s.locals.cursor].registration.source);}),card.invoke(s=>{
          const registration=s.locals.envelope.handlers[s.locals.cursor].registration as Registration;
          return link.bindings.reactions.get(registration.definition)!.effect;
        },s=>reactionInput(s.locals.envelope.handlers[s.locals.cursor].registration,s.locals.envelope.payload)),card.operation(s=>{if(stateOf(s.state).sources.pop()!==s.locals.envelope.handlers[s.locals.cursor].registration.source)throw Error('Invalid reaction source stack');})]),
        card.operation(s=>{s.locals.cursor++;}),
      ]),
    ])],world=>stateOf(world).eventQueues[mode].size===0);
  }});return effect;
}
/** Used by rule schedulers, not an entity-level bypass for protected event publication. */
export const dispatchQueuedEvents=dispatcher('queued');
export const dispatchImmediateEvents=dispatcher('immediate');

export function emit<T>(event:RuleEvent<T>,payload:Input<T>):Command<void>{
  const effect=handle<Effect<T,void>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const metadata=staticDefinitions.get(event),index=link.bindings.indices.get(event);
    if(metadata?.kind!=='event'||!metadata.publicEmit||index===undefined)throw Error('Event is not publicly publishable');
    return[card.operation(s=>{
      const state=stateOf(s.state),parsed=ownRuleValue(metadata.schemaPlan.apply(s.input));
      const envelope=captureEvent(index,parsed,s.state,link.bindings);
      if(state.nextEvent>=Number.MAX_SAFE_INTEGER)throw Error('Event identity exhausted');
      commitEvent(s.state,envelope,metadata.dispatch);
    }),card.invoke(link.ensure(dispatchImmediateEvents)),card.return()];
  }});return command(effect,payload);
}
