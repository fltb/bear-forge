import {immutableRuleEpoch} from '../../card-engine/src/rules-values.ts';
import {isProbabilityConstraint,satisfiesProbabilityConstraints} from '../../card-engine/src/probability-image.ts';
import {getHeapStatistics} from 'node:v8';
import {isDeepStrictEqual} from 'node:util';
import {CardMachine,CardProgram,ruleReplyGuardFor} from '@bear-forge/card-engine';
import type {CardRoot,CardStop} from '@bear-forge/card-engine';
import type {PortShape} from '@bear-forge/contracts/core';
import type {Instance} from '@bear-forge/contracts/instance';
import {generateProbability,receiveForwardProbability,type ProbabilityEntropy,type ProbabilityStop} from '../../card-engine/src/probability.ts';
import {CardGraph,privateCardGraph} from './graph.ts';

const currentForks=new WeakMap<object,()=>ProbabilityCurrent<any,any,any,any>>();
/** Typed resource stop; callers must not classify unrelated execution errors
 * by matching their message and silently turn them into a policy fallback. */
export class ProbabilityBudgetStopped extends Error {
  readonly reason='heap-budget';
  constructor(){super('probability-heap-budget');}
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
    if(!fork)throw Error('Instance has no probability Context capability');
    result=fork();return result;
  }finally{
    const closed=await owned.close();
    if(!closed.ok){result?.close();throw Error(closed.error.code+': '+closed.error.message);}
  }
}

export type ProbabilityRootControl={check():void;execute:<T>(phase:'fork'|'advance'|'cleanup',operation:()=>T)=>T};
export type ProbabilityRoot<S,Setup,P extends {[K in keyof P]:PortShape},R,D>={
  current:ProbabilityCurrent<S,Setup,P,R>;
  posterior:ProbabilityFrontier<S,Setup,P,R,D>|null;
  observation:D|null;
  close():void;
};
const rootForks=new WeakMap<object,(control:ProbabilityRootControl)=>ProbabilityRoot<any,any,any,any,any>>();
export function registerProbabilityRoot(handle:object,fork:(control:ProbabilityRootControl)=>ProbabilityRoot<any,any,any,any,any>):void{rootForks.set(handle,fork);}
/** Transfer the actual current and its already-maintained joint posterior
 * together. A failed tracked posterior must never become an actual singleton. */
export async function takeProbabilityRoot<P extends {[K in keyof P]:PortShape},R,D>(instance:Instance<P,R>,control:ProbabilityRootControl={check(){},execute:(_phase,run)=>run()}):Promise<ProbabilityRoot<unknown,unknown,P,R,D>>{
  const ownership=await instance.transfer();if(!ownership.ok)throw Error(ownership.error.code+': '+ownership.error.message);
  const owned=ownership.value;let result:ProbabilityRoot<unknown,unknown,P,R,D>|undefined;
  try{
    control.check();const fork=rootForks.get(owned);if(!fork)throw Error('Instance has no probability root capability');
    result=fork(control);return result;
  }finally{
    const closed=await owned.close();if(!closed.ok){result?.close();throw Error(closed.error.code+': '+closed.error.message);}
  }
}

/** Owns an existing Context. It never initializes a Program and never executes
 * an action prefix. Chance stops are private to search, not new public IO. */
