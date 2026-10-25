import {getHeapStatistics} from 'node:v8';
import {CardMachine} from '@bear-forge/card-engine';
import type {CardRoot,CardStop,CardProgram} from '@bear-forge/card-engine';
import type {PortShape} from '@bear-forge/contracts/core';
import type {Instance} from '@bear-forge/contracts/instance';
import {type ProbabilityStop} from '../../card-engine/src/probability.ts';
import type {ProbabilityYield} from '../../card-engine/src/probability.ts';
import {CardGraph,privateCardGraph,packGraphImage,unpackGraphImage,type PackedGraphImage} from './graph.ts';
import {ruleContextIdentityEpoch} from '../../card-engine/src/card.ts';

export type ProbabilitySnapshot<S>={context:CardRoot<S>;immutable:object[];nullPrototypes:object[];contextValues:object[]};
export type PackedProbabilitySnapshot={packed:PackedGraphImage};
export type StoredProbabilitySnapshot<S>=ProbabilitySnapshot<S>|PackedProbabilitySnapshot;
/** Persist complete Context data in the same identity-preserving representation
 * used for parked currents. Immutable external anchors remain outside bytes so
 * a surrounding snapshot retains their shared identities across currents. */
export function packProbabilitySnapshot<S,Setup,P extends {[K in keyof P]:PortShape},R>(program:CardProgram<S,Setup,P,R>,saved:ProbabilitySnapshot<S>):PackedProbabilitySnapshot{
  return{packed:packGraphImage({root:saved.context,immutable:saved.immutable,nullPrototypes:saved.nullPrototypes,contextValues:saved.contextValues},ruleContextIdentityEpoch(program))};
}
export function unpackProbabilitySnapshot<S>(saved:StoredProbabilitySnapshot<S>):ProbabilitySnapshot<S>{
  if(!('packed' in saved))return saved;
  const image=unpackGraphImage<CardRoot<S>>(saved.packed);
  return{context:image.root,immutable:image.immutable,nullPrototypes:image.nullPrototypes,contextValues:image.contextValues};
}

/** Restore data and original control only. A packed import keeps its admitted
 * encoding; neither its pending operation nor a historical prefix executes. */
export function restoreProbabilityCurrent<S,Setup,P extends {[K in keyof P]:PortShape},R>(
  program:CardProgram<S,Setup,P,R>,saved:StoredProbabilitySnapshot<S>,
):ProbabilityCurrent<S,Setup,P,R>{
  checkProbabilityResources();
  const boundary=ruleContextIdentityEpoch(program);
  let graph:CardGraph<CardRoot<S>>;
  if('packed' in saved){
    graph=CardGraph.restorePacked<CardRoot<S>>(saved.packed,boundary);
  }else{
    graph=privateCardGraph(saved.context,saved.immutable,saved.nullPrototypes,saved.contextValues);
    try{graph.park(boundary);}catch(error){graph.close();throw error;}
  }
  return new ProbabilityCurrent(new CardMachine(program,graph));
}

const currentForks=new WeakMap<object,()=>ProbabilityCurrent<any,any,any,any>>();
/** Typed resource stop; callers must not classify unrelated execution errors
 * by matching their message and silently turn them into a policy fallback. */
export class ProbabilityBudgetStopped extends Error {
  readonly reason='heap-budget';
  constructor(){super('probability-heap-budget');}
}
/** Shared by original probability work and pure retained search algebra. */
export function checkProbabilityResources():void{
  if(getHeapStatistics().total_available_size<64*1024**2)throw new ProbabilityBudgetStopped();
}
/** Loader-only registration for its exact owned handles, never by instance ID. */
export function registerProbabilityCurrent(handle:object,fork:()=>ProbabilityCurrent<any,any,any,any>):void {currentForks.set(handle,fork);}
/** Consume a detached owned Instance, retaining its actual Context and Program.
 * Public transfer enforces ownership. Closing the wrapper releases its graph;
 * the probability current retains a COW branch, with no initialize/restore. */
export async function takeProbabilityCurrent<P extends {[K in keyof P]:PortShape},R>(instance:Instance<P,R>):Promise<ProbabilityCurrent<unknown,unknown,P,R>> {
  const ownership=await instance.transfer();
  if(!ownership.ok)throw Error(ownership.error.code+': '+ownership.error.message);
  const owned=ownership.value;
  let result:ProbabilityCurrent<unknown,unknown,P,R>|undefined;
  try{
    const fork=currentForks.get(owned);
    result=fork!();return result;
  }finally{
    const closed=await owned.close();
    if(!closed.ok){result?.close();throw Error(closed.error.code+': '+closed.error.message);}
  }
}

/** Owns an existing Context. It never initializes a Program and never executes
 * an action prefix. Chance stops are private to search, not new public IO. */
