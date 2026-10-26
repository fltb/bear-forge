import {withProbability as coreProbability,type AtomProbability} from '../../../../packages/card-engine/src/rules-probability.ts';
import {effectPolicy,type EffectKind} from './effect-policy.ts';
import {z} from 'zod';
import {rules as core} from '@bear-forge/card-engine';
import type {ruleModules} from '@bear-forge/card-engine';
import {typedValue} from './value.schemas.ts';
import {effectTrace,causeSchema,inCause,fromSource,OriginKind,type Cause} from './effect-trace.ts';

// Immutable declaration metadata, never per-instance execution state.
const tracedEvents=new WeakSet<object>();
// Emitting atoms have an origin envelope. Register sorting kernels on their
// actual commit atom, preserving the same envelope and event dispatch path.
const probabilityAdapters=new WeakMap<object,(kernel:AtomProbability<any,any>)=>void>();
export function withProbability<I,O>(effect:core.Effect<I,O>,kernel:AtomProbability<I,O>):core.Effect<I,O>{
  const adapt=probabilityAdapters.get(effect);
  if(adapt){adapt(kernel);return effect;}
  return coreProbability(effect,kernel);
}
type Installed<E>={value:E;cause:Cause};
const environment=<E>(value:core.Borrowed<Installed<E>>)=>value.value;
type Envelope<T>={value:T;cause:Cause};
const eventValue=<T>(event:core.RuleEvent<T>,value:unknown):T=>tracedEvents.has(event)?(value as Envelope<T>).value:value as T;
const dynamicValues=new WeakSet<object>();
function rememberValue<T extends object>(value:T):T{dynamicValues.add(value);return value;}
function authorBuilder<I,O>(b:core.Builder<I,O>):core.Builder<I,O>{
  rememberValue(b.input);return{...b,local<T>(){return rememberValue(b.local<T>());},read<T>(expression:(view:core.ReadView<I>)=>T){return rememberValue(b.read(expression));}};
}
function query<I,O>(definition:core.Query<I,O>,input:core.Input<I>):core.Value<O>{return rememberValue(core.query(definition,input));}
function snapshot<T>(input:core.Input<T>):core.Value<T>{return rememberValue(core.snapshot(input));}
function forEach<T>(items:core.Input<readonly T[]>,body:(item:core.Value<T>)=>core.Statement):core.Statement{return core.forEach(items,item=>body(rememberValue(item)));}
function readComponent<T>(entity:core.Input<number>,component:core.Component<T>):core.Value<core.Borrowed<T>>{return rememberValue(core.readComponent(entity,component));}
type EffectDeclaration<O>={effect:EffectKind;polarity?:-1|0|1}&(undefined extends O?{suppressed?:O}:{suppressed:O});
function defineEffect<I,O>(build:(b:core.Builder<I,O>)=>core.Statement):core.Effect<I,O>;
function defineEffect<I,O=void>(declaration:EffectDeclaration<O>,build:(b:core.Builder<I,O>)=>core.Statement):core.Effect<I,O>;
function defineEffect<I,O>(declaration:EffectDeclaration<O>|((b:core.Builder<I,O>)=>core.Statement),build?:((b:core.Builder<I,O>)=>core.Statement)):core.Effect<I,O>{
  if(typeof declaration==='function')return core.defineEffect<I,O>(b=>declaration(authorBuilder(b)));
  const body=core.defineEffect<I,O>(b=>build!(authorBuilder(b)));
  return core.defineEffect<I,O>(b=>{const result=b.local<O>();return core.sequence(
    core.when(b.read(v=>!v.query(effectPolicy.exports.permitted,{effect:declaration.effect,polarity:declaration.polarity??1})),b.return(b.read(()=>declaration.suppressed as O))),
    b.assign(result,core.call(body,b.input)),b.return(result),
  );});
}
type BoundReference<I,O>={reference:core.Effect<I,O>;source:number;owner:number|null};
function entityEffect<C,I,O,S=undefined>(kind:core.EntityKind<C,S>,entity:core.Input<number>,select:(config:core.Borrowed<C>)=>core.Effect<I,O>):core.Value<core.Effect<I,O>>{
  // Preserve the existing opaque Core reference unchanged inside L2 data.
  // No private Core field or source stack is inspected.
  const reference=core.entityEffect(kind,entity,select);
  return rememberValue(core.snapshot({reference,source:entity,owner:core.query(effectTrace.exports.owner,entity)})) as unknown as core.Value<core.Effect<I,O>>;
}
function call<I,O>(target:core.Effect<I,O>|core.Value<core.Effect<I,O>>,input:core.Input<I>):core.Command<O>{
  if(!dynamicValues.has(target))return core.call(target,input);
  const invoke=core.defineEffect<{target:BoundReference<I,O>;value:I},O>(b=>{const result=b.local<O>();return core.sequence(
    b.assign(result,core.call(b.read(v=>v.input.target.reference),b.read(v=>v.input.value))),b.return(result),
  );});
  const bound=fromSource(invoke,v=>({source:v.input.target.source,owner:v.input.target.owner,registration:null,kind:OriginKind.Entity}));
  return core.call(bound,{target:target as unknown as core.Input<BoundReference<I,O>>,value:input});
}
function restrict<I,O,E={}>(target:core.Checkpoint<I,O>,spec:{when:core.Query<any,boolean>;reason:unknown;order?:core.RuleOrder}):core.Ability<E>{
  return replace(target as unknown as core.Checkpoint<O,O>,{condition:spec.when,...(spec.order?{order:spec.order}:{}),effect:core.defineEffect<core.ReplacementContext<O,E>,core.ReplacementResult<O>>(b=>b.return({kind:'cancel',reason:spec.reason}))});
}
function wireSchema<T>(schema:core.Schema<T>):z.ZodType<T>{return schema instanceof z.ZodType?schema as z.ZodType<T>:z.unknown().transform(value=>schema.parse(value));}
function defineEvent<T>(spec:Parameters<typeof core.defineEvent<T>>[0]):core.RuleEvent<T>{
  const event=core.defineEvent<Envelope<T>>({...spec,payload:z.object({value:wireSchema(spec.payload),cause:causeSchema})});
  tracedEvents.add(event);return event as unknown as core.RuleEvent<T>;
}
function on<T,E={}>(event:core.RuleEvent<T>,spec:core.ReactionSpec<T,E>):core.Ability<E>{
  const unwrap=(c:core.Borrowed<core.ReactionContext<any,E>>):core.ReactionContext<T,E>=>({...c,event:eventValue(event,c.event),environment:environment(c.environment as unknown as core.Borrowed<Installed<E>>)}) as core.ReactionContext<T,E>;
  const adapt=(q:core.Query<core.ReactionContext<T,E>,boolean>)=>core.defineQuery({input:typedValue<core.ReactionContext<any,E>>(),output:z.boolean(),dependencies:[q],base:(r,c)=>r.query(q,unwrap(c) as core.Borrowed<core.ReactionContext<T,E>>)});
  const effect=inCause(core.defineEffect<core.ReactionContext<any,E>,void>(b=>core.call(spec.effect,b.read(v=>unwrap(v.input)))),
    v=>tracedEvents.has(event)?(v.input.event as Envelope<T>).cause:v.query(effectTrace.exports.current,undefined),
    v=>({source:v.input.source,owner:v.input.owner,registration:v.input.registration,kind:OriginKind.Ability,installation:(v.input.environment as unknown as Installed<E>).cause}));
  return core.on(event,{...spec,effect,...(spec.condition?{condition:adapt(spec.condition)}:{}),
    ...(typeof spec.eligible==='object'?{eligible:adapt(spec.eligible)}:{})});
}
function replacementContext<T,E>(c:core.Borrowed<core.ReplacementContext<T,Installed<E>>>):core.ReplacementContext<T,E>{return{...c,environment:environment(c.environment)} as core.ReplacementContext<T,E>;}
function replace<I,O,E={}>(checkpoint:core.Checkpoint<I,O>,spec:core.ReplacementSpec<O,E>):core.Ability<E>{
  const adapt=(q:core.Query<core.ReplacementContext<O,E>,boolean>)=>core.defineQuery({input:typedValue<core.ReplacementContext<O,Installed<E>>>(),output:z.boolean(),dependencies:[q],base:(r,c)=>r.query(q,replacementContext(c) as core.Borrowed<core.ReplacementContext<O,E>>)});
  const perform=core.defineEffect<core.ReplacementContext<O,Installed<E>>,core.ReplacementResult<O>>(b=>{const result=b.local<core.ReplacementResult<O>>();return core.sequence(b.assign(result,core.call(spec.effect,b.read(v=>replacementContext(v.input)))),b.return(result));});
  const {condition:originalCondition,eligible:originalEligible,...rest}=spec;
  return core.replace(checkpoint,{...rest,effect:fromSource(perform,v=>({source:v.input.source,owner:v.input.owner,registration:v.input.registration,kind:OriginKind.Replacement,installation:v.input.environment.cause})),
    ...(spec.condition?{condition:adapt(spec.condition)}:{}),...(typeof spec.eligible==='object'?{eligible:adapt(spec.eligible)}:spec.eligible===undefined?{}:{eligible:spec.eligible})}) as unknown as core.Ability<E>;
}
function install<E>(spec:core.InstallSpec<E>):core.Command<number>{
  return core.install({...spec,ability:spec.ability as unknown as core.Ability<Installed<E>>,environment:{value:spec.environment,cause:core.query(effectTrace.exports.current,undefined)}});
}
function modify<I,O,E={}>(target:core.Query<I,O>,spec:core.ModifierSpec<I,O,E>):core.Ability<E>{
  const unwrap=(c:core.Borrowed<core.ModifierContext<I,O,Installed<E>>>)=>({...c,environment:environment(c.environment)}) as core.ModifierContext<I,O,E>;
  const adapt=(q:core.Query<core.ModifierContext<I,O,E>,boolean>)=>core.defineQuery({input:typedValue<core.ModifierContext<I,O,Installed<E>>>(),output:z.boolean(),dependencies:[q],base:(r,c)=>r.query(q,unwrap(c) as core.Borrowed<core.ModifierContext<I,O,E>>)});
  const {condition:originalCondition,eligible:originalEligible,...rest}=spec;
  return core.modify(target,{...rest,transform:(r,c)=>spec.transform(r,unwrap(c) as core.Borrowed<core.ModifierContext<I,O,E>>),
    ...(spec.condition?{condition:adapt(spec.condition)}:{}),...(typeof spec.eligible==='object'?{eligible:adapt(spec.eligible)}:spec.eligible===undefined?{}:{eligible:spec.eligible})}) as unknown as core.Ability<E>;
}
function guardAbility<E>(ability:core.Ability<E>,guard:core.Query<{source:number;owner:number;environment:E},boolean>):core.Ability<E>{
  const adapted=core.defineQuery({input:typedValue<{source:number;owner:number;environment:Installed<E>}>(),output:z.boolean(),dependencies:[guard],base:(r,c)=>r.query(guard,{source:c.source,owner:c.owner,environment:environment(c.environment)})});
  return core.guardAbility(ability as unknown as core.Ability<Installed<E>>,adapted) as unknown as core.Ability<E>;
}
type TaskInput<I,O>=Envelope<I>&{target?:BoundReference<I,O>};
function taskContinuation<I,O>(effect:core.Effect<I,O>|core.Value<core.Effect<I,O>>){
  const dynamic=dynamicValues.has(effect);
  const invoke=core.defineEffect<TaskInput<I,O>,void>(b=>dynamic
    ?core.sequence(core.when(b.read(v=>!v.query(effectTrace.exports.present,v.input.target!.source)),b.return(undefined)),call(rememberValue(b.read(v=>v.input.target!)) as unknown as core.Value<core.Effect<I,O>>,b.read(v=>v.input.value)))
    :core.call(effect,b.read(v=>v.input.value)));
  return{effect:inCause(invoke,v=>v.input.cause),dynamic};
}
function enqueue<I,O>(effect:core.Effect<I,O>|core.Value<core.Effect<I,O>>,input:core.Input<I>,options:core.QueueOptions):core.Command<number>{
  const task=taskContinuation(effect),reference=effect as unknown as core.Input<BoundReference<I,O>>;
  return core.enqueue(task.effect,{value:input,cause:core.query(effectTrace.exports.current,undefined),...(task.dynamic?{target:reference}:{})},
    {...options,...(task.dynamic?{source:core.query(effectTrace.exports.taskSource,{reference,requested:options.source})}:options.source===undefined?{source:core.query(effectTrace.exports.currentSource,undefined)}:{})});
}
function schedule<I,O,T>(effect:core.Effect<I,O>|core.Value<core.Effect<I,O>>,input:core.Input<I>,options:core.ScheduleOptions<T,I>):core.Command<number>{
  const task=taskContinuation(effect),condition=options.at.condition,reference=effect as unknown as core.Input<BoundReference<I,O>>;
  const adapted=condition?core.defineQuery({input:typedValue<{event:any;input:TaskInput<I,O>;source:number|null}>(),output:z.boolean(),dependencies:[condition],base:(r,c)=>r.query(condition,{event:eventValue(options.at.event,c.event) as core.Borrowed<T>,input:c.input.value,source:c.source})}):undefined;
  return core.schedule(task.effect,{value:input,cause:core.query(effectTrace.exports.current,undefined),...(task.dynamic?{target:reference}:{})},
    {...options,...(task.dynamic?{source:core.query(effectTrace.exports.taskSource,{reference,requested:options.source})}:options.source===undefined?{source:core.query(effectTrace.exports.currentSource,undefined)}:{}),at:{event:options.at.event,...(adapted?{condition:adapted}:{})}});
}
function emit<T>(event:core.RuleEvent<T>,payload:core.Input<T>):core.Command<void>{
  const publish=core.defineEffect<T,void>(b=>core.emit(event as core.RuleEvent<any>,tracedEvents.has(event)?{value:b.input,cause:core.query(effectTrace.exports.current,undefined)}:b.input));
  return core.call(publish,payload);
}
function defineRules<E>(spec:Parameters<typeof core.defineRules<E>>[0]):core.RuleModule<E>{
  return core.defineRules({requires:[effectTrace,effectPolicy,...spec.requires.filter(m=>m!==effectTrace&&m!==effectPolicy)],build(m){
    type Ref=core.Component<any>|ruleModules.Owned<core.Component<any>>;
    function atom<I,O,const R extends readonly Ref[],const W extends readonly ruleModules.Owned<core.Component<any>>[],const E extends readonly ruleModules.Owned<core.RuleEvent<any>>[]>(config:ruleModules.AtomSpec<I,O,R,W,E>):core.Effect<I,O>{
      if(config.emits.length===0)return m.atom(config);
      const events=(rows:readonly ruleModules.EventProposal<any>[],cause:core.Borrowed<Cause>)=>rows.map(e=>({event:e.event,payload:tracedEvents.has(e.event.public)?{value:e.payload,cause}:e.payload}));
      const commit=m.atom({input:z.object({value:wireSchema(config.input),cause:causeSchema}),output:config.output,reads:config.reads,writes:config.writes,emits:config.emits as readonly ruleModules.Owned<core.RuleEvent<any>>[],run(read,input){
        const result=config.run(read,input.value);return{...result,events:events(result.events,input.cause)};
      }});
      const wrapped=core.defineEffect<I,O>(b=>{const result=b.local<O>();return core.sequence(b.assign(result,core.call(commit,{value:b.input,cause:core.query(effectTrace.exports.current,undefined)})),b.return(result));});
      probabilityAdapters.set(wrapped,kernel=>coreProbability(commit,{
        space:i=>kernel.space(i.value),
        ...(kernel.boundaryValue?{boundaryValue:(i:core.Borrowed<Envelope<I>>)=>kernel.boundaryValue!(i.value)}:{}),
        ...(kernel.publication?{publication:(r:ruleModules.AtomRead<any>,i:core.Borrowed<Envelope<I>>,value:core.Borrowed<O>)=>kernel.publication!(r,i.value,value)}:{}),
        ...(kernel.constraints?{constraints:(r:ruleModules.AtomRead<any>,i:core.Borrowed<Envelope<I>>,value:core.Borrowed<O>)=>kernel.constraints!(r,i.value,value)}:{}),
        run(r,i,coordinate){const result=kernel.run(r,i.value,coordinate);return{...result,events:events(result.events,i.cause)};},
      }));
      return wrapped;
    }
    const builder:ruleModules.ModuleBuilder={...m,
      kind<C,S=undefined>(config:core.EntityKindSpec<C,S>):core.EntityKind<C,S>{
        const initialize=core.defineEffect<core.EntityLifecycle<S>,void>(b=>core.sequence(
          core.call(effectTrace.exports.bind,{source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.owner)}),
          ...(config.initialize?[core.call(config.initialize,b.input)]:[]),
        ));
        const dispose=core.defineEffect<Omit<core.EntityLifecycle<S>,'setup'>&{reason:unknown},void>(b=>core.sequence(
          core.call(effectTrace.exports.depart,b.read(v=>v.input.entity)),...(config.dispose?[core.call(config.dispose,b.input)]:[]),
        ));
        return m.kind({...config,initialize:fromSource(initialize,v=>({source:v.input.entity,owner:v.input.owner,registration:null,kind:OriginKind.Entity})),
          dispose:fromSource(dispose,v=>({source:v.input.entity,owner:v.input.owner,registration:null,kind:OriginKind.Entity})),
        });
      },
      atom,
    };
    return spec.build(builder);
  }});
}
/** L2 author surface. Execution still uses the existing Core effects, event
 * dispatcher and task queue; no scheduler or interpreter is duplicated here. */