export class ProbabilityCurrent<S,Setup,P extends {[K in keyof P]:PortShape},R> {
  private closed=false;
  readonly machine: CardMachine<S,Setup,P,R>;
  constructor(machine: CardMachine<S,Setup,P,R>) {
    if (!(machine.storage instanceof CardGraph)) throw Error('Probability execution requires a forkable Context');
    this.machine=machine;
  }
  private open() {if(this.closed)throw Error('Probability Context is closed');}
  private checkHeap() {
    // The host may set a V8 heap smaller than the search RSS ceiling. Leave
    // space for the next original operation and cleanup instead of reaching
    // V8's uncatchable allocation failure. This is a cooperative soft stop.
    const heap=getHeapStatistics();
    if(heap.total_available_size<64*1024**2)throw new ProbabilityBudgetStopped();
  }
  inspect(): CardStop<P,R> | ProbabilityStop {
    this.open();
    const {machine}=this;
    return machine.root.stop?.kind==='chance' ? machine.storage.export(machine.root.stop) as ProbabilityStop : machine.current();
  }
  fork(): ProbabilityCurrent<S,Setup,P,R> {
    this.open();this.checkHeap();
    const graph=this.machine.storage as CardGraph<CardRoot<S>>;
    return new ProbabilityCurrent(new CardMachine(this.machine.program,graph.fork(),this.machine.trace));
  }
  advance(reply?: unknown): CardStop<P,R> | ProbabilityStop {
    this.open();this.checkHeap();
    const {machine}=this, before=this.inspect();
    let next:CardStop<P,R>|ProbabilityStop;
    if(before.kind==='call') {
      const port=before.call.port;
      const parsed=machine.program.definition.schemas.ports[port].output.parse(reply);
      const guard=ruleReplyGuardFor(machine.program.definition),wait=machine.root.waiting;
      if(guard&&wait) {const frame=machine.root.frames[wait.frame]!;guard(machine.program.names[frame.block]!,frame,port,parsed);}
      next=machine.advanceProbability(parsed);
    }else next=machine.advanceProbability(reply);
    // Charge due tracing to the completed continuation. Fork itself must not
    // scan the retained world or move that scan to the child's first write.
    (machine.storage as CardGraph<CardRoot<S>>).finishCollection();
    return next;
  }
  close(): void {if(!this.closed){this.closed=true;this.machine.storage.close?.();}}
  /** Retained probability currents repeatedly fork at short IO/chance steps.
   * Their incremental collectors may otherwise restart before finishing. Only
   * retained boundary nodes are compacted; discarded transient branches close.
   */
  collect(): void {this.open();(this.machine.storage as CardGraph<CardRoot<S>>).collect();}
}

export type ProbabilityFrontier<S,Setup,P extends {[K in keyof P]:PortShape},R,D>={
  representation:'exact'|'particles';
  outcomes:{current:ProbabilityCurrent<S,Setup,P,R>;probability:number;data:D}[];
};
type ContinuationOptions={maximum:number;entropy:ProbabilityEntropy;untilBoundary?:string;execute?:<T>(phase:'fork'|'advance'|'cleanup',operation:()=>T)=>T};
function validateMass(frontier:{representation:'exact'|'particles';outcomes:readonly {probability:number}[]},maximum=8):void {
  if(!Number.isSafeInteger(maximum)||maximum<1||maximum>8||!['exact','particles'].includes(frontier.representation)||!frontier.outcomes.length||frontier.outcomes.length>maximum||frontier.outcomes.some(o=>!Number.isFinite(o.probability)||o.probability<=0)||Math.abs(frontier.outcomes.reduce((sum,o)=>sum+o.probability,0)-1)>1e-12)throw Error('Invalid probability frontier');
}

/** Observation data is detached from Context. Compare values AND aliases,
 * including Map iteration order; unfamiliar host objects never coalesce. */
function sameObservationData(a:unknown,b:unknown,check:()=>void):boolean{
  let count=0;
  const left=new Map<object,object>(),right=new Map<object,object>(),pending:[unknown,unknown][]=[[a,b]];
  while(pending.length){
    if((count++&255)===0)check();const [x,y]=pending.pop()!;
    if(x===null||y===null||typeof x!=='object'||typeof y!=='object'){if(!Object.is(x,y))return false;continue;}
    if(left.has(x)||right.has(y)){if(left.get(x)!==y||right.get(y)!==x)return false;continue;}
    left.set(x,y);right.set(y,x);const prototype=Object.getPrototypeOf(x);if(prototype!==Object.getPrototypeOf(y))return false;
    if(prototype===Map.prototype){const m=x as Map<unknown,unknown>,n=y as Map<unknown,unknown>;if(m.size!==n.size)return false;const rows=[...n];let i=0;for(const [key,value]of m){pending.push([key,rows[i]![0]],[value,rows[i]![1]]);i++;}continue;}
    if(prototype!==null&&prototype!==Object.prototype&&prototype!==Array.prototype)return false;
    const keys=Reflect.ownKeys(x),other=Reflect.ownKeys(y);if(keys.length!==other.length)return false;
    for(let i=0;i<keys.length;i++){const key=keys[i]!;if(key!==other[i])return false;const p=Object.getOwnPropertyDescriptor(x,key)!,q=Object.getOwnPropertyDescriptor(y,key)!;if(!('value'in p)||!('value'in q)||p.enumerable!==q.enumerable||p.configurable!==q.configurable||p.writable!==q.writable)return false;pending.push([p.value,q.value]);}
  }
  return true;
}
function unitCoordinate(space:ProbabilityStop['space']):bigint|null{
  if(space.kind==='boundary'||space.kind==='uniform'&&space.size===1n)return 0n;
  if(space.kind==='weighted'&&space.weights.filter(weight=>weight>0).length===1)return BigInt(space.weights.findIndex(weight=>weight>0));
  return null;
}

