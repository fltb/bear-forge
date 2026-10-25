import {type CardProgram,type CardStop} from '@bear-forge/card-engine';
import type {PortShape} from '@bear-forge/contracts/core';
import {addMass,multiplyMass,nextProbabilityCoordinate,probabilityCursor,sumRemainingCursors,unitMass,zeroMass,
  type ProbabilityCursor,type ProbabilityMass,type WeightedProbabilityCursor} from '../../card-engine/src/probability-cursor.ts';
import {ProbabilityCurrent,restoreProbabilityCurrent,type ProbabilitySnapshot,type StoredProbabilitySnapshot} from './probability.ts';
import {createHash} from 'node:crypto';

/** Conservative data equality, including aliases, cycles, property order and
 * prototypes. Unsupported structured-clone brands simply miss this reuse. */
function samePlainGraph(a:unknown,b:unknown):boolean{
  const left=new Map<object,object>(),right=new Map<object,object>(),pending:[unknown,unknown][]=[[a,b]];
  while(pending.length){const [x,y]=pending.pop()!;
    if(x===null||y===null||typeof x!=='object'||typeof y!=='object'){if(!Object.is(x,y))return false;continue;}
    if(left.has(x)||right.has(y)){if(left.get(x)!==y||right.get(y)!==x)return false;continue;}
    const prototype=Object.getPrototypeOf(x);if(prototype!==Object.getPrototypeOf(y)||![null,Object.prototype,Array.prototype].includes(prototype))return false;
    left.set(x,y);right.set(y,x);const keys=Reflect.ownKeys(x),other=Reflect.ownKeys(y);if(keys.length!==other.length)return false;
    for(let i=0;i<keys.length;i++){const key=keys[i]!;if(key!==other[i]||typeof key!=='string')return false;
      const u=Object.getOwnPropertyDescriptor(x,key)!,v=Object.getOwnPropertyDescriptor(y,key)!;
      if(!Object.hasOwn(u,'value')||!Object.hasOwn(v,'value'))return false;pending.push([u.value,v.value]);}
  }
  return true;
}
/** A candidate index for the same plain graphs compared above. V8 encodings
 * distinguish packed and holey arrays even when their complete own properties
 * are identical (in particular after structuredClone/restore). Traverse those
 * properties instead, retaining order, prototypes, aliases and scalar types.
 * A fingerprint is never an equality proof; coalesce still checks both graphs. */
function plainGraphKey(value:unknown):string|undefined{
  const hash=createHash('sha256'),seen=new Map<object,number>(),pending:unknown[]=[value];
  const token=(value:unknown)=>hash.update(JSON.stringify(value));
  while(pending.length){const value=pending.pop();
    if(value===null){token(['null']);continue;}
    if(typeof value!=='object'){
      switch(typeof value){
        case 'undefined':token(['undefined']);break;
        case 'string':case 'boolean':token([typeof value,value]);break;
        case 'number':token(['number',Object.is(value,-0)?'-0':String(value)]);break;
        case 'bigint':token(['bigint',String(value)]);break;
        default:return undefined;
      }
      continue;
    }
    const known=seen.get(value);if(known!==undefined){token(['reference',known]);continue;}
    const prototype=Object.getPrototypeOf(value);
    if(![null,Object.prototype,Array.prototype].includes(prototype))return undefined;
    seen.set(value,seen.size);const keys=Reflect.ownKeys(value);
    if(keys.some(key=>typeof key!=='string'))return undefined;
    token(['object',prototype===null?'null':prototype===Array.prototype?'array':'plain',keys]);
    for(let i=keys.length-1;i>=0;i--){const field=Object.getOwnPropertyDescriptor(value,keys[i]!)!;
      if(!Object.hasOwn(field,'value'))return undefined;pending.push(field.value);
    }
  }
  return hash.digest('hex');
}
type Chance={phase:'chance';cursor:ProbabilityCursor;remainder?:WeightedProbabilityCursor[]};
const pieces=(node:Chance&{mass:ProbabilityMass}):WeightedProbabilityCursor[]=>[{mass:node.mass,cursor:node.cursor},...node.remainder??[]];
const nodeMass=(node:{mass:ProbabilityMass}&({phase:'advance'|'inspect'}|Chance)):ProbabilityMass=>node.phase==='chance'
  ?pieces(node).reduce((sum,piece)=>addMass(sum,multiplyMass(piece.mass,piece.cursor.remaining)),zeroMass()):node.mass;

