import {card} from './card.ts';
import {dataCopy} from './rules-data.ts';
import {definitions,expressions,handle,statements,expression,freezeAuthorInput} from './rules-internal.ts';
import {staticDefinitions,declareStatic,stateOf} from './rules-module-internal.ts';
import {evaluateQuery} from './rules-queries.ts';
import type {ComponentOverlay,ModuleBindings} from './rules-module-internal.ts';
import type {Command,Effect,Input,Value} from './rules.types.ts';
import type {QueueOptions,RuleQueue,RuleTask,ScheduleOptions,RuntimeEffectReference} from './rules-tasks.types.ts';
import type {LoweringContext} from './rules-internal.ts';
import type {Query} from './rules-query.types.ts';
export type {QueueOptions,RuleQueue,ScheduleOptions,SchedulePoint} from './rules-tasks.types.ts';
function command<I,O>(effect:Effect<I,O>,input:Input<I>):Command<O>{const node=handle<Command<O>>();statements.set(node,{kind:'call',definition:effect,input});return node;}
function queueReference(queue:RuleQueue):void{
  if(!queue||typeof queue!=='object')throw Error('Queue requires a definition reference');
  if(!staticDefinitions.has(queue))declareStatic(queue,{kind:'queue'});
  else if(staticDefinitions.get(queue)?.kind!=='queue')throw Error('Invalid queue definition');
}
function validSource(state:ReturnType<typeof stateOf>,source:number|null):boolean{return source===null||Number.isSafeInteger(source)&&source>=0&&Object.hasOwn(state.entities,source)&&state.entities[source]!.phase!=='removing';}
function checkReference(ref:RuntimeEffectReference,state:ReturnType<typeof stateOf>,link:LoweringContext):string{
  const name=link.resolveReference(ref,state.entities,true);
  if(ref.selector!==null&&(!Number.isSafeInteger(ref.selector)||ref.selector<0||!validSource(state,ref.source)))throw Error('Departed dynamic task effect source');
  return name;
}
function buildTask<I,O,T>(target:Effect<I,O>|Value<Effect<I,O>>,input:Input<I>,options:QueueOptions,at:ScheduleOptions<T,I>['at']|null):Command<number>{
  queueReference(options.queue);
  const dynamic=!definitions.has(target),effect=handle<Effect<any,number>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const queue=link.register(options.queue);
    const name=dynamic?null:link.ensure(target as Effect<I,O>);
    const event=at?link.bindings.indices.get(at.event):null,condition=at?.condition?link.bindings.indices.get(at.condition):null;
    if(at&&(event===undefined||staticDefinitions.get(at.event)?.kind!=='event'||at.condition&&condition===undefined))throw Error('Unlinked task schedule point');
    return[card.operation(s=>{
      const state=stateOf(s.state),args=s.input,scope=state.scopes[args.lifetime];
      if(!Number.isSafeInteger(args.lifetime)||!scope||scope.phase==='ending'||scope.phase==='closed')throw Error('Invalid task lifetime');
      const source=args.source===undefined?(dynamic?args.reference?.source:(state.sources.at(-1)??null)):args.source;
      if(!validSource(state,source))throw Error('Invalid task source');
      const reference:RuntimeEffectReference=dynamic?dataCopy(args.reference):{program:link.identity(),effect:Number(name!.slice(1)),source,selector:null};
      checkReference(reference,state,link);
      if(dynamic&&source!==reference.source)throw Error('Dynamic task source must match its entity entry');
      const id=state.nextTask;if(!Number.isSafeInteger(id)||id>=Number.MAX_SAFE_INTEGER)throw Error('Task identity exhausted');
      const task:RuleTask={id,effect:reference,input:dataCopy(args.input),queue,source,lifetime:args.lifetime,eligible:options.eligible??'source-present',state:at?'scheduled':'pending',at:event??null,condition:condition??null,position:options.position??'back'};
      state.tasks[id]=task;state.nextTask++;
      if(!at){if(!state.queues[queue])state.queues[queue]=[];const ids=state.queues[queue]!;if(task.position==='front')ids.unshift(id);else ids.push(id);}
      return id;
    },'task'),card.return(s=>s.locals.task)];
  }});
  return command(effect,{reference:dynamic?target:undefined,input,source:options.source,lifetime:options.lifetime} as any);
}
export function enqueue<I,O>(effect:Effect<I,O>|Value<Effect<I,O>>,input:Input<I>,options:QueueOptions):Command<number>{return buildTask(effect,input,options,null);}
export function schedule<I,O,T>(effect:Effect<I,O>|Value<Effect<I,O>>,input:Input<I>,options:ScheduleOptions<T,I>):Command<number>{return buildTask(effect,input,options,options.at);}
export function snapshot<T>(value:Input<T>):Value<T>{
  const saved=freezeAuthorInput(value);return expression<T>(null,c=>dataCopy(c.evaluate(saved)),{inputs:[saved]});
}
/** Physical pending entries, excluding scheduled and currently running tasks. Read-only scheduler view. */
export function queueSize(queue:RuleQueue):Value<number>{
  queueReference(queue);return expression<number>(null,c=>{
    const index=c.bindings.indices.get(queue);if(index===undefined)throw Error('Unlinked queue definition');
    return stateOf(c.world).queues[index]?.length??0;
  },{references:[queue]});
}
export function cancelScheduled(task:Input<number>):Command<boolean>{
  const effect=handle<Effect<number,boolean>>();definitions.set(effect,{kind:'compiled',lower(){return[card.operation(s=>{
    const state=stateOf(s.state),task=state.tasks[s.input];if(!Number.isSafeInteger(s.input)||s.input<1)throw Error('Invalid task identity');
    if(!task||task.state==='running')return false;cancelTask(state,s.input);return true;
  },'cancelled'),card.return(s=>s.locals.cancelled)];}});return command(effect,task);
}
function drainOneEffect(queue:RuleQueue):Effect<void,boolean>{
  queueReference(queue);const effect=handle<Effect<void,boolean>>();
  definitions.set(effect,{kind:'compiled',lower(link){
    const index=link.register(queue);
    return[card.operation(s=>{
      const state=stateOf(s.state),ids=state.queues[index];
      if(!ids?.length)return null;
      const id=ids.shift()!,task=state.tasks[id];if(!task)return undefined;
      if(task.state!=='pending')throw Error('Invalid queued task phase');
      const lifetime=state.scopes[task.lifetime];
      if(!lifetime||lifetime.phase==='closed'||task.eligible==='source-present'&&!validSource(state,task.source)||task.effect.selector!==null&&!validSource(state,task.effect.source)){delete state.tasks[id];return undefined;}
      checkReference(task.effect,state,link);task.state='running';return id;
    },'task'),card.branch(s=>s.locals.task===null,[card.return(()=>false)]),
    card.branch(s=>typeof s.locals.task==='number',[card.operation(s=>{const task=stateOf(s.state).tasks[s.locals.task]!;if(task.source!==null)stateOf(s.state).sources.push(task.source);}),
    card.invoke(s=>checkReference(stateOf(s.state).tasks[s.locals.task]!.effect,stateOf(s.state),link),s=>stateOf(s.state).tasks[s.locals.task]!.input),
    card.operation(s=>{const state=stateOf(s.state),task=state.tasks[s.locals.task]!;if(task.source!==null&&state.sources.pop()!==task.source)throw Error('Invalid task source stack');delete state.tasks[s.locals.task];})]),
    card.return(()=>true)];
  }});return effect;
}
/** The rule scheduler rechecks its own domain between calls; the running task remains in Context. */
export function drainOne(queue:RuleQueue):Command<boolean>{return command(drainOneEffect(queue),undefined);}
/** Queue draining uses exactly the same take/invoke/finish path as single-step scheduling. */
export function drainQueue(queue:RuleQueue):Command<void>{
  const one=drainOneEffect(queue),effect=handle<Effect<void,void>>();
  definitions.set(effect,{kind:'compiled',lower(link){return[card.repeat(()=>true,[card.invoke(link.ensure(one),undefined,'more'),card.branch(s=>s.locals.more===false,[card.return()])])];}});
  return command(effect,undefined);
}
export function captureScheduled(event:number,payload:unknown,world:unknown,bindings:ModuleBindings,overlay?:ComponentOverlay):number[]{
  const state=stateOf(world);return Object.values(state.tasks).filter(task=>{
    if(task.state!=='scheduled'||task.at!==event)return false;
    const scope=state.scopes[task.lifetime];if(!scope||scope.phase==='closed')return false;
    if(task.eligible==='source-present'&&!validSource(state,task.source))return false;
    if(task.condition===null)return true;
    const definition=bindings.definitions[task.condition];if(!definition||staticDefinitions.get(definition)?.kind!=='query')throw Error('Invalid task condition');
    return evaluateQuery(definition as Query<any,boolean>,{event:payload,input:task.input,source:task.source},world,bindings,new Set(),overlay);
  }).map(task=>task.id);
}
export function activateScheduled(world:unknown,ids:readonly number[]):void{
  const state=stateOf(world);for(const id of ids){const task=state.tasks[id];if(!task||task.state!=='scheduled')continue;
    task.state='pending';if(!state.queues[task.queue])state.queues[task.queue]=[];const queue=state.queues[task.queue]!;if(task.position==='front')queue.unshift(id);else queue.push(id);
  }
}

export function cancelTask(state:ReturnType<typeof stateOf>,id:number):void{
  const task=state.tasks[id];if(!task||task.state==='running')return;
  const queue=state.queues[task.queue];if(queue){const position=queue.indexOf(id);if(position>=0)queue.splice(position,1);}
  delete state.tasks[id];
}