/** Move a complete weighted frontier forward through the original interpreter.
 * Each child retains its own frames, locals, conditions and component aliases.
 * The optional IO handler uses the original port contract; it cannot install
 * earlier frames. Parents are borrowed and every returned child is owned. */
function advanceProbabilityFrontier<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(
  source:ProbabilityFrontier<S,Setup,P,R,D>,
  reply:(current:ProbabilityCurrent<S,Setup,P,R>,data:D)=>unknown,
  options:ContinuationOptions&{continueCall?:(stop:Extract<CardStop<P,R>,{kind:'call'}>,data:D)=>{reply:unknown;data:D}|undefined;condition?:{publications?:readonly unknown[];hint?:unknown;attempts:number;likelihood:(current:ProbabilityCurrent<S,Setup,P,R>,data:D,publications:readonly unknown[])=>number}},
):{frontier:ProbabilityFrontier<S,Setup,P,R,D>|null;evidence:number}{
  validateMass(source,options.maximum);
  const capacity=options.condition?.attempts??options.maximum;
  if(!Number.isSafeInteger(capacity)||capacity<options.maximum||capacity>64)throw Error('Invalid probability observation attempt budget');
  let attempts=0;
  if(options.condition&&options.untilBoundary!==undefined)throw Error('Observation conditioning requires public IO or terminal outcomes');
  if(options.untilBoundary!==undefined&&!options.untilBoundary.length)throw Error('Invalid probability boundary');
  const program=source.outcomes[0]!.current.machine.program;
  if(source.outcomes.some(o=>o.current.machine.program!==program))throw Error('Probability frontier requires one shared Program');
  type Node=ProbabilityFrontier<S,Setup,P,R,D>['outcomes'][number];
  const owned=new Set<ProbabilityCurrent<S,Setup,P,R>>(),pending:Node[]=[],outcomes:Node[]=[];
  const execute=options.execute??(<T>(_phase:string,operation:()=>T)=>operation());
  let representation=source.representation,guidedFinitePartition=false;
  const publications=new Map<ProbabilityCurrent<S,Setup,P,R>,unknown[]>();
  const impossible=new WeakSet<ProbabilityCurrent<S,Setup,P,R>>();
  const advance=(current:ProbabilityCurrent<S,Setup,P,R>,reply:unknown)=>{
    for(;;){
      execute('advance',()=>current.advance(reply));
      for(const value of current.machine.takeProbabilityPublications()){
        if(value!==null&&typeof value==='object'&&'kind' in value&&value.kind==='probability-constraint'){
          if(!isProbabilityConstraint(value))throw Error('Invalid probability constraint');
          if(options.condition?.publications&&!satisfiesProbabilityConstraints([value],options.condition.publications))impossible.add(current);
        }else publications.get(current)!.push(value);
      }
      const expected=options.condition?.publications,seen=publications.get(current)!;
      if(impossible.has(current)||expected&&(seen.length>expected.length||seen.some((value,index)=>!isDeepStrictEqual(value,expected[index]))))return;
      const stop=current.inspect();if(stop.kind!=='chance'||stop.space.kind==='boundary'&&stop.space.name===options.untilBoundary)return;
      const sole=unitCoordinate(stop.space);if(sole===null)return;
      // Consume only the unique outgoing edge, through the original machine.
      // This also lets siblings meet at the same subsequent current boundary.
      options.entropy.check();reply=sole;
    }
  };
  const fork=(node:Node):Node=>execute('fork',()=>{
    const current=node.current.fork();owned.add(current);publications.set(current,structuredClone(publications.get(node.current)??[]));
    return{current,probability:node.probability,data:structuredClone(node.data)};
  });
  try{
    options.entropy.check();
    for(const node of source.outcomes){
      options.entropy.check();
      const first=fork(node);
      advance(first.current,reply(node.current,first.data));
      pending.push(first);
    }
    while(pending.length){
      options.entropy.check();
      // Reduce only after a sampler actually partitioned a finite public
      // target. A declaration alone (for example a fixed roster identity)
      // does not guide any pending hidden variables; keep the observation
      // attempt capacity until their original outcomes can be checked.
      // Include pending AND completed nodes with their unnormalized mass.
      if(guidedFinitePartition&&pending.length+outcomes.length>options.maximum){
        const population=[...pending,...outcomes],pendingCount=pending.length;
        // A current that has already matched more public evidence can carry
        // a much smaller unnormalized mass. Do not make it compete with an
        // unfinished prefix: stratify by matched declarations and completion.
        const groups=new Map<string,{indices:number[];mass:number;quota:number}>();
        for(let index=0;index<population.length;index++){
          const row=population[index]!,key=index<pendingCount?'pending:'+publications.get(row.current)!.length:'completed';
          let group=groups.get(key);if(!group){group={indices:[],mass:0,quota:1};groups.set(key,group);}group.indices.push(index);group.mass+=row.probability;
        }
        // More progress strata than accepted slots cannot be honestly reduced
        // to that limit. Keep their original currents within attempt capacity.
        if(groups.size<=options.maximum){
          const strata=[...groups.values()];
          // Long, already-observed batches still need their remaining original
          // operations executed for every particle. Share the sample allowance
          // across those unresolved declarations; each progress stratum keeps
          // at least one full-mass representative, never a truncated tail.
          const unresolved=Math.max(0,...pending.map(row=>(options.condition?.publications?.length??0)-publications.get(row.current)!.length));
          const slots=Math.max(strata.length,Math.floor(options.maximum/(1+unresolved)));
          let remaining=slots-strata.length;
          while(remaining-->0){let best=strata[0]!;for(const group of strata)if(best.quota>=best.indices.length||group.quota<group.indices.length&&group.mass/(group.quota+1)>best.mass/(best.quota+1))best=group;best.quota++;}
          const selected=new Map<number,number>();
          for(const group of strata){
            const reduced=generateProbability({kind:'weighted',weights:group.indices.map(index=>population[index]!.probability/group.mass)},group.quota,options.entropy);
            if(reduced.representation==='particles')representation='particles';
            for(const choice of reduced.outcomes)selected.set(group.indices[Number(choice.coordinate)]!,choice.probability*group.mass);
          }
          pending.length=0;outcomes.length=0;
          for(let index=0;index<population.length;index++){
            const row=population[index]!,mass=selected.get(index);
            if(mass!==undefined){row.probability=mass;(index<pendingCount?pending:outcomes).push(row);}
            else{execute('cleanup',()=>row.current.close());owned.delete(row.current);publications.delete(row.current);}
          }
          if(!pending.length)break;
        }
      }
      // An ordered-prefix proposal needs room for its matching branch and
      // complement. Finish those currents depth-first instead of filling all
      // slots with unrelated hidden draws; discrete-result SMC keeps its
      // existing traversal and mass accounting.
      const depthFirst=options.condition?.publications?.some(value=>value!==null&&typeof value==='object'&&'kind' in value&&value.kind==='ordered-prefix')===true&&!guidedFinitePartition;
      const node=(depthFirst?pending.pop():pending.shift())!,stop=node.current.inspect();
      if(stop.kind==='fault')throw Error('Production probability continuation failed: '+stop.error.message);
      // Declarations describe already public results, not raw hidden draws.
      // Prune a contradicted prefix before drawing unrelated future outcomes.
      // Each outgoing edge is still executed once; no retry or old checkpoint.
      const expected=options.condition?.publications,seen=publications.get(node.current)!;
      if(impossible.has(node.current)||expected&&(seen.length>expected.length||seen.some((value,index)=>!isDeepStrictEqual(value,expected[index])))){
        execute('cleanup',()=>node.current.close());owned.delete(node.current);publications.delete(node.current);continue;
      }

      if(stop.kind!=='chance'){
        const next=stop.kind==='call'?options.continueCall?.(stop,node.data):undefined;
        if(next){node.data=next.data;advance(node.current,next.reply);pending.push(node);}
        else{
          if(++attempts>capacity)throw Error('probability-observation-attempt-budget');
          const likelihood=expected&&seen.length!==expected.length?0:options.condition?.likelihood(node.current,node.data,publications.get(node.current)!)??1;
          if(!Number.isFinite(likelihood)||likelihood<0||likelihood>1)throw Error('Invalid observation likelihood');
          if(likelihood===0){execute('cleanup',()=>node.current.close());owned.delete(node.current);publications.delete(node.current);}
          else{node.probability*=likelihood;if(!(node.probability>0))throw Error('Observation likelihood mass underflow');outcomes.push(node);}
        }
        continue;
      }
      if(stop.space.kind==='boundary'&&stop.space.name===options.untilBoundary){outcomes.push(node);continue;}
      const maximum=capacity-pending.length-outcomes.length;
      const partition=options.condition?.hint===undefined?undefined:execute('advance',()=>node.current.machine.partitionProbability(expected?expected.slice(seen.length):options.condition!.hint,Math.max(1,Math.min(options.maximum,capacity-attempts-pending.length)),options.entropy));
      const target=expected?.[seen.length];
      if(partition&&target!==null&&typeof target==='object'&&'kind' in target&&target.kind==='discrete-result')guidedFinitePartition=true;
      // Preserve finite exact enumeration when it fits. A space that already
      // requires sampling must not consume the entire observation-attempt
      // allowance at a single hidden operation. Keep the accepted-world
      // sample allowance across the still-unmatched public declarations and
      // leave room for later public-conditioned partitions.
      // Every sample carries its parent mass and stays marked particles.
      const size=stop.space.kind==='uniform'?stop.space.size:stop.space.kind==='weighted'?BigInt(stop.space.weights.filter(weight=>weight>0).length):stop.space.kind==='boundary'?1n:null;
      const unresolved=Math.max(1,(expected?.length??0)-seen.length),share=Math.max(1,Math.floor(options.maximum/unresolved));
      const drawMaximum=depthFirst&&(size===null||size>BigInt(maximum))?Math.min(maximum,share):maximum;
      const space=partition??generateProbability(stop.space,drawMaximum,options.entropy,entropy=>execute('advance',()=>node.current.machine.sampleProbability(entropy)));
      if(space.representation==='particles')representation='particles';
      const createdAfter=immutableRuleEpoch(),generated:Node[]=[];
      for(const choice of depthFirst?[...space.outcomes].reverse():space.outcomes){
        options.entropy.check();
        const child=fork(node);child.probability*=choice.probability;
        if(!(child.probability>0))throw Error('Probability continuation mass underflow');
        advance(child.current,choice.coordinate);
        const declared=publications.get(child.current)!;
        if(impossible.has(child.current)||expected&&(declared.length>expected.length||declared.some((value,index)=>!isDeepStrictEqual(value,expected[index])))){
          execute('cleanup',()=>child.current.close());owned.delete(child.current);publications.delete(child.current);
        }else{
          const canMerge=!!options.condition&&!guidedFinitePartition&&child.current.machine.root.stop.kind!=='fault';
          const same=canMerge?execute('advance',()=>generated.find(prior=>
            sameObservationData([publications.get(prior.current),prior.data],[declared,child.data],options.entropy.check)&&
            (prior.current.machine.storage as CardGraph<CardRoot<S>>).sameCurrent(child.current.machine.storage as CardGraph<CardRoot<S>>,options.entropy.check,createdAfter))):undefined;
          if(same){same.probability+=child.probability;execute('cleanup',()=>child.current.close());owned.delete(child.current);publications.delete(child.current);}
          else generated.push(child);
        }
      }
      pending.push(...generated);
      execute('cleanup',()=>node.current.close());owned.delete(node.current);publications.delete(node.current);
    }
    options.entropy.check();
    const evidence=outcomes.reduce((sum,node)=>sum+node.probability,0);
    if(!options.condition){
      const frontier={representation,outcomes};validateMass(frontier,options.maximum);
      for(const node of outcomes){options.entropy.check();execute('cleanup',()=>node.current.collect());}
      owned.clear();return{frontier,evidence:1};
    }
    if(!Number.isFinite(evidence)||evidence>1+1e-12)throw Error('Invalid observation evidence mass');
    if(evidence===0)return{frontier:null,evidence};
    for(const node of outcomes)node.probability/=evidence;
    let selected=outcomes;
    if(outcomes.length>options.maximum){
      const reduced=generateProbability({kind:'weighted',weights:outcomes.map(node=>node.probability)},options.maximum,options.entropy);
      representation='particles';selected=reduced.outcomes.map(choice=>{const node=outcomes[Number(choice.coordinate)]!;return{...node,probability:choice.probability};});
      const retained=new Set(selected.map(node=>node.current));
      for(const node of outcomes)if(!retained.has(node.current)){execute('cleanup',()=>node.current.close());owned.delete(node.current);publications.delete(node.current);}
    }
    const frontier={representation,outcomes:selected};validateMass(frontier,options.maximum);
    for(const node of selected){options.entropy.check();execute('cleanup',()=>node.current.collect());}
    owned.clear();return{frontier,evidence};
  }finally{for(const current of owned)execute('cleanup',()=>current.close());}
}