export class ProbabilityCurrent<S,Setup,P extends {[K in keyof P]:PortShape},R> {
  private closed=false;
  readonly machine: CardMachine<S,Setup,P,R>;
  constructor(machine: CardMachine<S,Setup,P,R>) {
    this.machine=machine;
  }
  private checkHeap() {
    // The host may set a V8 heap smaller than the search RSS ceiling. Leave
    // space for the next original operation and cleanup instead of reaching
    // V8's uncatchable allocation failure. This is a cooperative soft stop.
    checkProbabilityResources();
  }
  inspect(): CardStop<P,R> | ProbabilityStop {

    const {machine}=this;
    return machine.root.stop?.kind==='chance' ? machine.storage.export(machine.root.stop) as ProbabilityStop : machine.current();
  }
  /** Passive data projection only. Context-owned immutable objects in this
   * publication are decoded copies; never use their identities as replies or
   * execution references. Ordinary inspect() retains its original identity
   * semantics by activating the actual graph. */
  inspectPublication(): CardStop<P,R> | ProbabilityStop {
    const {machine}=this;
    const graph=machine.storage as CardGraph<CardRoot<S>>;
    if(graph.isParked&&!machine.program.definition.project){
      const stop=graph.exportRootField('stop');
      if(stop)return stop as CardStop<P,R>|ProbabilityStop;
    }
    return this.inspect();
  }
  inspectExact():CardStop<P,R>|ProbabilityStop|ProbabilityYield{

    // This is also the execution-adjacent read used by advanceUsing and the
    // probability scheduler. Keep its activated graph for the next operation;
    // using the passive publication path here would decode it twice.
    return this.machine.root.stop?.kind==='yield'?{kind:'yield'}:this.inspect();
  }
  fork(): ProbabilityCurrent<S,Setup,P,R> {
    this.checkHeap();
    const graph=this.machine.storage as CardGraph<CardRoot<S>>,parked=graph.isParked;
    try{return new ProbabilityCurrent(new CardMachine(this.machine.program,graph.fork(),this.machine.trace));}
    finally{if(parked)this.park();}
  }
  /** Sufficient equality for reusing a future probability law. Keep every
   * original state field and every Program/external immutable identity anchor.
   * This does not rename call counters or erase any hidden/RNG state. */
  sameCurrent(other:ProbabilityCurrent<S,Setup,P,R>):boolean{

    if(this.machine.program!==other.machine.program||this.machine.trace!==other.machine.trace)return false;
    const left=this.machine.storage as CardGraph<CardRoot<S>>,right=other.machine.storage as CardGraph<CardRoot<S>>;
    const leftParked=left.isParked,rightParked=right.isParked;
    try{return left.sameCurrent(right,()=>this.checkHeap(),undefined,ruleContextIdentityEpoch(this.machine.program));}
    finally{if(leftParked)this.park();if(rightParked)other.park();}
  }
  advance(reply?: unknown,committed?:()=>void): CardStop<P,R> | ProbabilityStop {
    return this.advanceUsing(reply,committed) as CardStop<P,R>|ProbabilityStop;
  }
  advanceExact(reply?:unknown,committed?:()=>void,instructions=4096):CardStop<P,R>|ProbabilityStop|ProbabilityYield{
    return this.advanceUsing(reply,committed,instructions);
  }
  private advanceUsing(reply:unknown,committed:(()=>void)|undefined,instructions?:number):CardStop<P,R>|ProbabilityStop|ProbabilityYield{
    this.checkHeap();
    const {machine}=this;
    const next=instructions===undefined?machine.advanceProbability(reply,committed):machine.advanceExactProbability(reply,committed,instructions);
    // Charge due tracing to the completed continuation. Fork itself must not
    // scan the retained world or move that scan to the child's first write.
    (machine.storage as CardGraph<CardRoot<S>>).finishCollection();
    return next;
  }
  close(): void {if(!this.closed){this.closed=true;this.machine.storage.close?.();}}
  snapshot():{context:CardRoot<S>;immutable:object[];nullPrototypes:object[];contextValues:object[]}{
    const graph=this.machine.storage as CardGraph<CardRoot<S>>,parked=graph.isParked;
    try{const saved=graph.snapshot(true,ruleContextIdentityEpoch(this.machine.program));
      return{context:saved.root,immutable:saved.immutable,nullPrototypes:saved.nullPrototypes,contextValues:saved.contextValues};
    }finally{if(parked)this.park();}
  }
  /** Reuse complete encoded Context data, without copying and re-encoding the
   * decoded object graph. No pending operation or history is executed. */
  packedSnapshot():PackedProbabilitySnapshot{
    const program=this.machine.program;
    return{packed:(this.machine.storage as CardGraph<CardRoot<S>>).packedSnapshot(ruleContextIdentityEpoch(program))};
  }
  /** Only the current representation changes; Program, control, hidden data,
   * publications and identity anchors remain owned by this same machine. */
  park():void{(this.machine.storage as CardGraph<CardRoot<S>>).park(ruleContextIdentityEpoch(this.machine.program));}
  candidateKey():string{return(this.machine.storage as CardGraph<CardRoot<S>>).candidateKey(ruleContextIdentityEpoch(this.machine.program));}
  /** Retained probability currents repeatedly fork at short IO/chance steps.
   * Their incremental collectors may otherwise restart before finishing. Only
   * retained boundary nodes are compacted; discarded transient branches close.
   */
  collect(): void {(this.machine.storage as CardGraph<CardRoot<S>>).collect();}
}