export const rules={...core,call,query,snapshot,forEach,readComponent,entityEffect,restrict,defineEffect,defineRules,defineEvent,on,replace,install,modify,guardAbility,enqueue,schedule,emit};
export namespace rules {
  export type Statement=core.Statement;
  export type Ability<E={}>=core.Ability<E>;
  export type Borrowed<T>=core.Borrowed<T>;
  export type Builder<I,O>=core.Builder<I,O>;
  export type Checkpoint<I,O=I>=core.Checkpoint<I,O>;
  export type ChoiceAdapter<T,P,W,R>=core.ChoiceAdapter<T,P,W,R>;
  export type ChoiceRequest<T=unknown,P=unknown>=core.ChoiceRequest<T,P>;
  export type ChoiceResult<T>=core.ChoiceResult<T>;
  export type Command<O>=core.Command<O>;
  export type Component<T>=core.Component<T>;
  export type Effect<I,O>=core.Effect<I,O>;
  export type EntityDefinition<C,S=undefined>=core.EntityDefinition<C,S>;
  export type EntityKind<C,S=undefined>=core.EntityKind<C,S>;
  export type EntityLifecycle<S=undefined>=core.EntityLifecycle<S>;
  export type Input<T>=core.Input<T>;
  export type ModifierContext<I,O,E={}>=core.ModifierContext<I,O,E>;
  export type Query<I,O>=core.Query<I,O>;
  export type QueryRead=core.QueryRead;
  export type ReactionContext<T,E={}>=core.ReactionContext<T,E>;
  export type ReadView<I>=core.ReadView<I>;
  export type ReplacementContext<T,E={}>=core.ReplacementContext<T,E>;
  export type ReplacementResult<T>=core.ReplacementResult<T>;
  export type RuleEvent<T>=core.RuleEvent<T>;
  export type RuleModule<E=unknown>=core.RuleModule<E>;
  export type RulePhase=core.RulePhase;
  export type RuleQueue=core.RuleQueue;
  export type Schema<T>=core.Schema<T>;
  export type ScopeKind=core.ScopeKind;
  export type ScopeLifecycle=core.ScopeLifecycle;
  export type Value<T>=core.Value<T>;
}