/** Ordinary search and observation-constrained expansion share this executor. */
export function nextProbabilityFrontier<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(
  source:ProbabilityFrontier<S,Setup,P,R,D>,reply:(current:ProbabilityCurrent<S,Setup,P,R>,data:D)=>unknown,
  options:ContinuationOptions&{continueCall?:(stop:Extract<CardStop<P,R>,{kind:'call'}>,data:D)=>{reply:unknown;data:D}|undefined},
):ProbabilityFrontier<S,Setup,P,R,D>{return advanceProbabilityFrontier(source,reply,options).frontier!;}

/** Condition only on an observation ALREADY delivered by actual execution.
 * Candidates run forward once from their current boundary. Rejected candidates
 * free capacity; an interrupted traversal never publishes partial evidence.
 * The accepted-world bound is applied after observation, not before it. */
export function conditionedNextProbabilityFrontier<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(
  source:ProbabilityFrontier<S,Setup,P,R,D>,reply:(current:ProbabilityCurrent<S,Setup,P,R>,data:D)=>unknown,
  options:ContinuationOptions&{publications?:readonly unknown[];hint?:unknown;attempts:number;likelihood:(current:ProbabilityCurrent<S,Setup,P,R>,data:D,publications:readonly unknown[])=>number;continueCall?:(stop:Extract<CardStop<P,R>,{kind:'call'}>,data:D)=>{reply:unknown;data:D}|undefined},
):{frontier:ProbabilityFrontier<S,Setup,P,R,D>|null;evidence:number}{
  return advanceProbabilityFrontier(source,reply,{...options,condition:{...(options.publications?{publications:options.publications}:{}),hint:options.hint,attempts:options.attempts,likelihood:options.likelihood}});
}