type Current<S,Setup,P extends {[K in keyof P]:PortShape},R>=ProbabilityCurrent<S,Setup,P,R>;
type Pending<S,Setup,P extends {[K in keyof P]:PortShape},R,D>={current:Current<S,Setup,P,R>;mass:ProbabilityMass;data:D;service:bigint;stride:bigint}&
  ({phase:'advance';reply:unknown}|{phase:'inspect'}|Chance);
export type ExactProbabilityOutcome<S,Setup,P extends {[K in keyof P]:PortShape},R,D>={current:Current<S,Setup,P,R>;mass:ProbabilityMass;data:D};
type SavedPending<S,D,T extends StoredProbabilitySnapshot<S>=ProbabilitySnapshot<S>>=T&{mass:ProbabilityMass;data:D;service:bigint;stride:bigint}&
  ({phase:'advance';reply:unknown}|{phase:'inspect'}|Chance);
export type ProbabilityExpansionSnapshot<S,D,T extends StoredProbabilitySnapshot<S>=ProbabilitySnapshot<S>>={version:1;stopAtBoundary:string|null;schedule:{ticks:bigint;localRemaining:bigint;chanceOrder:bigint;preferred:number|null};transferred:ProbabilityMass;pending:SavedPending<S,D,T>[];
  ready:(T&{mass:ProbabilityMass;data:D})[];
  transitions?:{hits:bigint;currents:T[];entries:{source:number;edges:{coordinate:bigint;current:number}[]}[]}};
type Options<P extends {[K in keyof P]:PortShape},R,D>={
  /** Scheduling may stop BEFORE a unit of work. Nothing is discarded. */
  check?:()=>void;
  /** Renewable interpreter work slice, never a limit on represented depth. */
  instructionsPerStep?:number;
  /** Named original scope boundaries at which this expansion ends. */
  stopAtBoundary?:string;
  continueCall?:(stop:Extract<CardStop<P,R>,{kind:'call'}>,data:D)=>{reply:unknown;data:D}|undefined;
};

/** One exact action distribution, held as current nodes and unconsumed chance
 * coordinates. step() never samples, never restarts a prefix and never turns
 * a scheduling stop into a leaf. Its in-memory and saved states conserve mass.
 * Completed outcomes transfer once through take(); callers retain them in
 * their search graph and save that graph together with this remaining work. */
