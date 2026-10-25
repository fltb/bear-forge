import type {Instance,InstanceRunStop} from '@bear-forge/contracts/instance';
import type {InstanceSnapshot} from '@bear-forge/contracts/persistence';

/** Private composition signal. It is emitted only after the original provider
 * committed an instruction boundary; it is neither a public stop nor a fault. */
const executionSuspensions=new WeakSet<object>();
export class ExecutionSuspended extends Error{
  readonly reason:string;
  constructor(reason:string){super('Original execution suspended: '+reason);this.reason=reason;executionSuspensions.add(this);}
  static [Symbol.hasInstance](value:unknown):boolean{return executionSuspensions.has(value as object);}
}
export type ContinuationControl={
  pending:()=>boolean;
  callId:()=>string;
  matchesStop:(state:unknown)=>boolean;
  schedule:(check:(()=>string|null)|null)=>void;
  save:()=>Promise<InstanceSnapshot>;
  resume:()=>Promise<InstanceRunStop<any,any>>;
  transfer:()=>Instance<any,any>;
  close:()=>Promise<void>;
};
// Capabilities belong to exact owned handles, never shape-compatible wrappers.
// Providers enforce owner tokens on every call, including after transfer.
const instances=new WeakMap<object,ContinuationControl>();
const loaders=new WeakMap<object,(snapshot:InstanceSnapshot)=>Promise<Instance<any,any>>>();
// These are trusted synchronous policy delivery handlers: their Promise only
// carries the already performed local receipt. Cancellation cannot discard
// that receipt and subsequently cause the same callback to be invoked again.
const eventReceipts=new WeakSet<Function>();
export function registerEventReceipt(handler:Function):void{eventReceipts.add(handler);}
export function retainsEventReceipt(handler:Function):boolean{return eventReceipts.has(handler);}
export function registerContinuation(instance:object,control:ContinuationControl):void{instances.set(instance,control);}
export function continuationControl(instance:object):ContinuationControl|undefined{return instances.get(instance);}
export function registerContinuationLoader(loaded:object,restore:(snapshot:InstanceSnapshot)=>Promise<Instance<any,any>>):void{loaders.set(loaded,restore);}
export async function restoreContinuation(loaded:object,snapshot:InstanceSnapshot):Promise<Instance<any,any>>{
  const restore=loaders.get(loaded);if(!restore)throw Error('Provider has no original continuation capability');return restore(snapshot);
}