/** Single-current entry uses exactly the same frontier continuation kernel. */
export function nextProbability<S,Setup,P extends {[K in keyof P]:PortShape},R>(
  source:ProbabilityCurrent<S,Setup,P,R>,reply:unknown,options:ContinuationOptions,
):{representation:'exact'|'particles';outcomes:{current:ProbabilityCurrent<S,Setup,P,R>;probability:number}[]}{
  const result=nextProbabilityFrontier({representation:'exact',outcomes:[{current:source,probability:1,data:null}]},()=>reply,options);
  return{representation:result.representation,outcomes:result.outcomes.map(({current,probability})=>({current,probability}))};
}

/** Bayes conditioning is separate from expansion: only observation likelihood
 * may remove mass. A budget failure must never pass through this function as
 * an observation. Empty particle support is explicit, not the real hidden root. */
export function conditionProbabilityFrontier<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(
  source:ProbabilityFrontier<S,Setup,P,R,D>,likelihood:(current:ProbabilityCurrent<S,Setup,P,R>,data:D)=>number,
  options:Pick<ContinuationOptions,'entropy'|'execute'>,
):{evidence:number;frontier:ProbabilityFrontier<S,Setup,P,R,D>|null}{
  validateMass(source);
  const execute=options.execute??(<T>(_phase:string,operation:()=>T)=>operation());
  const conditioned=source.outcomes.map(node=>{
    options.entropy.check();const data=structuredClone(node.data),value=likelihood(node.current,data);
    if(!Number.isFinite(value)||value<0||value>1)throw Error('Invalid observation likelihood');
    const weight=node.probability*value;
    if(value>0&&weight===0)throw Error('Observation likelihood mass underflow');
    // The public observer may extend its identity correspondence at this very
    // boundary. Keep those updates, detached both from the borrowed parent
    // and from any reference retained by the observer itself.
    return{weight,data:structuredClone(data)};
  });
  const evidence=conditioned.reduce((sum,row)=>sum+row.weight,0);
  if(evidence===0)return{evidence,frontier:null};
  const outcomes:ProbabilityFrontier<S,Setup,P,R,D>['outcomes']=[];
  try{
    for(let i=0;i<source.outcomes.length;i++){
      options.entropy.check();const row=conditioned[i]!;if(!row.weight)continue;
      const node=source.outcomes[i]!,current=execute('fork',()=>node.current.fork());
      outcomes.push({current,probability:row.weight/evidence,data:row.data});
    }
    options.entropy.check();return{evidence,frontier:{representation:source.representation,outcomes}};
  }catch(error){for(const node of outcomes)execute('cleanup',()=>node.current.close());throw error;}
}