export class ProbabilityExpansion<S,Setup,P extends {[K in keyof P]:PortShape},R,D>{
  private pending:Pending<S,Setup,P,R,D>[]=[];
  private ready:ExactProbabilityOutcome<S,Setup,P,R,D>[]=[];
  private transferred=zeroMass();
  private ticks=0n;
  private localRemaining=31n;
  private chanceOrder=0n;
  private preferred:Current<S,Setup,P,R>|null=null;
  private active:Current<S,Setup,P,R>|null=null;
  private candidates=new Map<string,Set<Pending<S,Setup,P,R,D>>>();
  private candidateKeys=new WeakMap<Pending<S,Setup,P,R,D>,string>();
  private transitions:{source:Current<S,Setup,P,R>;edges:Map<bigint,Current<S,Setup,P,R>>}[]=[];
  private transitionBuckets=new Map<string,number[]>();
  private transitionHits=0n;
  private transitionCurrents:Current<S,Setup,P,R>[]=[];
  private transitionCurrentIds=new Map<Current<S,Setup,P,R>,number>();
  private transitionCurrentBuckets=new Map<string,number[]>();
  private closed=false;
  readonly program:CardProgram<S,Setup,P,R>;
  private readonly options:Options<P,R,D>;
  private constructor(program:CardProgram<S,Setup,P,R>,options:Options<P,R,D>){this.program=program;this.options=options;}
  static from<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(current:Current<S,Setup,P,R>,reply:unknown,data:D,options:Options<P,R,D>={}):ProbabilityExpansion<S,Setup,P,R,D>{
    options.check?.();
    const ownedData=structuredClone(data),ownedReply=structuredClone(reply),result=new ProbabilityExpansion<S,Setup,P,R,D>(current.machine.program,options);
    const branch=current.fork();result.pending.push({current:branch,mass:unitMass(),data:ownedData,service:0n,stride:1n,phase:'advance',reply:ownedReply});result.preferred=branch;return result;
  }
  private unindex(node:Pending<S,Setup,P,R,D>):void{
    const key=this.candidateKeys.get(node);if(key===undefined)return;
    const bucket=this.candidates.get(key)!;bucket.delete(node);if(!bucket.size)this.candidates.delete(key);this.candidateKeys.delete(node);
  }
  private coalesce(node:Pending<S,Setup,P,R,D>):void{
    // With one pending current there is no possible merge partner. Avoid
    // encoding its entire Context just to populate an unusable index. If it
    // later branches, finish() indexes the retained cursor among its new
    // replacements before another chance current can join it. Restore also
    // sees the whole pending array before rebuilding this derived index.
    if(node.phase!=='chance'||this.pending.length<2)return;
    const dataKey=plainGraphKey([node.cursor.space,node.data]);if(dataKey===undefined)return;
    const key=node.current.candidateKey()+':'+dataKey;
    const bucket=this.candidates.get(key)??new Set<Pending<S,Setup,P,R,D>>();
    for(const prior of bucket){
      if(prior===node)return;
      if(prior.phase!=='chance'||!samePlainGraph(prior.cursor.space,node.cursor.space)||!samePlainGraph(prior.data,node.data)||!prior.current.sameCurrent(node.current))continue;
      // At each original coordinate x the incoming coefficient is
      // sum_i p_i*1_{remaining_i}(x). Store its disjoint intervals behind
      // one exact current. This includes disjoint and overlapping supports;
      // previously delivered coordinates contribute nothing to this sum.
      const combined=sumRemainingCursors([...pieces(prior),...pieces(node)]);
      if(!combined.length)continue;
      const [first,...remainder]=combined,index=this.pending.indexOf(node);
      prior.mass=first!.mass;prior.cursor=first!.cursor;prior.remainder=remainder;
      prior.service=prior.service<node.service?prior.service:node.service;prior.stride=prior.stride<node.stride?prior.stride:node.stride;
      this.pending.splice(index,1);this.unindex(node);
      if(this.preferred===node.current)this.preferred=prior.current;if(this.active===node.current)this.active=prior.current;
      node.current.close();return;
    }
    bucket.add(node);this.candidates.set(key,bucket);this.candidateKeys.set(node,key);
  }
  /** The original chance resolution and following deterministic instructions
   * define N(current, coordinate), up to the next original waiting/yield stop.
   * Keep that computed successor even after its source cursor was consumed.
   * Incoming probability and public-history metadata stay on each caller. */
  private retainTransitionCurrent(current:Current<S,Setup,P,R>,preserveActive=false):Current<S,Setup,P,R>{
    // Immediately before execution, encode the cache's branch instead of
    // releasing the owner's live COW graph and decoding it again. Successors
    // still park their owner: its next service may be far away, and keeping
    // a live graph in every retained expansion would inflate the frontier.
    let owned:Current<S,Setup,P,R>|null=null;
    try{
      const source=preserveActive?(owned=current.fork()):current;
      const key=source.candidateKey(),bucket=this.transitionCurrentBuckets.get(key)??[];
      for(const index of bucket){const known=this.transitionCurrents[index]!;if(known.sameCurrent(source))return known;}
      owned??=current.fork();owned.park();
      const index=this.transitionCurrents.length;this.transitionCurrents.push(owned);this.transitionCurrentIds.set(owned,index);bucket.push(index);this.transitionCurrentBuckets.set(key,bucket);
      const retained=owned;owned=null;return retained;
    }
    finally{owned?.close();}
  }
  private transitionSource(current:Current<S,Setup,P,R>){
    const stop=current.inspectExact();if(stop.kind!=='chance')return undefined;
    const space=probabilityCursor(stop.space).space;
    // A singleton does not branch. Keep its existing in-place continuation
    // instead of allocating a witness and a cached copy at every marker.
    if(space.kind==='uniform'?space.size===1n:space.weights.filter(weight=>weight.numerator>0n).length<=1)return undefined;
    const source=this.retainTransitionCurrent(current,true),key=source.candidateKey(),bucket=this.transitionBuckets.get(key)??[];
    for(const index of bucket){const entry=this.transitions[index]!;if(entry.source===source||entry.source.sameCurrent(source))return entry;}
    const entry={source,edges:new Map<bigint,Current<S,Setup,P,R>>()},index=this.transitions.length;
    this.transitions.push(entry);bucket.push(index);this.transitionBuckets.set(key,bucket);return entry;
  }
  transitionStats(){return{currents:this.transitionCurrents.length,sources:this.transitions.length,edges:this.transitions.reduce((n,row)=>n+row.edges.size,0),hits:this.transitionHits};}
  get complete(){return this.pending.length===0;}
  /** Exact mass already transferred by take(). Scheduling reads this often;
   * it must not rescan unconsumed chance cursors just to read the ledger.
   * Return a detached value so callers cannot change future accounting. */
  get delivered(){return{...this.transferred};}
  masses(){

    return{pending:this.pending.reduce((total,node)=>addMass(total,nodeMass(node)),zeroMass()),
      ready:this.ready.reduce((total,node)=>addMass(total,node.mass),zeroMass()),transferred:{...this.transferred}};
  }
  step():boolean{
    this.options.check?.();if(!this.pending.length)return false;
    // At most 63 local steps between fair services; small frontiers retain
    // their 31-step bursts. Increasing bursts quadratically with width delays later
    // coordinates while earlier coordinates keep producing descendants.
    // Existing saved countdowns finish unchanged; each new burst is bounded.
    // Cursor and child inherit the same stride. Doubling it after each split
    // gives the j-th coordinate an exponential service penalty, even though
    // it is just another outcome of the same original random operation.
    // Existing saved positive strides remain valid; no clock is reset.
    // Each edge increases the clock by at least one. Below any finite clock
    // there are finitely many steps and cursor children, so no positive-mass
    // pending task can be starved by an infinite preferred path.
    const local=this.localRemaining>0n;
    const found=local&&this.preferred?this.pending.findIndex(node=>node.current===this.preferred):-1;
    // After delivering a leaf, continue the most recently suspended work.
    // Falling back to the oldest cursor here starts a new wide subtree after
    // every leaf and defeats locality even when most turns prefer one path.
    let index=local?(found>=0?found:this.pending.length-1):0;
    if(!local)for(let i=1;i<this.pending.length;i++)if(this.pending[i]!.service<this.pending[index]!.service)index=i;
    const node=this.pending[index]!;
    this.unindex(node);
    if(this.active!==node.current){this.active?.park();this.active=node.current;}
    const service=node.service+node.stride;
    const finish=(replacement:Pending<S,Setup,P,R,D>[],preferred:Current<S,Setup,P,R>|null)=>{
      for(const next of replacement){next.service=service;next.stride=node.stride;}
      this.pending.splice(index,1);this.pending.push(...replacement);
      // Fair service also hands the next locality burst to that task.
      // Otherwise an infinite preferred path gets every locality turn while
      // a finite sibling moves only one instruction boundary per queue lap.
      if(!local||this.preferred===null||this.preferred===node.current)this.preferred=preferred;
      this.localRemaining=local?this.localRemaining-1n:(this.pending.length<32?31n:63n);
      this.ticks++;
      // Retained siblings need their complete data, not live proxy/radix
      // indexes. Commit the cursor/phase before representation compaction so
      // even an allocation failure cannot cause an executed edge to repeat.
      this.active=preferred;
      if(node.current!==preferred&&this.pending.some(row=>row.current===node.current))node.current.park();
      for(const next of replacement)this.coalesce(next);
    };
    if(node.phase==='advance'){
      const entry=this.transitionSource(node.current),known=entry?.edges.get(node.reply as bigint);
      if(known){
        const current=known.fork();
        // Only clone retained successor data; do not invoke its old operation
        // or reconstruct a prefix. The caller keeps its own mass and metadata.
        finish([{current,mass:node.mass,data:node.data,service:node.service,stride:node.stride,phase:'inspect'}],current);
        node.current.close();this.transitionHits++;return true;
      }
      // Commit the phase at the original instruction boundary, before an
      // export or collection failure. A failed step keeps its queue position
      // and schedule, but never leaves an already consumed reply pending.
      node.current.advanceExact(node.reply,()=>{
        this.pending[index]={current:node.current,mass:node.mass,data:node.data,service:node.service,stride:node.stride,phase:'inspect'};
      },this.options.instructionsPerStep);
      node.current.machine.takeProbabilityPublications();
      if(entry&&node.current.inspectExact().kind!=='fault'){
        entry.edges.set(node.reply as bigint,this.retainTransitionCurrent(node.current));
      }
      finish([this.pending[index]!],node.current);return true;
    }
    if(node.phase==='chance'){
      const choice=nextProbabilityCoordinate(node.cursor);
      if(!choice){
        const [first,...remainder]=node.remainder??[];
        if(first)finish([{...node,...first,remainder:remainder}],node.current);
        else{finish([],null);node.current.close();}return true;
      }
      if(node.current.machine.probabilityCoordinatesEquivalent()){
        // Every remaining coordinate has the same future observable law.
        // Integrate the retained submeasures, including rotated/overlapping
        // intervals from old checkpoints; execute one UNCONSUMED coordinate.
        // Neither the original chance space nor its saved cursor is rewritten.
        const mass=nodeMass(node),data=structuredClone(node.data);
        finish([{current:node.current,mass,data,service:node.service,stride:node.stride,phase:'advance',reply:choice.coordinate}],node.current);return true;
      }
      const data=structuredClone(node.data),mass=multiplyMass(node.mass,choice.probability);
      const remaining=choice.cursor.remaining.numerator>0n?[{mass:node.mass,cursor:choice.cursor},...node.remainder??[]]:node.remainder??[];
      if(!remaining.length){
        finish([{current:node.current,mass,data,service:node.service,stride:node.stride,phase:'advance',reply:choice.coordinate}],node.current);return true;
      }
      const current=node.current.fork(),[first,...remainder]=remaining;
      node.mass=first!.mass;node.cursor=first!.cursor;node.remainder=remainder;
      finish([node,{current,mass,data,service:node.service,stride:node.stride,phase:'advance',reply:choice.coordinate}],current);return true;
    }
    const stop=node.current.inspectExact();
    if(stop.kind==='fault')throw Error('Original probability execution failed: '+stop.error.message);
    if(stop.kind==='yield'){
      finish([{current:node.current,mass:node.mass,data:node.data,service:node.service,stride:node.stride,phase:'advance',reply:undefined}],node.current);
    }else if(stop.kind==='chance'&&stop.space.kind==='boundary'&&stop.space.name===this.options.stopAtBoundary){
      this.ready.push({current:node.current,mass:node.mass,data:node.data});finish([],null);
    }else if(stop.kind==='chance'){
      const cursor=probabilityCursor(stop.space);
      // Rotate the complete enumeration, never sample it. Independent chance
      // sites should not all descend through coordinate zero (which can be
      // the same rejected draw forever). This mixer uses scheduling identity
      // only, never the game's actual RNG or a future hidden value.
      if(this.chanceOrder>0n){
        let mixed=BigInt.asUintN(64,this.chanceOrder+0x9e3779b97f4a7c15n);
        mixed=BigInt.asUintN(64,(mixed^(mixed>>30n))*0xbf58476d1ce4e5b9n);
        mixed=BigInt.asUintN(64,(mixed^(mixed>>27n))*0x94d049bb133111ebn);mixed^=mixed>>31n;
        const size=cursor.space.kind==='uniform'?cursor.space.size:BigInt(cursor.space.weights.length),offset=mixed%size;
        if(offset!==0n)cursor.offset=offset;
      }
      this.chanceOrder++;
      finish([{current:node.current,mass:node.mass,data:node.data,service:node.service,stride:node.stride,phase:'chance',cursor}],node.current);
    }else{
      const next=stop.kind==='call'?this.options.continueCall?.(stop,structuredClone(node.data)):undefined;
      if(next)finish([{current:node.current,mass:node.mass,data:structuredClone(next.data),service:node.service,stride:node.stride,phase:'advance',reply:structuredClone(next.reply)}],node.current);
      else{this.ready.push({current:node.current,mass:node.mass,data:node.data});finish([],null);}
    }
    return true;
  }
  take():ExactProbabilityOutcome<S,Setup,P,R,D>|undefined{
    const node=this.ready[0];if(node){this.transferred=addMass(this.transferred,node.mass);this.ready.shift();}return node;
  }
  /** Read original, untransferred prefixes without executing or consuming
   * them. Chance suffixes retain their exact conditional mass, including
   * merged remainders; ready results are included until take() transfers them.
   * The trusted reader may project public data, never choose or run an action. */
  readFrontier<T>(read:(current:Current<S,Setup,P,R>,data:D)=>T):{mass:ProbabilityMass;value:T}[]{
    return [...this.pending.map(node=>({node,mass:nodeMass(node)})),...this.ready.map(node=>({node,mass:node.mass}))]
      .filter(row=>row.mass.numerator>0n).map(({node,mass})=>({mass:{...mass},value:read(node.current,node.data)}));
  }
  save():ProbabilityExpansionSnapshot<S,D>{
    return this.saveUsing(current=>current.snapshot());
  }
  savePacked(){
    return this.saveUsing(current=>current.packedSnapshot());
  }
  private saveUsing<T extends StoredProbabilitySnapshot<S>>(snapshot:(current:Current<S,Setup,P,R>)=>T){

    return{version:1 as const,stopAtBoundary:this.options.stopAtBoundary??null,schedule:{ticks:this.ticks,localRemaining:this.localRemaining,chanceOrder:this.chanceOrder,preferred:this.preferred===null?null:this.pending.findIndex(node=>node.current===this.preferred)},transferred:{...this.transferred},pending:this.pending.map(node=>({...snapshot(node.current),mass:{...node.mass},data:structuredClone(node.data),service:node.service,stride:node.stride,
      ...(node.phase==='advance'?{phase:'advance' as const,reply:structuredClone(node.reply)}:node.phase==='chance'?{phase:'chance' as const,cursor:structuredClone(node.cursor),...(node.remainder?{remainder:structuredClone(node.remainder)}:{})}:{phase:'inspect' as const})})),
      ready:this.ready.map(node=>({...snapshot(node.current),mass:{...node.mass},data:structuredClone(node.data)})),
      ...(this.transitions.length?{transitions:{hits:this.transitionHits,currents:this.transitionCurrents.map(snapshot),entries:this.transitions.map(entry=>({source:this.transitionCurrentIds.get(entry.source)!,edges:[...entry.edges].map(([coordinate,current])=>({coordinate,current:this.transitionCurrentIds.get(current)!}))}))}}:{})};
  }
  static restore<S,Setup,P extends {[K in keyof P]:PortShape},R,D>(program:CardProgram<S,Setup,P,R>,saved:ProbabilityExpansionSnapshot<S,D,StoredProbabilitySnapshot<S>>,options:Options<P,R,D>={}):ProbabilityExpansion<S,Setup,P,R,D>{
    const result=new ProbabilityExpansion<S,Setup,P,R,D>(program,options);
    result.transferred={...saved.transferred};result.ticks=saved.schedule.ticks;result.localRemaining=saved.schedule.localRemaining;result.chanceOrder=saved.schedule.chanceOrder;
    // Restore one current at a time; saved control and probability bookkeeping
    // are trusted data and never cause a pending operation to execute.
    const restoreCurrent=(stored:StoredProbabilitySnapshot<S>)=>restoreProbabilityCurrent(program,stored);
    try{
      if(saved.transitions!==undefined){
        const memo=saved.transitions;
        result.transitionHits=memo.hits;
        for(const row of memo.currents){
          const current=restoreCurrent(row),index=result.transitionCurrents.length;result.transitionCurrents.push(current);result.transitionCurrentIds.set(current,index);
          const key=current.candidateKey(),bucket=result.transitionCurrentBuckets.get(key)??[];bucket.push(index);result.transitionCurrentBuckets.set(key,bucket);
        }
        const resolve=(index:number)=>result.transitionCurrents[index]!;
        for(const row of memo.entries){
          const source=resolve(row.source),entry={source,edges:new Map<bigint,Current<S,Setup,P,R>>()};result.transitions.push(entry);
          for(const edge of row.edges){
            entry.edges.set(edge.coordinate,resolve(edge.current));
          }
          const key=source.candidateKey(),bucket=result.transitionBuckets.get(key)??[];bucket.push(result.transitions.length-1);result.transitionBuckets.set(key,bucket);
        }
      }
      for(const row of saved.pending){
        const data=structuredClone(row.data),tail=row.phase==='advance'?{phase:'advance' as const,reply:structuredClone(row.reply)}:
          row.phase==='chance'?{phase:'chance' as const,cursor:structuredClone(row.cursor),...(row.remainder?{remainder:structuredClone(row.remainder)}:{})}:{phase:'inspect' as const};
        const current=restoreCurrent(row);
        result.pending.push({current,mass:{...row.mass},data,service:row.service,stride:row.stride,...tail});
      }
      for(const row of saved.ready){
        const data=structuredClone(row.data),current=restoreCurrent(row);
        result.ready.push({current,mass:{...row.mass},data});
      }
      result.preferred=saved.schedule.preferred===null?null:result.pending[saved.schedule.preferred]!.current;
      // Rebuild the derived index from saved current data. No game operation
      // is evaluated, and every merged coordinate retains its full weight.
      for(const node of [...result.pending])result.coalesce(node);
      return result;
    }catch(error){result.close();throw error;}
  }
  close(){
    if(this.closed)return;this.closed=true;
    for(const node of [...this.pending,...this.ready])node.current.close();for(const current of this.transitionCurrents)current.close();this.transitions=[];this.transitionCurrents=[];this.transitionBuckets.clear();this.transitionCurrentIds.clear();this.transitionCurrentBuckets.clear();this.pending=[];this.ready=[];this.active=null;this.candidates.clear();this.candidateKeys=new WeakMap();
  }
}
