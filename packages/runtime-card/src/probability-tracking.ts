import {isDeepStrictEqual} from 'node:util';
import type {CardDefinition,CardMachine,CardStop} from '@bear-forge/card-engine';
import type {PortShape} from '@bear-forge/contracts/core';
import type {Instance} from '@bear-forge/contracts/instance';
import {initialForwardAccount,type ForwardProbabilityAccount,type ForwardProbability} from '../../card-engine/src/probability.ts';
import {captureForwardFrontier,conditionedNextProbabilityFrontier,conditionProbabilityFrontier,saveProbabilityFrontier,restoreProbabilityFrontier,type ProbabilityFrontier,type ProbabilityFrontierSnapshot,type ProbabilityRootControl} from './probability.ts';

/** Static host projections, using the game's original public port contract. */
export type ProbabilityObservationMemory=Record<string,unknown>;
type ProbabilityTrackingCommon<P extends {[K in keyof P]:PortShape},R>={
  /** Original accepted decision boundary resets the per-decision account. */
  isDecision?:(stop:Extract<CardStop<P,R>,{kind:'call'}>)=>boolean;
};
export type ProbabilityTrackingSpec<P extends {[K in keyof P]:PortShape},R>=ProbabilityTrackingCommon<P,R>&({
  /** Account for current-only search without maintaining historical worlds. */
  mode:'current';
}|{
  mode?:'posterior';
  /** Anchor only opaque identities already shared by every branch at this
   * first fork. Never inspect hidden values to predict or score outcomes. */
  anchor?:(currentState:unknown,memory:ProbabilityObservationMemory)=>void;
  /** Original player request boundary; intermediate event IO cannot renew a
   * decision's probability allowance. Called only for an accepted reply. */
  /** Choose evidence batching from the accepted PUBLIC request only. */
  deferAutomatic?:(stop:Extract<CardStop<P,R>,{kind:'call'}>)=>boolean;
  /** Update only public identity associations; repeated inspection of the same
   * boundary must be idempotent. This memory never drives game execution. */
  // An acknowledgement is fixed by the original port contract. Its public
  // key may be retained until the next decision; it is evidence, not an input.
  observe:(stop:CardStop<P,R>,memory:ProbabilityObservationMemory)=>{key:string;acknowledgement?:unknown}|{reply:unknown};
  respond:(actual:Extract<CardStop<P,R>,{kind:'call'}>,reply:unknown,alternative:Extract<CardStop<P,R>,{kind:'call'}>)=>unknown;
  word:ForwardProbability['word'];
});
const specifications=new WeakMap<object,ProbabilityTrackingSpec<any,any>>();
export function withProbabilityTracking<S,Setup,P extends {[K in keyof P]:PortShape},R>(definition:CardDefinition<S,Setup,P,R>,spec:ProbabilityTrackingSpec<P,R>):CardDefinition<S,Setup,P,R>{
  if(specifications.has(definition))throw Error('Probability tracking already registered');
  specifications.set(definition,spec);return definition;
}
export function probabilityTrackingFor(definition:object):ProbabilityTrackingSpec<any,any>|undefined{return specifications.get(definition);}
export type ProbabilityWindow={milliseconds:number;nodes:number;advances:number};
const emptyWindow=():ProbabilityWindow=>({milliseconds:0,nodes:0,advances:0});
export type ProbabilityTrackingSnapshot<S>={
  mode:'current'|'posterior';
  pending:unknown[]|null;publications:unknown[];deferred:string[];deferAutomatic:boolean;window:ProbabilityWindow;phase:'waiting'|'active'|'failed';aligned:boolean;reason:string|null;account:ForwardProbabilityAccount;observation:ProbabilityObservationMemory;frontier:ProbabilityFrontierSnapshot<S,ProbabilityObservationMemory>|null;
};
export type ProbabilitySearchLease={
  account:ForwardProbabilityAccount;window:ProbabilityWindow;
  close(cost:{milliseconds:number;nodes:number;advances:number}):ForwardProbabilityAccount;
};
export type ProbabilityHostCost={update:(milliseconds:number)=>ForwardProbabilityAccount};
const hostCosts=new WeakMap<object,(priorMilliseconds:number)=>ProbabilityHostCost>();
export function registerProbabilityHostCost(handle:object,open:(priorMilliseconds:number)=>ProbabilityHostCost):void{hostCosts.set(handle,open);}
export async function acquireProbabilityHostCost(instance:Instance<any,any>,priorMilliseconds=0):Promise<ProbabilityHostCost>{
  const status=await instance.inspect();if(!status.ok)throw Error(status.error.code+': '+status.error.message);
  const open=hostCosts.get(instance);if(!open)throw Error('Instance has no probability resource capability');return open(priorMilliseconds);
}
const searchLeases=new WeakMap<object,(priorMilliseconds:number)=>ProbabilitySearchLease>();
export function registerProbabilitySearch(handle:object,open:(priorMilliseconds:number)=>ProbabilitySearchLease):void{searchLeases.set(handle,open);}
export async function acquireProbabilitySearch(instance:Instance<any,any>,priorMilliseconds:number):Promise<ProbabilitySearchLease>{
  const status=await instance.inspect();if(!status.ok)throw Error(status.error.code+': '+status.error.message);
  const open=searchLeases.get(instance);if(!open)throw Error('Instance has no probability resource capability');
  return open(priorMilliseconds);
}
const views=new WeakMap<object,()=>{mode:'current'|'posterior';phase:string;aligned:boolean;reason:string|null;worlds:number;account:ForwardProbabilityAccount;window:ProbabilityWindow}>();
export function registerProbabilityTrackingView(handle:object,view:()=>ReturnType<NonNullable<ReturnType<typeof views.get>>>):void{views.set(handle,view);}
export async function inspectProbabilityTracking(instance:Instance<any,any>){
  const status=await instance.inspect();if(!status.ok)throw Error(status.error.code+': '+status.error.message);
  const view=views.get(instance);return view?view():null;
}
function validateSnapshot<S>(value:ProbabilityTrackingSnapshot<S>):void{
  if(!value||!['current','posterior'].includes(value.mode)||!['waiting','active','failed'].includes(value.phase)||typeof value.aligned!=='boolean'||(value.reason!==null&&typeof value.reason!=='string')||!value.account||!value.observation||typeof value.observation!=='object'||Array.isArray(value.observation))throw Error('Invalid probability tracking snapshot');
  if(value.mode==='current'&&(value.frontier!==null||value.pending!==null||value.publications.length!==0||value.deferred.length!==0||value.phase==='active'))throw Error('Current-only snapshot contains historical probability worlds');
  const window=value.window;
  if(!window||!Number.isFinite(window.milliseconds)||window.milliseconds<0||[window.nodes,window.advances].some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid probability decision window');
  const a=value.account;
  if(!a.random||!Number.isSafeInteger(a.random.state)||a.random.state<0||a.random.state>0xffffffff||!Number.isSafeInteger(a.random.position)||a.random.position<0||!Number.isFinite(a.milliseconds)||a.milliseconds<0||[a.nodes,a.advances,a.words,a.captures].some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid probability tracking account');
  if(!Array.isArray(value.publications))throw Error('Invalid current probability publications');
  if(typeof value.deferAutomatic!=='boolean')throw Error('Invalid public evidence scheduling');
  if(!Array.isArray(value.deferred)||value.deferred.some(key=>typeof key!=='string')||value.deferred.length>0&&value.pending===null)throw Error('Invalid deferred public evidence');
  if(value.pending!==null&&(!Array.isArray(value.pending)||value.phase!=='active'||value.aligned||value.pending.length!==value.frontier?.outcomes.length))throw Error('Invalid pending probability input');
  if(value.phase==='active'?!value.frontier||value.reason!==null:value.frontier!==null||value.aligned||value.phase==='failed'&&!value.reason||value.phase==='waiting'&&value.reason!==null)throw Error('Inconsistent probability tracking snapshot');
}

/** An instance-owned collection of CURRENT continuations. Actual execution is
 * always the same machine. Only accepted replies enter advance; rejected IO
 * leaves both this collection and the real machine untouched. */
export class ProbabilityTracker<S,Setup,P extends {[K in keyof P]:PortShape},R>{
  private phase:'waiting'|'active'|'failed'='waiting';
  private aligned=false;
  // One accepted, unexecuted outgoing input per retained CURRENT waiting node.
  // Never an action prefix: consume it once when the next public IO is known.
  private pending:unknown[]|null=null;
  private publications:unknown[]=[];
  private deferred:string[]=[];
  private deferAutomatic=true;
  private reason:string|null=null;
  private account=initialForwardAccount();
  private frontier:ProbabilityFrontier<S,Setup,P,R,ProbabilityObservationMemory>|null=null;
  private observation:ProbabilityObservationMemory={};
  private readonly detach:()=>void;
  private closed=false;
  private searching=false;
  private recoveryBaseMilliseconds:number|null=null;
  private window=emptyWindow();
  private readonly clock:()=>number;
  private readonly machine:CardMachine<S,Setup,P,R>;
  private readonly spec:ProbabilityTrackingSpec<P,R>;
  constructor(machine:CardMachine<S,Setup,P,R>,spec:ProbabilityTrackingSpec<P,R>,source?:ProbabilityTracker<S,Setup,P,R>|ProbabilityTrackingSnapshot<S>,clock=()=>performance.now()){
    this.machine=machine;this.spec=spec;this.clock=clock;
    if(source instanceof ProbabilityTracker){
      source.open();this.pending=structuredClone(source.pending);this.publications=structuredClone(source.publications);this.deferred=[...source.deferred];this.deferAutomatic=source.deferAutomatic;this.recoveryBaseMilliseconds=source.recoveryBaseMilliseconds;this.frontier=source.forkFrontier();this.phase=source.phase;this.aligned=source.aligned;this.reason=source.reason;this.account=structuredClone(source.account);this.observation=structuredClone(source.observation);this.window=structuredClone(source.window);
    }else if(source){
      validateSnapshot(source);if(source.mode!==(spec.mode??'posterior'))throw Error('Probability tracking model mismatch');this.pending=structuredClone(source.pending);this.publications=structuredClone(source.publications);this.deferred=[...source.deferred];this.deferAutomatic=source.deferAutomatic;this.recoveryBaseMilliseconds=source.account.milliseconds;this.phase=source.phase;this.aligned=source.aligned;this.reason=source.reason;this.account=structuredClone(source.account);this.observation=structuredClone(source.observation);this.window=structuredClone(source.window);
      if(source.frontier){
        const nodes=source.frontier.outcomes.length,reason=this.limit(0,nodes);
        if(reason){this.phase='failed';this.aligned=false;this.pending=null;this.deferred=[];this.reason=reason;}
        else{
          const started=this.clock();this.account.nodes+=nodes;this.window.nodes+=nodes;
          try{this.frontier=restoreProbabilityFrontier(machine.program,source.frontier);}
          finally{const elapsed=this.clock()-started;this.account.milliseconds+=elapsed;this.window.milliseconds+=elapsed;}
        }
      }
    }
    const tracker=this;
    try{
      this.detach=captureForwardFrontier(machine,{get data(){if(spec.mode!=='current')spec.anchor?.(machine.root.state,tracker.observation);return tracker.observation;},enabled:()=>spec.mode!=='current'&&this.phase==='waiting',limit:cost=>this.limit(cost.milliseconds,cost.nodes),charge:milliseconds=>{this.window.milliseconds+=milliseconds;this.account.milliseconds+=milliseconds;},continueCall:(stop,data)=>{
        if(spec.mode==='current')throw Error('Current-only tracking cannot capture historical worlds');
        const observed=spec.observe(stop,data);return 'reply' in observed?{reply:observed.reply,data}:undefined;
      },receive:frontier=>{this.frontier=frontier;this.phase='active';this.aligned=false;},complete:result=>{
        const cost=result.cost;this.account={random:{...result.random},milliseconds:this.account.milliseconds+cost.milliseconds,nodes:this.account.nodes+cost.nodes,advances:this.account.advances+cost.advances,words:this.account.words+cost.words,captures:this.account.captures+1};
        this.window.milliseconds+=cost.milliseconds;this.window.nodes+=cost.nodes;this.window.advances+=cost.advances;
        if(result.reason)this.fail(result.reason);
      }});
    }catch(error){this.release();throw error;}
  }
  private open(){if(this.closed)throw Error('Probability tracker is closed');}
  private release(){this.pending=null;this.publications=[];this.deferred=[];if(this.frontier){for(const row of this.frontier.outcomes)row.current.close();this.frontier=null;}}
  private fail(reason:string){this.release();this.phase='failed';this.aligned=false;this.pending=null;this.reason=reason;}
  private limit(milliseconds=0,nodes=0):string|null{
    if(this.window.milliseconds+milliseconds>=2000)return 'tracking-wall-budget';
    if(this.account.milliseconds+milliseconds>=60_000)return 'tracking-game-budget';
    if(this.window.nodes+nodes>10000)return 'tracking-node-budget';
    if(process.memoryUsage().rss>=1024**3)return 'tracking-memory-budget';
    return null;
  }
  private budget<T>(operation:(options:{maximum:number;entropy:{check():void;word():number};execute:<V>(phase:'fork'|'advance'|'cleanup',run:()=>V)=>V})=>T):T{
    const started=this.clock();
    const check=()=>{const reason=this.limit(this.clock()-started);if(reason)throw Error(reason);};
    const execute=<V>(phase:'fork'|'advance'|'cleanup',run:()=>V):V=>{
      if(phase!=='cleanup')check();
      if(phase==='fork'){if(this.window.nodes>=10000)throw Error('tracking-node-budget');this.window.nodes++;this.account.nodes++;}
      // Interpreter/event advances are work counters, not search simulations.
      if(phase==='advance'){this.window.advances++;this.account.advances++;}
      return run();
    };
    try{return operation({maximum:8,execute,entropy:{check,word:()=>{check();if(this.spec.mode==='current')throw Error('Current-only tracking cannot sample historical worlds');const next=this.spec.word(this.account.random);this.account.random=next.random;this.account.words++;return next.value;}}});}
    finally{const elapsed=this.clock()-started;this.window.milliseconds+=elapsed;this.account.milliseconds+=elapsed;}
  }
  private forkFrontier(){
    if(!this.frontier)return null;
    return this.budget(options=>conditionProbabilityFrontier(this.frontier!,()=>1,options).frontier!);
  }
  private view(stop:CardStop<P,R>,memory:ProbabilityObservationMemory){
    if(stop.kind==='fault')throw Error(stop.error.message);
    if(this.spec.mode==='current')throw Error('Current-only tracking has no posterior observer');
    const view=this.spec.observe(stop,memory);
    if('key' in view&&typeof view.key!=='string')throw Error('Invalid public probability observation');
    if(('reply' in view||'acknowledgement' in view)&&stop.kind!=='call')throw Error('Only an original IO call can be skipped');
    return view;
  }
  advance(reply?:unknown):CardStop<P,R>{
    this.open();if(this.searching)throw Error('Cannot advance the live Context during probability search');
    const previous=this.machine.root.stop;
    if(previous?.kind==='call'&&(this.spec.isDecision?.(previous)??true)){
      this.window=emptyWindow();this.deferAutomatic=this.spec.mode==='current'?false:this.spec.deferAutomatic?.(previous)??true;
    }
    const before=this.frontier&&this.aligned?this.machine.current():undefined;
    if(previous?.kind==='call'&&this.phase==='active'){
      try{
        const prior=this.budget(()=>this.view(previous,this.observation));
        if('acknowledgement' in prior&&!isDeepStrictEqual(reply,prior.acknowledgement))this.fail('probability-acknowledgement-mismatch');
      }catch(error){this.fail(error instanceof Error?error.message:String(error));}
    }
    // The accepted real reply executes once. Only its public observation can
    // constrain the still-unexecuted successors of the held current frontier.
    const stop=this.machine.advance(reply),published=this.machine.takeProbabilityPublications();
    if(stop.kind==='fault'){this.fail(stop.error.message);return stop;}
    if(this.phase==='failed'||this.spec.mode==='current')return stop;
    try{
      const observed=this.budget(options=>{options.entropy.check();const result=this.view(stop,this.observation);options.entropy.check();return result;});
      if(this.frontier&&(before?.kind==='call'||this.pending!==null)){
        this.publications.push(...published);
        if(before?.kind==='call'){
          if(this.pending!==null)throw Error('Probability input already pending');
          this.pending=this.budget(options=>this.frontier!.outcomes.map(row=>{
            options.entropy.check();const candidate=row.current.inspect();if(candidate.kind!=='call')throw Error('Probability input boundary mismatch');
            if(this.spec.mode==='current')throw Error('Current-only tracking cannot advance historical worlds');
            return structuredClone(this.spec.respond(before,reply,candidate));
          }));
        }
        this.aligned=false;
        // A visible automatic event adds only evidence. The one accepted
        // input is still unexecuted in these currents; no old edge is retried.
        if('acknowledgement' in observed&&this.deferAutomatic){
          this.budget(()=>this.deferred.push(observed.key));
        }else if('key' in observed){
          const replies=new Map(this.frontier.outcomes.map((row,index)=>[row.current,this.pending![index]]));
          const source={...this.frontier,outcomes:this.frontier.outcomes.map(row=>({...row,data:{observation:row.data,index:0}}))};
          const result=this.budget(options=>conditionedNextProbabilityFrontier(source,current=>replies.get(current),{
            ...options,attempts:64,hint:this.publications,publications:this.publications,
            continueCall:(candidate,data)=>{
              const seen=this.view(candidate,data.observation);
              if('reply' in seen)return{reply:seen.reply,data};
              if('acknowledgement' in seen&&data.index<this.deferred.length&&seen.key===this.deferred[data.index]){
                data.index++;return{reply:seen.acknowledgement,data};
              }
              return undefined;
            },
            likelihood:(current,data,publications)=>{
              if(data.index!==this.deferred.length||!isDeepStrictEqual(publications,this.publications))return 0;
              const candidate=current.inspect();if(candidate.kind==='chance')throw Error('Internal probability checkpoint escaped');
              const seen=this.view(candidate,data.observation);return 'key' in seen&&seen.key===observed.key?1:0;
            },
          }).frontier);
          const next=result?{...result,outcomes:result.outcomes.map(row=>({...row,data:row.data.observation}))}:null;
          this.release();
          if(!next)this.fail('observation-outside-particle-support');
          else{this.frontier=next;this.aligned=true;}
        }
      }else if(this.frontier&&'key' in observed){
        // A first-generation handoff (or a frontier already ahead of an
        // invisible IO) has reached this boundary; never execute it twice.
        const posterior=this.budget(options=>conditionProbabilityFrontier(this.frontier!,(current,data)=>{
          const candidate=current.inspect();if(candidate.kind==='chance')throw Error('Internal probability checkpoint escaped');
          const seen=this.view(candidate,data);return 'key' in seen&&seen.key===observed.key?1:0;
        },options));
        this.release();
        if(posterior.frontier){this.frontier=posterior.frontier;this.aligned=true;}
        else this.fail('observation-outside-particle-support');
      }
    }catch(error){this.fail(error instanceof Error?error.message:String(error));}
    return stop;
  }

  private reconcileHost(priorMilliseconds:number){
    if(!Number.isFinite(priorMilliseconds)||priorMilliseconds<0)throw Error('Invalid prior probability cost');
    if(this.recoveryBaseMilliseconds!==null&&priorMilliseconds>0){
      // The host ledger precedes this restore. Add only its missing suffix to
      // the saved base; do not erase the restore/new work already charged.
      const missing=Math.max(0,priorMilliseconds-this.recoveryBaseMilliseconds);
      this.account.milliseconds+=missing;this.window.milliseconds+=missing;
      this.recoveryBaseMilliseconds=null;
    }else this.account.milliseconds=Math.max(this.account.milliseconds,priorMilliseconds);
  }
  includeHostCost(mark:{total:number;window:number},milliseconds:number):ForwardProbabilityAccount{
    this.open();if([mark.total,mark.window,milliseconds].some(n=>!Number.isFinite(n)||n<0))throw Error('Invalid enclosing host cost');
    this.account.milliseconds=Math.max(this.account.milliseconds,mark.total+milliseconds);
    this.window.milliseconds=Math.max(this.window.milliseconds,mark.window+milliseconds);
    return structuredClone(this.account);
  }
  beginHostCost(priorMilliseconds=0):ProbabilityHostCost{
    this.open();if(this.searching)throw Error('Cannot persist an unfinished probability search');
    this.reconcileHost(priorMilliseconds);
    const mark={total:this.account.milliseconds,window:this.window.milliseconds};
    return{update:milliseconds=>this.includeHostCost(mark,milliseconds)};
  }
  beginSearch(priorMilliseconds:number):ProbabilitySearchLease{
    this.open();if(this.searching)throw Error('Probability search resources are already in use');
    this.reconcileHost(priorMilliseconds);
    const account=structuredClone(this.account),window=structuredClone(this.window);this.searching=true;let closed=false;
    return{account:structuredClone(account),window:structuredClone(window),close:cost=>{
      if(closed)return structuredClone(this.account);
      if(!Number.isFinite(cost.milliseconds)||cost.milliseconds<0||[cost.nodes,cost.advances].some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid search cost');
      // Source forks are already charged while search runs. Enclosing search
      // costs include those operations: retain the union, not their sum.
      this.account.milliseconds=Math.max(this.account.milliseconds,account.milliseconds+cost.milliseconds);
      this.window.milliseconds=Math.max(this.window.milliseconds,window.milliseconds+cost.milliseconds);
      this.account.nodes=Math.max(this.account.nodes,account.nodes+cost.nodes);
      this.window.nodes=Math.max(this.window.nodes,window.nodes+cost.nodes);
      this.account.advances=Math.max(this.account.advances,account.advances+cost.advances);
      this.window.advances=Math.max(this.window.advances,window.advances+cost.advances);
      this.searching=false;closed=true;return structuredClone(this.account);
    }};
  }
  forkForSearch(control:ProbabilityRootControl){
    this.open();control.check();
    if(this.phase==='failed')throw Error('Probability posterior unavailable: '+this.reason);
    if(this.phase==='waiting')return null;
    if(!this.aligned||!this.frontier)throw Error('Probability posterior has not reached the actual public boundary');
    const observation=structuredClone(this.observation);
    const frontier=this.budget(options=>conditionProbabilityFrontier(this.frontier!,()=>1,{
      entropy:{word:options.entropy.word,check(){options.entropy.check();control.check();}},
      execute:(phase,run)=>options.execute(phase,()=>control.execute(phase,run)),
    }).frontier!);
    return{frontier,observation};
  }
  inspect(){this.open();return{mode:this.spec.mode??'posterior',phase:this.phase,aligned:this.aligned,reason:this.reason,worlds:this.frontier?.outcomes.length??0,account:structuredClone(this.account),window:structuredClone(this.window)};}
  snapshot():ProbabilityTrackingSnapshot<S>{
    this.open();if(this.searching)throw Error('Cannot save an unfinished probability search');const started=this.clock();let frontier:ProbabilityFrontierSnapshot<S,ProbabilityObservationMemory>|null;
    try{frontier=this.frontier?saveProbabilityFrontier(this.frontier):null;}
    finally{const elapsed=this.clock()-started;this.account.milliseconds+=elapsed;this.window.milliseconds+=elapsed;}
    return{mode:this.spec.mode??'posterior',pending:structuredClone(this.pending),publications:structuredClone(this.publications),deferred:[...this.deferred],deferAutomatic:this.deferAutomatic,phase:this.phase,aligned:this.aligned,reason:this.reason,account:structuredClone(this.account),observation:structuredClone(this.observation),window:structuredClone(this.window),frontier};
  }
  fork(machine:CardMachine<S,Setup,P,R>){return new ProbabilityTracker(machine,this.spec,this,this.clock);}
  close(){if(!this.closed){this.closed=true;this.detach();this.release();}}
}