export type ProbabilityFrontierSnapshot<S,D>={representation:'exact'|'particles';outcomes:{context:CardRoot<S>;probability:number;data:D}[]};
/** Save only the retained CURRENT contexts at their original public IO or
 * terminal boundaries. Chance/program-internal checkpoints are not persistable. */
export function saveProbabilityFrontier<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(source:ProbabilityFrontier<S,Setup,P,R,D>):ProbabilityFrontierSnapshot<S,D>{
  validateMass(source);
  const program=source.outcomes[0]!.current.machine.program;
  return{representation:source.representation,outcomes:source.outcomes.map(node=>{
    if(node.current.machine.program!==program)throw Error('Probability frontier requires one shared Program');
    const context=node.current.machine.storage.export(node.current.machine.root);program.validate(context);
    return{context,probability:node.probability,data:structuredClone(node.data)};
  })};
}
export function restoreProbabilityFrontier<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(program:CardProgram<S,Setup,P,R>,saved:ProbabilityFrontierSnapshot<S,D>):ProbabilityFrontier<S,Setup,P,R,D>{
  validateMass(saved);
  for(const node of saved.outcomes)program.validate(node.context);
  const outcomes:ProbabilityFrontier<S,Setup,P,R,D>['outcomes']=[];
  try{
    for(const node of saved.outcomes){
      const data=structuredClone(node.data),current=new ProbabilityCurrent(new CardMachine(program,privateCardGraph(node.context)));
      outcomes.push({current,probability:node.probability,data});
    }
    return{representation:saved.representation,outcomes};
  }catch(error){for(const node of outcomes)node.current.close();throw error;}
}

