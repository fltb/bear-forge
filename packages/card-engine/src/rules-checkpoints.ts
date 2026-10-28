import { card } from './card.ts';
import { ownRuleValue, sameRuleValue } from './rules-values.ts';
import {prepareOrdering,resolveOrder,compareOrder} from './rules-order.ts';
import type {RuleOrder} from './rules-order.types.ts';
import { definitions, handle, statements } from './rules-internal.ts';
import { authorities, declareStatic, staticDefinitions, stateOf } from './rules-module-internal.ts';
import { evaluateQuery } from './rules-queries.ts';
import type { Ability } from './rules-reactions.types.ts';
import type { Registration } from './rules-reactions.types.ts';
import type { Checkpoint, CheckpointSpec, ReplacementResult, ReplacementSpec } from './rules-checkpoints.types.ts';
import type { Command, Effect, Input } from './rules.types.ts';
import type { Owned } from './rules-module.types.ts';
import type { Query } from './rules-query.types.ts';
export type { Checkpoint, CheckpointSpec, ReplacementContext, ReplacementResult, ReplacementSpec } from './rules-checkpoints.types.ts';
export function defineCheckpoint<I,O=I>(spec:CheckpointSpec<I,O>):Checkpoint<I,O>{
  if(typeof spec.input?.parse!=='function'||typeof spec.output?.parse!=='function')throw Error('Checkpoint requires schemas');
  const definition=handle<Checkpoint<I,O>>();declareStatic(definition,{kind:'checkpoint',input:spec.input,output:spec.output,initial:spec.initial??((input:any)=>input),ordering:prepareOrdering(spec.order)});return definition;
}
export function replace<I,O,E={}>(target:Checkpoint<I,O>,spec:ReplacementSpec<O,E>):Ability<E>{
  const targetMetadata=staticDefinitions.get(target);
  if(targetMetadata?.kind!=='checkpoint'||!definitions.has(spec.effect))throw Error('Replacement requires a checkpoint and effect');
  const ability=handle<Ability<E>>();declareStatic(ability,{kind:'ability',abilityKind:'replacement',target,effect:spec.effect,
    condition:spec.condition??null,eligible:spec.eligible??'registered',...resolveOrder(targetMetadata.ordering,spec.order)});return ability;
}
export function restrict<I,O,E={}>(target:Checkpoint<I,O>,spec:{when:Query<any,boolean>;reason:unknown;order?:RuleOrder}):Ability<E>{
  const reason=ownRuleValue(spec.reason),effect=handle<Effect<any,ReplacementResult<O>>>();
  definitions.set(effect,{kind:'compiled',lower(){return[card.return(()=>({kind:'cancel',reason}))];}});
  return replace(target,{effect,condition:spec.when,...(spec.order===undefined?{}:{order:spec.order})});
}
/** Only the defining module can invoke a checkpoint; entities may install its replacement abilities. */
export function resolveCheckpoint<I,O>(owner:object,target:Owned<Checkpoint<I,O>>,input:Input<I>):Command<ReplacementResult<O>>{
  const effect=handle<Effect<I,ReplacementResult<O>>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const authority=authorities.get(target),metadata=authority&&staticDefinitions.get(authority.definition);
    if(!authority||authority.owner!==owner||link.bindings.owners.get(authority.definition)!==owner||metadata?.kind!=='checkpoint')throw Error('Unauthorized rule checkpoint execution');
    const targetIndex=link.bindings.indices.get(authority.definition)!;
    const context=(s:any,registration:any)=>({value:s.locals.value,source:registration.source,owner:registration.owner,environment:registration.environment,registration:registration.id});
    const qualified=(s:any,registration:any,checkCondition=true):boolean=>{
      const {metadata:ability}=link.bindings.reactions.get(registration.definition)!;
      if(ability.eligible!=='captured'){
        const state=stateOf(s.state);
        if(!Object.hasOwn(state.registrations,registration.id)||!Object.hasOwn(state.entities,registration.source))return false;
        if(typeof ability.eligible==='object'&&!evaluateQuery(ability.eligible,context(s,registration),s.state,link.bindings))return false;
      }
      return !checkCondition||!ability.condition||evaluateQuery(ability.condition,context(s,registration),s.state,link.bindings);
    };
    return[card.operation(s=>{
      const parsed=metadata.inputPlan.own(s.input);s.locals.value=metadata.outputPlan.own(metadata.initial(parsed));s.locals.applied=Object.create(null);s.locals.changed=false;
    }),card.repeat(()=>true,[
      card.operation(s=>{
        const state=stateOf(s.state);let selected:Registration|null=null;
        // Conditions retain registration-arrival order; ranking chooses the
        // same first qualified replacement without sorting on every retry.
        // Membership is Context data with constant-time lookup, not a scan of
        // the growing applied prefix inside this already repeated scan.
        const candidates=state.indexes.registrationsByTargetArrival[targetIndex];
        const nextIds=candidates?.next??null;
        for(let id=candidates?.first??null;id!==null;id=nextIds===null?null:nextIds[id]!){
          const registration=state.registrations[id]!;
          if(Object.hasOwn(s.locals.applied,id)||!qualified(s,registration))continue;
          if(selected===null){selected=registration;continue;}
          const next=staticDefinitions.get(link.bindings.definitions[registration.definition]!)!,previous=staticDefinitions.get(link.bindings.definitions[selected.definition]!)!;
          if(next.kind==='ability'&&previous.kind==='ability'&&(compareOrder(next,previous)||registration.sequence-selected.sequence)<0)selected=registration;
        }
        return selected===null?null:selected;
      },'candidate'),
      card.branch(s=>s.locals.candidate===null,[card.return(s=>({kind:s.locals.changed?'change':'keep',value:s.locals.value}))]),
      card.operation(s=>{s.locals.applied[s.locals.candidate.id]=true;stateOf(s.state).sources.push(s.locals.candidate.source);}),
      card.invoke(s=>{
        return link.bindings.reactions.get(s.locals.candidate.definition)!.effect;
      },s=>context(s,s.locals.candidate),'replacement'),
      card.operation(s=>{if(stateOf(s.state).sources.pop()!==s.locals.candidate.source)throw Error('Invalid replacement source stack');}),
      card.branch(s=>qualified(s,s.locals.candidate,false),[
        card.operation(s=>{
          const result=s.locals.replacement;
          if(result.kind==='cancel')s.locals.cancelled=ownRuleValue(result);
          else{
            const value=metadata.outputPlan.own(result.value);
            if(result.kind==='keep'){if(!sameRuleValue(value,s.locals.value))throw Error('Keep result cannot change checkpoint value');}
            else{s.locals.value=value;s.locals.changed=true;}
          }
        }),
        card.branch(s=>Object.hasOwn(s.locals,'cancelled'),[card.return(s=>s.locals.cancelled)]),
      ]),
    ])];
  }});
  const node=handle<Command<ReplacementResult<O>>>();statements.set(node,{kind:'call',definition:effect,input});return node;
}
