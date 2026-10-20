import {captureScheduled,activateScheduled} from './rules-tasks.ts';
import { card } from './card.ts';
import { dataCopy } from './rules-data.ts';
import {resolveOrder,compareOrder} from './rules-order.ts';
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
function validEntity(state:ReturnType<typeof stateOf>,id:unknown):id is number{
  return typeof id==='number'&&Number.isSafeInteger(id)&&id>=0&&Object.hasOwn(state.entities,id);
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
      const environment=dataCopy(input.environment),id=state.nextRegistration;
      if(!Number.isSafeInteger(id)||id>=Number.MAX_SAFE_INTEGER)throw Error('Registration identity exhausted');
      const registration:Registration={id,definition:index,source:input.source,owner:input.owner,environment,lifetime:input.lifetime,sequence:id};
      state.registrations[id]=registration;state.nextRegistration++;return id;
    },'registration'),card.return(s=>s.locals.registration)];
  }});
  return command(effect,{source:spec.source,owner:spec.owner,environment:spec.environment,lifetime:spec.lifetime});
}
export function uninstall(registration:Input<number>):Command<boolean>{
  const effect=handle<Effect<number,boolean>>();
  definitions.set(effect,{kind:'compiled',lower(){return[card.operation(s=>{
    if(!Number.isSafeInteger(s.input)||s.input<1)throw Error('Invalid registration identity');
    const state=stateOf(s.state),existed=Object.hasOwn(state.registrations,s.input);
    if(existed)delete state.registrations[s.input];return existed;
  },'removed'),card.return(s=>s.locals.removed)];}});
  return command(effect,registration);
}
function reactionInput(registration:Registration,payload:any):ReactionContext<any,any>{
  return{event:payload,source:registration.source,owner:registration.owner,environment:registration.environment,registration:registration.id};
}
export function captureEvent(event:number,payload:any,world:unknown,bindings:ModuleBindings,overlay?:ComponentOverlay):Omit<EventEnvelope,'id'>{
  const state=stateOf(world),definition=bindings.definitions[event];
  if(!definition||staticDefinitions.get(definition)?.kind!=='event')throw Error('Invalid event index');
  const handlers=Object.values(state.registrations).filter(registration=>{
    const metadata=staticDefinitions.get(bindings.definitions[registration.definition]!);
    return metadata?.kind==='ability'&&metadata.abilityKind==='event'&&metadata.target===definition;
  }).sort((a,b)=>{
    const ma=staticDefinitions.get(bindings.definitions[a.definition]!)!,mb=staticDefinitions.get(bindings.definitions[b.definition]!)!;
    if(ma.kind!=='ability'||mb.kind!=='ability')throw Error('Invalid reaction order');return compareOrder(ma,mb)||a.sequence-b.sequence;
  }).filter(registration=>{
    const metadata=staticDefinitions.get(bindings.definitions[registration.definition]!)!;
    return metadata.kind==='ability'&&(!metadata.condition||evaluateQuery(metadata.condition,reactionInput(registration,payload),world,bindings,new Set(),overlay));
  }).map(registration=>({registration:dataCopy(registration)}));
  return{event,payload,handlers,scheduled:captureScheduled(event,payload,world,bindings,overlay)};
}
function dispatcher(mode:'queued'|'immediate'):Effect<void,void>{
  const effect=handle<Effect<void,void>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const eligible=(s:any):boolean=>{
      const captured=s.locals.envelope.handlers[s.locals.cursor].registration as Registration;
      const metadata=staticDefinitions.get(link.bindings.definitions[captured.definition]!);
      if(metadata?.kind!=='ability'||metadata.abilityKind!=='event')throw Error('Invalid captured ability');
      if(metadata.eligible==='captured')return true;
      const state=stateOf(s.state);
      if(!Object.hasOwn(state.registrations,captured.id)||!validEntity(state,captured.source))return false;
      return typeof metadata.eligible==='object'?evaluateQuery(metadata.eligible,reactionInput(captured,s.locals.envelope.payload),s.state,link.bindings):true;
    };
    const next=(s:any):number=>stateOf(s.state).outbox.findIndex(envelope=>{
      const metadata=staticDefinitions.get(link.bindings.definitions[envelope.event]!);
      return metadata?.kind==='event'&&metadata.dispatch===mode;
    });
    return[card.repeat(()=>true,[
      card.operation(next,'position'),
      card.branch(s=>s.locals.position<0,[card.return()]),
      card.operation(s=>{
        const state=stateOf(s.state);s.locals.envelope=state.outbox.splice(s.locals.position,1)[0];s.locals.cursor=0;
      }),
      card.repeat(s=>s.locals.cursor<s.locals.envelope.handlers.length,[
        card.branch(eligible,[card.operation(s=>{stateOf(s.state).sources.push(s.locals.envelope.handlers[s.locals.cursor].registration.source);}),card.invoke(s=>{
          const registration=s.locals.envelope.handlers[s.locals.cursor].registration as Registration;
          const metadata=staticDefinitions.get(link.bindings.definitions[registration.definition]!);
          if(metadata?.kind!=='ability'||metadata.abilityKind!=='event')throw Error('Invalid captured ability');
          const name=link.names.get(metadata.effect);if(!name)throw Error('Unlinked reaction effect');return name;
        },s=>reactionInput(s.locals.envelope.handlers[s.locals.cursor].registration,s.locals.envelope.payload)),card.operation(s=>{if(stateOf(s.state).sources.pop()!==s.locals.envelope.handlers[s.locals.cursor].registration.source)throw Error('Invalid reaction source stack');})]),
        card.operation(s=>{s.locals.cursor++;}),
      ]),
    ])];
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
      const state=stateOf(s.state),parsed=dataCopy(metadata.schema.parse(dataCopy(s.input)));
      const envelope=captureEvent(index,parsed,s.state,link.bindings);
      if(state.nextEvent>=Number.MAX_SAFE_INTEGER)throw Error('Event identity exhausted');
      state.outbox.push({...envelope,id:state.nextEvent++});activateScheduled(s.state,envelope.scheduled);
    }),card.invoke(link.ensure(dispatchImmediateEvents)),card.return()];
  }});return command(effect,payload);
}