/** Subscribe before the real machine reaches a forward-generation marker.
 * Continue that generation's actual live leaves to public IO/terminal NOW,
 * using the same entropy and budget as their generation. The receiver owns a
 * completed frontier only after returning successfully. No prior scope roots
 * are exported or retained. Unsubscribe affects future handoffs only. */
export function captureForwardFrontier<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(
  machine:CardMachine<S,Setup,P,R>,
  options:{data:D;enabled?:()=>boolean;limit?:import('../../card-engine/src/probability.ts').ForwardProbabilityLimit;charge?:(milliseconds:number)=>void;complete?:(result:import('../../card-engine/src/probability.ts').ForwardProbabilityResult)=>void;continueCall?:(stop:Extract<CardStop<P,R>,{kind:'call'}>,data:D)=>{reply:unknown;data:D}|undefined;receive:(frontier:ProbabilityFrontier<S,Setup,P,R,D>)=>void},
):()=>void{
  return receiveForwardProbability(machine.storage,delivery=>{
    const borrowed:ProbabilityFrontier<S,Setup,P,R,D>={representation:delivery.representation,outcomes:delivery.outcomes.map(node=>({
      current:new ProbabilityCurrent(new CardMachine(machine.program,node.storage)),probability:node.probability,data:options.data,
    }))};
    const frontier=nextProbabilityFrontier(borrowed,()=>0n,{maximum:delivery.maximum,entropy:delivery.entropy,execute:delivery.execute,...(options.continueCall?{continueCall:options.continueCall}:{})});
    try{options.receive(frontier);}
    catch(error){for(const node of frontier.outcomes)delivery.execute('cleanup',()=>node.current.close());throw error;}
  },{...(options.enabled?{enabled:options.enabled}:{}),...(options.limit?{limit:options.limit}:{}),...(options.charge?{charge:options.charge}:{}),...(options.complete?{complete:options.complete}:{})});
}
