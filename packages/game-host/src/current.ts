import type {Instance,InstanceStop,Outcome} from '@bear-forge/contracts/instance';
import type {InstanceSnapshot} from '@bear-forge/contracts/persistence';

/** Data owned by the binder while the provider consumes an already returned
 * reply. Static contract adapters and player bindings never enter this image. */
export type GameContinuation={
  /** Identity of the run's original request, retained through cold owners so
   * its pending policy proposal still matches the eventual acceptance. */
  instanceId:string;
  derived:{view:unknown;hasView:boolean;state:unknown;raw:InstanceStop<any,any>;requests:unknown[];events:unknown[];eventOutput:unknown};
  run:{accepted:unknown;pending:{callId:string;accepted:unknown}};
};
const continuations=new WeakMap<object,(consumedCallId:string)=>GameContinuation>();
export function registerGameContinuation(game:object,save:(consumedCallId:string)=>GameContinuation):void{continuations.set(game,save);}
/** Pair with a provider/Controller snapshot of exactly this consumed call.
 * This is not game.save and does not make an executing game publicly stable. */
export function saveGameContinuation(game:object,consumedCallId:string):GameContinuation{
  const save=continuations.get(game);if(!save)throw Error('Game has no accepted continuation');return save(consumedCallId);
}
export type DeliveryRow={event:number;player:string;acknowledged:boolean;
  delivery:{id:{instanceId:string;callId:string;index:number};event:unknown}|null};
export type DeliveryProgress={instanceId:string;callId:string;rows:DeliveryRow[]};
export type GameDeliverySnapshot={derived:GameContinuation['derived'];progress:DeliveryProgress};
const deliveries=new WeakMap<object,()=>GameDeliverySnapshot|null>();
export function registerGameDelivery(game:object,save:()=>GameDeliverySnapshot|null):void{deliveries.set(game,save);}
export function saveGameDelivery(game:object):GameDeliverySnapshot|null{return deliveries.get(game)?.()??null;}
export type GameExecutionControl={
  pending:()=>boolean;
  schedule:(check:(()=>string|null)|null)=>void;
  save:()=>Promise<{snapshot:InstanceSnapshot;game:GameContinuation}>;
  bind:(value:unknown)=>Promise<any>;
  bindControl:(handler:Function|null)=>Promise<any>;
  resume:(options?:{signal?:AbortSignal})=>Promise<any>;
  close:()=>Promise<void>;
};
const executions=new WeakMap<object,GameExecutionControl>();
export function registerGameExecution(game:object,control:GameExecutionControl):void{executions.set(game,control);}
export function gameExecutionControl(game:object):GameExecutionControl|undefined{return executions.get(game);}

// Private composition capability, absent from the public BaseGame protocol.
// The binder checks its ownership and stable-boundary guards before forking.
const forks=new WeakMap<object,()=>Promise<Outcome<Instance<any,any>>>>();
export function registerCurrentFork(game:object,fork:()=>Promise<Outcome<Instance<any,any>>>):void {forks.set(game,fork);}
export async function forkGameCurrent(game:object):Promise<Instance<any,any>> {
  const fork=forks.get(game);
  if(!fork)throw Error('Game has no current Context capability');
  const result=await fork();
  if(!result.ok)throw Error(result.error.code+': '+result.error.message);
  return result.value;
}

// These callbacks expose ownership-checked resource operations, not a new
// public Instance/BaseGame method. The game keeps ownership of its live input.
const accessors=new WeakMap<object,<T>(operation:(instance:Instance<any,any>)=>Promise<T>)=>Promise<T>>();
const sources=new WeakMap<object,object>();
export function registerCurrentAccess(game:object,access:<T>(operation:(instance:Instance<any,any>)=>Promise<T>)=>Promise<T>):void{accessors.set(game,access);}
export function registerCurrentSource(source:object,game:object):void{sources.set(source,game);}
export async function withCurrentSource<T>(source:object,operation:(instance:Instance<any,any>)=>Promise<T>):Promise<T>{
  const game=sources.get(source),access=game&&accessors.get(game);
  if(!access)throw Error('Current source has no live resource capability');
  return access(operation);
}
