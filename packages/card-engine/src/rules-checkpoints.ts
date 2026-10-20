import { card } from './card.ts';
import { dataCopy, sameRuleData } from './rules-data.ts';
import {prepareOrdering,resolveOrder,compareOrder} from './rules-order.ts';
import type {RuleOrder} from './rules-order.types.ts';
import { definitions, handle, statements } from './rules-internal.ts';
import { authorities, declareStatic, staticDefinitions, stateOf } from './rules-module-internal.ts';
import { evaluateQuery } from './rules-queries.ts';
import type { Ability } from './rules-reactions.types.ts';
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
  const reason=dataCopy(spec.reason,true),effect=handle<Effect<any,ReplacementResult<O>>>();
  definitions.set(effect,{kind:'compiled',lower(){return[card.return(()=>({kind:'cancel',reason:dataCopy(reason)}))];}});
  return replace(target,{effect,condition:spec.when,...(spec.order===undefined?{}:{order:spec.order})});
}
/** Only the defining module can invoke a checkpoint; entities may install its replacement abilities. */
export function resolveCheckpoint<I,O>(owner:object,target:Owned<Checkpoint<I,O>>,input:Input<I>):Command<ReplacementResult<O>>{
  const effect=handle<Effect<I,ReplacementResult<O>>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const authority=authorities.get(target),metadata=authority&&staticDefinitions.get(authority.definition);
    if(!authority||authority.owner!==owner||link.bindings.owners.get(authority.definition)!==owner||metadata?.kind!=='checkpoint')throw Error('Unauthorized rule checkpoint execution');
    const context=(s:any,registration:any)=>({value:s.locals.value,source:registration.source,owner:registration.owner,environment:registration.environment,registration:registration.id});
    const qualified=(s:any,registration:any,checkCondition=true):boolean=>{
      const ability=staticDefinitions.get(link.bindings.definitions[registration.definition]!);
      if(ability?.kind!=='ability'||ability.abilityKind!=='replacement')return false;
      if(ability.eligible!=='captured'){
        const state=stateOf(s.state);
        if(!Object.hasOwn(state.registrations,registration.id)||!Object.hasOwn(state.entities,registration.source))return false;
        if(typeof ability.eligible==='object'&&!evaluateQuery(ability.eligible,context(s,registration),s.state,link.bindings))return false;
      }
      return !checkCondition||!ability.condition||evaluateQuery(ability.condition,context(s,registration),s.state,link.bindings);
    };
    return[card.operation(s=>{
      const parsed=metadata.input.parse(dataCopy(s.input));s.locals.value=dataCopy(metadata.output.parse(metadata.initial(dataCopy(parsed,true))));s.locals.applied=[];s.locals.changed=false;
    }),card.repeat(()=>true,[
      card.operation(s=>{
        const candidates=Object.values(stateOf(s.state).registrations).filter(r=>{
          const a=staticDefinitions.get(link.bindings.definitions[r.definition]!);
          return a?.kind==='ability'&&a.abilityKind==='replacement'&&a.target===authority.definition&&!s.locals.applied.includes(r.id)&&qualified(s,r);
        }).sort((a,b)=>{
          const ma=staticDefinitions.get(link.bindings.definitions[a.definition]!)!,mb=staticDefinitions.get(link.bindings.definitions[b.definition]!)!;
          if(ma.kind!=='ability'||mb.kind!=='ability')throw Error('Invalid replacement order');return compareOrder(ma,mb)||a.sequence-b.sequence;
        });return candidates.length?dataCopy(candidates[0]):null;
      },'candidate'),
      card.branch(s=>s.locals.candidate===null,[card.return(s=>({kind:s.locals.changed?'change':'keep',value:s.locals.value}))]),
      card.operation(s=>{s.locals.applied.push(s.locals.candidate.id);stateOf(s.state).sources.push(s.locals.candidate.source);}),
      card.invoke(s=>{
        const a=staticDefinitions.get(link.bindings.definitions[s.locals.candidate.definition]!);
        if(a?.kind!=='ability'||a.abilityKind!=='replacement')throw Error('Invalid replacement ability');
        const name=link.names.get(a.effect);if(!name)throw Error('Unlinked replacement effect');return name;
      },s=>context(s,s.locals.candidate),'replacement'),
      card.operation(s=>{if(stateOf(s.state).sources.pop()!==s.locals.candidate.source)throw Error('Invalid replacement source stack');}),
      card.branch(s=>qualified(s,s.locals.candidate,false),[
        card.operation(s=>{
          const result=s.locals.replacement;
          if(!result||!['keep','change','cancel'].includes(result.kind))throw Error('Invalid replacement result');
          if(result.kind==='cancel')s.locals.cancelled=dataCopy(result);
          else{
            const value=dataCopy(metadata.output.parse(dataCopy(result.value)));
            if(result.kind==='keep'){if(!sameRuleData(value,s.locals.value))throw Error('Keep result cannot change checkpoint value');}
            else{s.locals.value=value;s.locals.changed=true;}
          }
        }),
        card.branch(s=>Object.hasOwn(s.locals,'cancelled'),[card.return(s=>s.locals.cancelled)]),
      ]),
    ])];
  }});
  const node=handle<Command<ReplacementResult<O>>>();statements.set(node,{kind:'call',definition:effect,input});return node;
}
