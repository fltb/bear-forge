import {addMass,compareMass,divideMass,multiplyMass,subtractMass,unitMass,zeroMass,type ProbabilityMass} from '../../../card-engine/src/probability-mass.ts';
import {CycleSearch,type CycleState} from './cycles.ts';
import {evaluateLocalGraph} from './local-evaluation.ts';
import type {ExactDomain,ExactExpansion,ExactPosition,SearchSessionSnapshot,TerminalValue,TerminalBound,ValueInterval} from './session.types.ts';

type Weighted={execution:number;mass:ProbabilityMass};
type Distribution<C,E>={complete:boolean;outcomes:Weighted[];expansion:ExactExpansion<C,E>|null;
  /** Derived from the attached prefix only; never saved as authoritative data. */
  projected:number;terminalMass:ProbabilityMass;terminalValue:TerminalValue;nonterminal:Map<number,ProbabilityMass>;
  localPriority?:{projected:number;value:number}};
type Execution<C,E>={current:C;position:ExactPosition|null;representative:number|null;edges:Map<string,Distribution<C,E>>};
type Edge={action:string;nextWorld:number;published:boolean;outcomes:{belief:number;mass:ProbabilityMass}[];score:ValueInterval;dominatedBy:string|null};
type Belief={position:ExactPosition;worlds:Weighted[];parent:number|null;edges:Map<string,Edge>;score:ValueInterval};
type Task={belief:number;action:string};
const zero=(length:number):TerminalValue=>Array.from({length},zeroMass);
const add=(a:TerminalValue,b:TerminalValue)=>a.map((value,index)=>addMass(value,b[index]!));
const scale=(a:TerminalValue,mass:ProbabilityMass)=>a.map(value=>multiplyMass(value,mass));
export function compareBound(a:TerminalBound,b:TerminalBound):number{

  for(let i=0;i<a.length;i++){const left=a[i]!,right=b[i]!,order=left===null?(right===null?0:1):right===null?-1:compareMass(left,right);if(order)return order;}return 0;
}
export const compareValue=(a:TerminalValue,b:TerminalValue)=>compareBound(a,b);
const addBound=(a:TerminalBound,b:TerminalBound):TerminalBound=>a.map((value,i)=>value===null||b[i]===null?null:addMass(value,b[i]!));
const scaleBound=(a:TerminalBound,mass:ProbabilityMass):TerminalBound=>a.map(value=>mass.numerator===0n?zeroMass():value===null?null:multiplyMass(value,mass));
function samePosition(a:ExactPosition,b:ExactPosition){
  return a.information===b.information&&a.priority===b.priority&&a.utility===b.utility&&JSON.stringify(a.localExclusions??[])===JSON.stringify(b.localExclusions??[])&&JSON.stringify(a.actions)===JSON.stringify(b.actions)&&
    (a.terminal===null?b.terminal===null:b.terminal!==null&&compareValue(a.terminal,b.terminal)===0);
}

/** A retained information-set AND/OR frontier. A player successor is published
 * only after the FULL action law is known for every world in its parent belief.
 * This prevents late hidden outcomes from receiving different decisions.
 * A scheduling step performs at most one domain continuation step; it has no
 * depth/round cutoff and never substitutes a baseline or a heuristic leaf.
 * Finite priority batches follow promising successors; FIFO service between batches
 * revisits unfinished edges fairly. Public priority only orders work.
 * A strict lower(a) > upper(b) proof suspends work below b, retaining its
 * complete support and all current executions. Equality never mutually prunes
 * actions. Root certification also requires the reachable nondominated
 * frontier to be solved; a lower bound alone may defer its exit forever.
 * Complete equivalent currents share laws. Identical posteriors over their
 * equivalence classes share beliefs, including cyclic references. Self returns
 * are summed geometrically; larger complete components enumerate stationary
 * policies through retained exact first-exit elimination. */
export class SearchSession<C,S,E>{
  private executions:Execution<C,E>[]=[];
  private equivalenceBuckets=new Map<string,number[]>();
  private mergedExecutions=0;
  private beliefs:Belief[]=[];
  private beliefIndex=new Map<string,number[]>();
  private publishedExecutions=new Set<number>();
  private preparedPreferred:{execution:number;action:string}|null=null;
  private graphComponents:number[][]=[];
  private componentOf:number[]=[];
  private cycles=new Map<string,CycleSearch>();
  private activeCycles:string[]=[];
  private cycleCursor=0n;
  private preferCycle=false;
  private cycleChoices=new Map<number,{action:string;policy:number;lower:TerminalValue;mass:ProbabilityMass;steps:ProbabilityMass}>();
  private solvedCycleNodes=new Set<number>();
  private graphDirty=true;
  // Derived values depend only on terminal prefix sums, published belief laws
  // and cycle certificates. An original continuation without such evidence
  // cannot change any bound. Keep invalidation across exceptions, not just
  // within one scheduling step; clear it only after a complete successful pass.
  private valuesDirty=true;
  private preparedUpperCache=new Map<number,TerminalBound>();
  private constrainedExecutions=new Set<number>();
  private incomingNonterminal=new Map<number,Set<Distribution<C,E>>>();
  private constrainedLaws=new WeakSet<Distribution<C,E>>();
  private boundedLaws=new WeakSet<Distribution<C,E>>();
  private distributionOwners=new WeakMap<Distribution<C,E>,number>();
  private constraintWork=new Set<number>();
  private incomingExecution=new Map<number,{source:number;action:string;mass:ProbabilityMass}>();
  private terminalExecutions=new Set<number>();
  private policyWitnesses=new Map<number,Map<string,TerminalValue>>();
  private witnessesDirty=true;
  private queue:Task[]=[];
  // Derived highest-public-priority subsequence, in the SAME order as queue.
  // No value, probability, cursor or retained task lives only in this index.
  private priorityTasks:Task[]|null=null;
  private rootTasks:{groups:Task[][];owners:Map<Task,Task[]>}|null=null;
  private rootCursor=0n;
  private localGroupCursor=0n;
  private preferred:{belief:number;action:string}|null=null;
  private localRemaining=0n;
  private dormant:{belief:number;action:string}[]=[];
  private schedulingDirty=false;
  private scheduleMode:'exact'|'local'='exact';
  private liveBeliefs:boolean[]=[];
  private root=0;
  private steps=0n;
  /** Scheduling/accounting reads must not evaluate the retained frontier. */
  get stepCount():bigint{return this.steps;}
  private closed=false;
  private readonly domain:ExactDomain<C,S,E>;
  private constructor(domain:ExactDomain<C,S,E>){
    this.domain=domain;
  }
  /** Ownership of root transfers on success. Failure leaves it with caller. */
  static from<C,S,E>(domain:ExactDomain<C,S,E>,current:C,mode?:'local'):SearchSession<C,S,E>{
    const result=new SearchSession(domain),position=domain.position(current);
    if(mode)result.scheduleMode=mode;
    result.executions.push({current,position,representative:null,edges:new Map()});result.identify(0);
    result.root=result.makeBelief([{execution:0,mass:unitMass()}],null);return result;
  }
  private unknown():ValueInterval{return{lower:zero(this.domain.upper.length),upper:structuredClone(this.domain.upper)};}
  private retain(current:C):number{
    // Adoption must not invoke domain code. The caller attaches this identity
    // and its mass to the consuming edge before any projection can fail.
    const id=this.executions.length;
    this.executions.push({current,position:null,representative:null,edges:new Map()});return id;
  }
  private position(execution:number):ExactPosition{
    const node=this.executions[execution]!;
    if(node.position===null){const position=this.domain.position(node.current);node.position=position;}
    return node.position;
  }
  private identify(execution:number){
    const node=this.executions[execution]!;if(node.representative!==null)return;
    const position=this.position(execution),bucket=this.equivalenceBuckets.get(position.information)??[];
    if(this.domain.equivalent)for(const candidate of bucket){
      if(candidate>=execution)continue;
      const known=this.executions[candidate]!;
      if(samePosition(position,this.position(candidate))&&this.domain.equivalent(known.current,node.current)){
        node.representative=candidate;node.edges=known.edges;this.mergedExecutions++;return;
      }
    }
    // Keep every owned current, even after proving equivalence. The saved
    // witness can then be checked again without executing any historical edge.
    node.representative=execution;bucket.push(execution);this.equivalenceBuckets.set(position.information,bucket);
  }
  private projectDistribution(distribution:Distribution<C,E>,source:number,action:string){
    this.distributionOwners.set(distribution,this.executions[source]!.representative!);
    // Each delivered row is already attached before projection. Commit the
    // derived prefix only after projection and exact arithmetic both succeed;
    // an exception retries pure bookkeeping, never the original transition.
    while(distribution.projected<distribution.outcomes.length){
      const row=distribution.outcomes[distribution.projected]!;

      this.identify(row.execution);
      if(!this.incomingExecution.has(row.execution)){
        this.incomingExecution.set(row.execution,{source:this.executions[source]!.representative!,action,mass:{...row.mass}});
        this.witnessesDirty=true;
      }
      const terminal=this.position(row.execution).terminal;
      if(terminal){
        this.terminalExecutions.add(row.execution);this.witnessesDirty=true;this.valuesDirty=true;
        const mass=addMass(distribution.terminalMass,row.mass),value=add(distribution.terminalValue,scale(terminal,row.mass));
        this.boundLaw(distribution);
        this.valuesDirty=true;
        distribution.terminalMass=mass;distribution.terminalValue=value;
      }
      else{
        const node=this.executions[row.execution]!,representative=node.representative!;
        const weight=addMass(distribution.nonterminal.get(representative)??zeroMass(),row.mass);
        const incoming=this.incomingNonterminal.get(representative)??new Set<Distribution<C,E>>();
        incoming.add(distribution);this.incomingNonterminal.set(representative,incoming);
        if(this.constrainedExecutions.has(representative)){this.valuesDirty=true;this.constrainedLaws.add(distribution);this.boundLaw(distribution);}
        distribution.nonterminal.set(representative,weight);
      }
      distribution.projected++;
    }
  }
  /** Least fixed point of finite terminal evidence: an action has evidence if
   * a positive delivered branch is terminal or reaches a qualified execution;
   * an execution qualifies only when EVERY legal action has such evidence.
   * Without this proof, finite upper unfolding must retain M for some action.
   * Reverse links wake ancestors once. The work set survives a failed pure
   * dependency read; original edges and their commit cursors are untouched. */
  private boundLaw(distribution:Distribution<C,E>){
    this.boundedLaws.add(distribution);this.constraintWork.add(this.distributionOwners.get(distribution)!);
    while(this.constraintWork.size){
      const source=this.constraintWork.values().next().value!,node=this.executions[source]!;
      if(!this.constrainedExecutions.has(source)&&node.position!.actions.every(action=>{
        const edge=node.edges.get(action.key);return edge!==undefined&&this.boundedLaws.has(edge);
      })){
        for(const incoming of this.incomingNonterminal.get(source)??[]){
          this.boundedLaws.add(incoming);this.constraintWork.add(this.distributionOwners.get(incoming)!);
          this.constrainedLaws.add(incoming);this.valuesDirty=true;
        }
        this.constrainedExecutions.add(source);
      }
      this.constraintWork.delete(source);
    }
  }
  private prepareBelief(worlds:Weighted[],parent:number|null):Belief{

    const position=this.position(worlds[0]!.execution);
    const score=position.terminal?{lower:position.terminal,upper:position.terminal}:this.unknown();
    const node:Belief={position,worlds,parent,edges:new Map(),score};
    if(position.terminal===null)for(const action of position.actions){
      node.edges.set(action.key,{action:action.key,nextWorld:0,published:false,outcomes:[],score:this.unknown(),dominatedBy:null});
    }
    return node;
  }
  private makeBelief(worlds:Weighted[],parent:number|null):number{
    const id=this.beliefs.length,node=this.prepareBelief(worlds,parent);
    const beliefs=this.beliefs.concat(node),queue=this.queue.concat([...node.edges.keys()].map(action=>({belief:id,action})));
    this.beliefs=beliefs;this.queue=queue;this.priorityTasks=null;this.rootTasks=null;this.registerBelief(id);
    if(node.position.localExclusions?.length)this.schedulingDirty=true;
    return id;
  }
  private registerBelief(id:number){
    for(const world of this.beliefs[id]!.worlds)this.publishedExecutions.add(this.executions[world.execution]!.representative!);
    const key=this.beliefKey(this.beliefs[id]!),known=this.beliefIndex.get(key)??[];
    known.push(id);this.beliefIndex.set(key,known);this.graphDirty=true;this.valuesDirty=true;this.witnessesDirty=true;
  }
  private posterior(worlds:Weighted[]):Map<number,ProbabilityMass>{
    const result=new Map<number,ProbabilityMass>();
    for(const world of worlds){const representative=this.executions[world.execution]!.representative!;

      result.set(representative,addMass(result.get(representative)??zeroMass(),world.mass));}
    return result;
  }
  private beliefKey(node:Belief):string{
    return JSON.stringify([node.position.information,[...this.posterior(node.worlds)].sort((a,b)=>a[0]-b[0]).map(([execution,mass])=>[execution,mass.numerator.toString(),mass.denominator.toString()])]);
  }
  private components():number[][]{
    if(!this.graphDirty)return this.graphComponents;
    const outgoing=this.beliefs.map(node=>[...new Set([...node.edges.values()].flatMap(edge=>edge.outcomes.map(row=>row.belief)))]),incoming=this.beliefs.map(()=>[] as number[]);
    for(let id=0;id<outgoing.length;id++)for(const child of outgoing[id]!)incoming[child]!.push(id);
    const visited=new Set<number>(),finished:number[]=[];
    for(let id=0;id<this.beliefs.length;id++)if(!visited.has(id)){
      visited.add(id);const stack:{id:number;cursor:number}[]=[{id,cursor:0}];
      while(stack.length){const frame=stack[stack.length-1]!,child=outgoing[frame.id]![frame.cursor++];
        if(child===undefined){finished.push(frame.id);stack.pop();}
        else if(!visited.has(child)){visited.add(child);stack.push({id:child,cursor:0});}
      }
    }
    const components:number[][]=[],assigned=new Set<number>();
    for(let index=finished.length-1;index>=0;index--){const first=finished[index]!;if(assigned.has(first))continue;
      const members:number[]=[],pending=[first];assigned.add(first);
      while(pending.length){const id=pending.pop()!;members.push(id);for(const parent of incoming[id]!)if(!assigned.has(parent)){assigned.add(parent);pending.push(parent);}}
      members.sort((a,b)=>a-b);components.push(members);
    }
    this.componentOf=[];components.forEach((members,index)=>{for(const id of members)this.componentOf[id]=index;});
    this.graphComponents=components;this.graphDirty=false;return components;
  }
  private cycleGraph(ids:number[]):CycleState[]{
    return ids.map(belief=>({belief,actions:[...this.beliefs[belief]!.edges.values()].map(edge=>{

      return{key:edge.action,outcomes:structuredClone(edge.outcomes)};
    })}));
  }
  private cycleKey(graph:CycleState[]):string{return JSON.stringify(graph,(_key,value)=>typeof value==='bigint'?value.toString():value);}
  private evaluateCycle(ids:number[]){
    // Until every action law is complete, keep unknown internal continuations.
    // An undiscovered outcome may leave or enlarge the component.
    for(const id of ids)this.beliefs[id]!.score=this.unknown();
    if(ids.some(id=>[...this.beliefs[id]!.edges.values()].some(edge=>!edge.published)))return;
    const graph=this.cycleGraph(ids),key=this.cycleKey(graph);
    let search=this.cycles.get(key);if(!search){search=new CycleSearch(graph);this.cycles.set(key,search);}this.activeCycles.push(key);
    for(let index=0;index<ids.length;index++){
      const id=ids[index]!;let lower=zero(this.domain.upper.length),upper:TerminalBound=zero(this.domain.upper.length);
      let best:{action:string;policy:number;lower:TerminalValue;mass:ProbabilityMass;steps:ProbabilityMass}|undefined;
      for(const [policy,kernel] of search.kernels().entries()){
        let value=zero(this.domain.upper.length),bound:TerminalBound=zero(this.domain.upper.length),mass=zeroMass(),steps=zeroMass();
        for(const exit of kernel.exits[index]!)if(exit.belief!==null){const outside=this.beliefs[exit.belief]!.score;
          value=add(value,scale(outside.lower,exit.mass));bound=addBound(bound,scaleBound(outside.upper,exit.mass));mass=addMass(mass,exit.mass);steps=addMass(steps,exit.steps);}
        const order=best?compareValue(value,best.lower):1;
        if(!best||order>0||order===0&&(compareMass(mass,best.mass)>0||compareMass(mass,best.mass)===0&&compareMass(steps,best.steps)<0))best={action:kernel.actions[index]!,policy,lower:value,mass,steps};
        if(compareValue(value,lower)>0)lower=value;if(compareBound(bound,upper)>0)upper=bound;
      }
      this.beliefs[id]!.score={lower,upper:search.complete?upper:structuredClone(this.domain.upper)};
      if(search.complete){this.solvedCycleNodes.add(id);if(best)this.cycleChoices.set(id,best);}
    }
  }
  private expected(edge:Edge):ValueInterval{
    let lower=zero(this.domain.upper.length);let upper:TerminalBound=zero(this.domain.upper.length);
    for(const outcome of edge.outcomes){const score=this.beliefs[outcome.belief]!.score;lower=add(lower,scale(score.lower,outcome.mass));upper=addBound(upper,scaleBound(score.upper,outcome.mass));}
    return{lower,upper};
  }
  /** A perfect-information relaxation of the retained execution graph, used
   * ONLY as an upper bound. Each delivered successor contributes its proved
   * bound; unopened mass and DFS back edges retain the full domain bound.
   * Postorder induction proves each completed value without assuming that a
   * cycle terminates. Componentwise maxima include ALL original legal actions.
   * This finite graph calculation neither truncates the original search nor
   * supplies a policy, lower bound or completion certificate. */
  private preparedUpper(execution:number):TerminalBound{
    const representative=this.executions[execution]!.representative!;
    const known=this.preparedUpperCache.get(representative);if(known)return known;
    type Law={bound:TerminalBound;mass:ProbabilityMass;children:MapIterator<[number,ProbabilityMass]>;waiting:[number,ProbabilityMass]|null};
    type Frame={execution:number;actions:ArrayIterator<ExactPosition['actions'][number]>;upper:TerminalBound;law:Law|null};
    const stack:Frame[]=[],active=new Set<number>();
    const push=(id:number)=>{
      const node=this.executions[id]!,position=node.position!;
      if(position.terminal){this.preparedUpperCache.set(id,position.terminal);return;}
      // Some action lacks a finite proof path toward terminal evidence. A
      // finite unfolding must leave its bound at M; other actions cannot
      // exceed M, so this node cannot improve any incoming bound.
      if(!this.constrainedExecutions.has(id)){this.preparedUpperCache.set(id,this.domain.upper);return;}
      active.add(id);stack.push({execution:id,actions:position.actions.values(),upper:zero(this.domain.upper.length),law:null});
    };
    const finish=(bound:TerminalBound)=>{const frame=stack.pop()!;active.delete(frame.execution);this.preparedUpperCache.set(frame.execution,bound);};
    push(representative);
    while(stack.length){
      const frame=stack[stack.length-1]!,node=this.executions[frame.execution]!;
      if(!frame.law){
        const action=frame.actions.next();if(action.done){finish(frame.upper);continue;}
        const distribution=node.edges.get(action.value.key)!;
        frame.law={bound:distribution.terminalValue,mass:distribution.terminalMass,children:distribution.nonterminal.entries(),waiting:null};
      }
      const law=frame.law;
      if(law.waiting){
        const [child,mass]=law.waiting,bound=this.preparedUpperCache.get(child)!;
        law.bound=addBound(law.bound,scaleBound(bound,mass));law.mass=addMass(law.mass,mass);law.waiting=null;
      }
      const next=law.children.next();
      if(!next.done){
        const [child,mass]=next.value,bound=this.preparedUpperCache.get(child);
        if(bound||active.has(child)){
          law.bound=addBound(law.bound,scaleBound(bound??this.domain.upper,mass));law.mass=addMass(law.mass,mass);
        }else{law.waiting=[child,mass];push(child);}
        continue;
      }
      const bound=addBound(law.bound,scaleBound(this.domain.upper,subtractMass(unitMass(),law.mass)));
      if(compareBound(bound,this.domain.upper)===0){finish(this.domain.upper);continue;}
      frame.upper=frame.upper.map((value,index)=>value===null||bound[index]===null?null:compareMass(value,bound[index]!)>=0?value:bound[index]!);
      frame.law=null;
    }
    return this.preparedUpperCache.get(representative)!;
  }
  private partial(node:Belief,action:string):ValueInterval{
    // Only delivered terminal rewards contribute to the lower bound. The
    // upper may additionally propagate original terminal evidence through the
    // retained graph. Hidden worlds may differ in this relaxation, which
    // enlarges the feasible policy set; they never choose the actual policy.
    let lower=zero(this.domain.upper.length),resolved=zeroMass(),prepared:TerminalBound|null=null;
    for(const world of node.worlds){
      const distribution=this.executions[world.execution]!.edges.get(action);if(!distribution)continue;
      lower=add(lower,scale(distribution.terminalValue,world.mass));
      resolved=addMass(resolved,multiplyMass(world.mass,distribution.terminalMass));
      // This dependency index is monotone: a delivered prefix is never lost.
      // Most laws have no prepared child with evidence for EVERY legal action;
      // their original O(worlds) prefix accounting needs no successor scan.
      if(!this.constrainedLaws.has(distribution))continue;
      for(const [execution,mass] of distribution.nonterminal){
        if(!this.constrainedExecutions.has(execution))continue;
        const bound=this.preparedUpper(execution),weight=multiplyMass(world.mass,mass);
        resolved=addMass(resolved,weight);
        const contribution=scaleBound(bound,weight);prepared=prepared?addBound(prepared,contribution):contribution;
      }
    }
    const known=prepared?addBound(lower,prepared):lower;
    return{lower,upper:addBound(known,scaleBound(this.domain.upper,subtractMass(unitMass(),resolved)))};
  }

  private selfMass(id:number,edge:Edge):ProbabilityMass{
    return edge.outcomes.reduce((mass,row)=>row.belief===id?addMass(mass,row.mass):mass,zeroMass());
  }
  private continuation(id:number,edge:Edge):ValueInterval|null{
    if(!edge.published)return this.partial(this.beliefs[id]!,edge.action);
    const remaining=subtractMass(unitMass(),this.selfMass(id,edge));if(remaining.numerator===0n)return null;
    let lower=zero(this.domain.upper.length),upper:TerminalBound=zero(this.domain.upper.length);
    for(const row of edge.outcomes)if(row.belief!==id){const mass=divideMass(row.mass,remaining),value=this.beliefs[row.belief]!.score;
      lower=add(lower,scale(value.lower,mass));upper=addBound(upper,scaleBound(value.upper,mass));}
    return{lower,upper};
  }
  /** Compatible retained terminal paths prove one feasible PUBLIC policy bound.
   * Its action at every repeated information key must agree. Extend that map
   * by any legal public action elsewhere; nonnegative rewards imply that the
   * path probability times its real terminal reward is a lower bound. Each
   * execution has one retained parent, so distinct terminal leaves are
   * disjoint cylinders (including separate root posterior classes). Sum only
   * leaves whose public action maps agree; shared prefixes are counted through
   * their conditional masses, never added as separate rewards. Never sum
   * conflicting policies or execute a path as history.
   * One original incoming edge per execution is a conservative witness index,
   * not an exhaustive policy search; all other incoming edges remain stored. */
  private refreshPolicyWitnesses(){
    if(!this.witnessesDirty)return;
    // Each belief is a separate conditional starting distribution. Index its
    // complete-state classes so one backward walk can find every applicable
    // starting belief without repeatedly scanning all terminal paths.
    const starts=new Map<number,{belief:number;mass:ProbabilityMass}[]>();
    for(let belief=0;belief<this.beliefs.length;belief++)for(const [execution,mass]of this.posterior(this.beliefs[belief]!.worlds)){
      const entries=starts.get(execution)??[];entries.push({belief,mass});starts.set(execution,entries);
    }
    type Candidate={action:string;policy:Map<string,string>;value:TerminalValue};
    const candidates=new Map<number,Candidate[]>();
    for(const terminal of this.terminalExecutions){
      const reward=this.executions[terminal]!.position!.terminal!;
      if(!reward.some(value=>value.numerator>0n))continue;
      const policy=new Map<string,string>(),visited=new Set<number>(),matched=new Set<number>();let execution=terminal,mass=unitMass();
      while(!visited.has(execution)){
        visited.add(execution);const incoming=this.incomingExecution.get(execution);if(!incoming)break;
        const position=this.executions[incoming.source]!.position!,choice=policy.get(position.information);
        if(choice!==undefined&&choice!==incoming.action)break;
        policy.set(position.information,incoming.action);mass=multiplyMass(mass,incoming.mass);
        for(const start of starts.get(incoming.source)??[])if(!matched.has(start.belief)){
          // Stop this leaf's witness at the first matching class for EACH
          // belief. Ancestor actions and arrival probability are not part of
          // that belief's conditional policy. Later backward steps must not
          // mutate a previously captured policy or count this leaf twice.
          const rows=candidates.get(start.belief)??[];
          rows.push({action:incoming.action,policy:new Map(policy),value:scale(reward,multiplyMass(start.mass,mass))});
          candidates.set(start.belief,rows);matched.add(start.belief);
        }
        execution=incoming.source;
      }
    }
    // Greedy order chooses a feasible witness, not an optimal policy. Starting
    // with the strongest path retains at least the previous single-path bound.
    // Rejected witnesses remain in the original graph, with all their support.
    const witnesses=new Map<number,Map<string,TerminalValue>>();
    for(const [belief,rows]of candidates){
      rows.sort((left,right)=>compareValue(right.value,left.value));
      const policies=new Map<string,Map<string,string>>(),bounds=new Map<string,TerminalValue>();
      for(const candidate of rows){
        const policy=policies.get(candidate.action)??new Map<string,string>();
        if([...candidate.policy].some(([information,action])=>policy.has(information)&&policy.get(information)!==action))continue;
        for(const [information,action]of candidate.policy)policy.set(information,action);
        policies.set(candidate.action,policy);bounds.set(candidate.action,add(bounds.get(candidate.action)??zero(this.domain.upper.length),candidate.value));
      }
      witnesses.set(belief,bounds);
    }
    this.policyWitnesses=witnesses;this.witnessesDirty=false;
  }
  private withPolicyWitness(id:number,action:string,score:ValueInterval):ValueInterval{
    const witness=this.policyWitnesses.get(id)?.get(action);
    if(!witness||compareValue(witness,score.lower)<=0)return score;

    return{lower:witness,upper:score.upper};
  }
  private backup(){
    if(!this.valuesDirty)return;
    this.preparedUpperCache.clear();this.refreshPolicyWitnesses();
    const components=this.components();this.activeCycles=[];this.cycleChoices.clear();this.solvedCycleNodes.clear();
    for(let index=components.length-1;index>=0;index--){
      const ids=components[index]!;
      if(ids.length>1)this.evaluateCycle(ids);
      else{
        const id=ids[0]!,node=this.beliefs[id]!;if(node.position.terminal)continue;
        const scores=[...node.edges.values()].map(edge=>{const score=this.continuation(id,edge);return score===null?null:this.withPolicyWitness(id,edge.action,score);}).filter((score):score is ValueInterval=>score!==null);
        node.score=scores.length?{lower:scores.reduce((a,b)=>compareValue(a.lower,b.lower)>=0?a:b).lower,
          upper:scores.reduce((a,b)=>compareBound(a.upper,b.upper)>=0?a:b).upper}:{lower:zero(this.domain.upper.length),upper:zero(this.domain.upper.length)};
      }
      const incompleteCycle=ids.length>1&&ids.some(member=>[...this.beliefs[member]!.edges.values()].some(action=>!action.published));
      for(const id of ids){const node=this.beliefs[id]!;
        for(const edge of node.edges.values())edge.score=this.withPolicyWitness(id,edge.action,edge.published?this.expected(edge):this.partial(node,edge.action));
        const best=[...node.edges.values()].reduce((a,b)=>compareValue(a.score.lower,b.score.lower)>=0?a:b);
        if(compareValue(best.score.lower,node.score.lower)>0)node.score={...node.score,lower:best.score.lower};
        for(const edge of node.edges.values()){
          // The component solver needs every original action law. Until they
          // are complete, keep local frontiers active even if an interval has
          // already shown one of them inferior; no approximate law is supplied.
          const witness=!incompleteCycle&&edge!==best&&compareBound(best.score.lower,edge.score.upper)>0?best.action:null;
          if(edge.dominatedBy!==witness){edge.dominatedBy=witness;this.schedulingDirty=true;}
        }
      }
    }
    this.valuesDirty=false;
  }
  private settleSchedule(){
    if(this.scheduleMode!=='exact'){this.scheduleMode='exact';this.schedulingDirty=true;this.valuesDirty=true;}
    this.backup();
    if(!this.schedulingDirty)return;
    // A shared belief remains live if ANY non-dominated path reaches it.
    const live=this.beliefs.map(()=>false),pending=[this.root];live[this.root]=true;
    for(let cursor=0;cursor<pending.length;cursor++)for(const edge of this.beliefs[pending[cursor]!]!.edges.values())if(edge.dominatedBy===null)for(const row of edge.outcomes){
      if(!live[row.belief]){live[row.belief]=true;pending.push(row.belief);}
    }
    const active:typeof this.queue=[],dormant:typeof this.queue=[];
    for(const task of [...this.queue,...this.dormant]){
      const runnable=live[task.belief]&&this.beliefs[task.belief]!.edges.get(task.action)!.dominatedBy===null;
      (runnable?active:dormant).push(task);
    }
    this.queue=active;this.priorityTasks=null;this.rootTasks=null;this.dormant=dormant;this.schedulingDirty=false;
    this.liveBeliefs=live;
  }
  private runnableCycles():string[]{
    return this.activeCycles.filter(key=>this.cycles.get(key)!.graph.some(node=>this.liveBeliefs[node.belief]));
  }
  private settleLocalSchedule(){
    if(this.scheduleMode!=='local'){this.scheduleMode='local';this.schedulingDirty=true;}
    if(!this.schedulingDirty)return;
    const live=this.beliefs.map(()=>false),pending=[this.root];live[this.root]=true;
    for(let at=0;at<pending.length;at++)for(const edge of this.beliefs[pending[at]!]!.edges.values())if(this.localAllowed(pending[at]!,edge.action))for(const row of edge.outcomes){
      if(!live[row.belief]){live[row.belief]=true;pending.push(row.belief);}
    }
    const active:Task[]=[],dormant:Task[]=[];
    for(const task of [...this.queue,...this.dormant])(live[task.belief]&&this.localAllowed(task.belief,task.action)?active:dormant).push(task);
    this.queue=active;this.dormant=dormant;this.liveBeliefs=live;this.priorityTasks=null;this.rootTasks=null;this.schedulingDirty=false;
  }
  private localAllowed(belief:number,action:string){return !this.beliefs[belief]!.position.localExclusions?.some(row=>row.key===action);}
  private highestPriorityTasks(){
    if(this.priorityTasks)return this.priorityTasks;
    const tasks:typeof this.queue=[];let highest=-Infinity;
    for(const task of this.queue){
      const priority=this.beliefs[task.belief]!.position.priority;
      if(priority>highest){highest=priority;tasks.length=0;}
      if(priority===highest)tasks.push(task);
    }
    this.priorityTasks=tasks;return tasks;
  }
  /** One work group per original root action. A shared successor belongs to
   * its first live breadth-first path; its original graph still has ALL
   * incoming actions. Assignment is scheduling only, never a posterior or a
   * policy choice. Global FIFO continues independently, including for work
   * whose group changes after a publication or a dominance proof. */
  private groupedRootTasks(){
    if(this.rootTasks)return this.rootTasks;
    const root=this.beliefs[this.root]!,actions=root.position.actions;
    const groups:Task[][]=actions.map(()=>[]),owners=new Map<Task,Task[]>(),assigned=new Map<number,number>(),pending:number[]=[];
    const attach=(belief:number,group:number)=>{
      if(belief===this.root||assigned.has(belief))return;
      assigned.set(belief,group);pending.push(belief);
    };
    for(let index=0;index<actions.length;index++){
      const edge=root.edges.get(actions[index]!.key)!;
      if(this.scheduleMode==='local'?this.localAllowed(this.root,edge.action):edge.dominatedBy===null)for(const row of edge.outcomes)attach(row.belief,index);
    }
    for(let at=0;at<pending.length;at++){
      const id=pending[at]!,group=assigned.get(id)!;
      for(const edge of this.beliefs[id]!.edges.values())if(this.scheduleMode==='local'?this.localAllowed(id,edge.action):edge.dominatedBy===null)for(const row of edge.outcomes)attach(row.belief,group);
    }
    const rootActions=new Map(actions.map((action,index)=>[action.key,index]));
    for(const task of this.queue){
      const group=task.belief===this.root?rootActions.get(task.action):assigned.get(task.belief);

      groups[group!]!.push(task);owners.set(task,groups[group!]!);
    }
    if(this.scheduleMode==='local'){
      // Local group visits finish an existing edge instead of fragmenting
      // every continuation. Stable positions reconstruct the same order after
      // cold restore; the independent global FIFO still services every task.
      const ranks=new Map<number,Map<string,number>>();
      const rank=(task:Task)=>{
        let actions=ranks.get(task.belief);
        if(!actions){actions=new Map(this.beliefs[task.belief]!.position.actions.map((action,index)=>[action.key,index]));ranks.set(task.belief,actions);}
        return actions.get(task.action)!;
      };
      for(const group of groups)group.sort((a,b)=>a.belief-b.belief||
        (this.beliefs[b.belief]!.position.localTiePreferences?.[b.action]??0)-(this.beliefs[a.belief]!.position.localTiePreferences?.[a.action]??0)||rank(a)-rank(b));
    }
    this.rootTasks={groups,owners};return this.rootTasks;
  }
  /** Advance the focus ONLY through a complete, publicly selected successor.
   * The posterior must already have one proved current-equivalence class.
   * Never inspect the actual hidden state to select a world from a mixture.
   * Success adopts the full actual current; false/throw leaves it with caller. */
  rebase(actual:C,acceptedAction:string):boolean{
    const edge=this.beliefs[this.root]!.edges.get(acceptedAction);
    if(!edge?.published||!this.domain.equivalent)return false;
    const position=this.domain.position(actual);
    const outcome=edge.outcomes.find(row=>this.beliefs[row.belief]!.position.information===position.information);
    if(!outcome)return false;
    const belief=this.beliefs[outcome.belief]!,posterior=this.posterior(belief.worlds);
    if(posterior.size!==1||!samePosition(position,belief.position))return false;
    // Every hidden current has already been proved equivalent, independently
    // of the new actual Context. This last comparison only validates reuse.
    for(const world of belief.worlds)if(!this.domain.equivalent(this.executions[world.execution]!.current,actual))return false;
    const representative=posterior.keys().next().value!;
    const execution=this.executions.length,node:Execution<C,E>={current:actual,position,representative,edges:this.executions[representative]!.edges};
    const worlds=[{execution,mass:unitMass()}],executions=this.executions.concat(node);
    // No domain calls follow the ownership transfer. The original predecessor,
    // all delivered witnesses and all unused frontiers remain retained.
    this.valuesDirty=true;
    this.executions=executions;this.mergedExecutions++;belief.worlds=worlds;belief.position=position;
    // The old posterior may contain several witnesses of the same class.
    // Their shared distributions keep every consumed coordinate, but the
    // per-belief scheduling cursor now indexes a single actual current.
    for(const action of belief.edges.values())action.nextWorld=0;
    this.root=outcome.belief;this.witnessesDirty=true;this.schedulingDirty=true;return true;
  }
  private publish(id:number,edge:Edge){
    const node=this.beliefs[id]!,groups=new Map<string,{mass:ProbabilityMass;worlds:Weighted[]}>();
    for(const world of node.worlds){
      const distribution=this.executions[world.execution]!.edges.get(edge.action)!;

      for(const row of distribution.outcomes){
        const mass=multiplyMass(world.mass,row.mass),position=this.position(row.execution);
        let group=groups.get(position.information);if(!group){group={mass:zeroMass(),worlds:[]};groups.set(position.information,group);}
        group.mass=addMass(group.mass,mass);group.worlds.push({execution:row.execution,mass});
      }
    }
    // Public priorities may change scheduling order, never support or weights.
    const ordered=[...groups.values()].sort((a,b)=>this.position(b.worlds[0]!.execution).priority-this.position(a.worlds[0]!.execution).priority);
    // Prepare the complete publication before attaching its derived indexes.
    // An interrupted projection leaves the original distributions retained.
    const prepared=ordered.map(group=>this.prepareBelief(group.worlds.map(row=>({...row,mass:divideMass(row.mass,group.mass)})),id));
    const first=this.beliefs.length,added:Belief[]=[],outcomes=ordered.map((group,index)=>{
      const child=prepared[index]!,key=this.beliefKey(child);
      const existing=(this.beliefIndex.get(key)??[]).find(candidate=>samePosition(child.position,this.beliefs[candidate]!.position));
      if(existing!==undefined)return{mass:group.mass,belief:existing};
      const belief=first+added.length;added.push(child);return{mass:group.mass,belief};
    });
    const beliefs=this.beliefs.concat(added),queue=this.queue.concat(added.flatMap((child,index)=>[...child.edges.keys()].map(action=>({belief:first+index,action}))));
    this.valuesDirty=true;
    this.beliefs=beliefs;this.queue=queue;this.priorityTasks=null;this.rootTasks=null;edge.outcomes=outcomes;edge.published=true;
    for(let index=0;index<added.length;index++)this.registerBelief(first+index);
    this.graphDirty=true;this.schedulingDirty=true;
  }
  /** Compute a law from an already retained current. It is only execution
   * evidence: no hidden-world action choice or posterior is published here. */
  private advanceExecution(executionId:number,action:string):number|null{
    let delivered:number|null=null;
    const execution=this.executions[executionId]!;
    let distribution=execution.edges.get(action);
    if(!distribution){
      const representative=this.executions[execution.representative!]!;
      distribution={complete:false,outcomes:[],expansion:this.domain.next(representative.current,action),
        projected:0,terminalMass:zeroMass(),terminalValue:zero(this.domain.upper.length),nonterminal:new Map()};
      execution.edges.set(action,distribution);
    }
    if(!distribution.complete){
      const expansion=distribution.expansion!;
      // A previously transferred successor may still need its pure projection
      // after an exception. Finish that projection before consuming more work.
      this.projectDistribution(distribution,executionId,action);
      // Drain a yielded result before executing more original code. Each take
      // transfers once; its Context is retained even if projection fails.
      let outcome=expansion.take();
      if(!outcome&&!expansion.complete){expansion.step();outcome=expansion.take();}
      if(outcome){
        const row={execution:this.retain(outcome.current),mass:outcome.mass};distribution.outcomes.push(row);delivered=row.execution;
        this.projectDistribution(distribution,executionId,action);
      }
      else if(expansion.complete){

        expansion.close();distribution.expansion=null;distribution.complete=true;
      }
    }
    return delivered;
  }
  /** Advance delivered successors while their incoming law is still open.
   * Every 32nd search step may prepare one original continuation. The other
   * steps keep the existing fair belief/cycle schedule. Follow a delivered
   * child even when its public score drops; otherwise a high-scored ancestor
   * can repeatedly preempt its deeper successors. The saved pointer orders
   * work only; every consumed edge still lives in execution.edges.
   * Published representatives use the ordinary information-set schedule;
   * ungrouped worlds cannot supply independent policy values or decisions. */
  private advanceUnpublished():boolean{
    const runnable=(i:number,action:string)=>{
      const node=this.executions[i]!;
      return node.representative===i&&!this.publishedExecutions.has(i)&&!node.edges.get(action)?.complete;
    };
    let chosen:number|null=null,action:string|undefined;
    const preferred=this.preparedPreferred;
    if(preferred&&runnable(preferred.execution,preferred.action)){chosen=preferred.execution;action=preferred.action;}
    else for(let i=0;i<this.executions.length;i++){
      const node=this.executions[i]!;
      if(node.representative!==i||this.publishedExecutions.has(i)||node.position!.terminal)continue;
      const candidate=node.position!.actions.find(row=>!node.edges.get(row.key)?.complete);
      if(!candidate)continue;
      if(chosen===null||node.position!.priority>=this.executions[chosen]!.position!.priority){chosen=i;action=candidate.key;}
    }
    if(chosen===null){this.preparedPreferred=null;return false;}
    this.preparedPreferred={execution:chosen,action:action!};
    const delivered=this.advanceExecution(chosen,action!);
    if(delivered!==null){
      const representative=this.executions[delivered]!.representative!,child=this.executions[representative]!;
      const next=child.position!.actions.find(row=>runnable(representative,row.key));
      if(next)this.preparedPreferred={execution:representative,action:next.key};
    }
    this.backup();this.steps++;return true;
  }

  /** Resource checks belong before step(). Throwing from them leaves all work
   * intact. Domain pauses also retain their original expansion object. */
  private promisingLocalRootTask():Task|undefined{
    const root=this.beliefs[this.root]!;let best:Task|undefined,priority=root.position.priority;
    for(const edge of root.edges.values()){
      if(edge.published||!this.localAllowed(this.root,edge.action))continue;
      let candidate=-Infinity;
      for(const world of root.worlds){
        const distribution=this.executions[world.execution]!.edges.get(edge.action);if(!distribution)continue;
        const cached=distribution.localPriority??={projected:0,value:-Infinity};
        // Only completed public projections contribute. This optimistic max
        // orders probability work; it is NEVER an action value, posterior,
        // or license to choose different actions in hidden worlds.
        while(cached.projected<distribution.projected){
          const row=distribution.outcomes[cached.projected]!;
          cached.value=Math.max(cached.value,this.executions[row.execution]!.position!.priority);cached.projected++;
        }
        candidate=Math.max(candidate,cached.value);
      }
      if(candidate>priority){
        const task=this.queue.find(task=>task.belief===this.root&&task.action===edge.action);

        best=task;priority=candidate;
      }
    }
    return best;
  }
  stepLocal(preferredRootAction?:string):boolean{
    this.settleLocalSchedule();
    let taskIndex=0,nextRoot:bigint|null=null,nextGroup:bigint|null=null;
    const local=this.localRemaining>0n,root=this.beliefs[this.root]!;
    if(local){
      // Root coverage and public-board continuation service are independent.
      // Neither this ordering nor local utility deletes chance support.
      if(this.localRemaining%4n===0n){
        const {groups}=this.groupedRootTasks();
        for(let offset=0;offset<groups.length;offset++){
          const cursor=this.localGroupCursor+BigInt(offset),group=groups[Number(cursor%BigInt(groups.length))]!;
          if(!group.length)continue;
          taskIndex=this.queue.indexOf(group[0]!);nextGroup=cursor+1n;break;
        }
      }
      if(nextGroup===null&&this.localRemaining<=16n)for(let offset=0;offset<root.position.actions.length;offset++){
        const cursor=this.rootCursor+BigInt(offset),action=root.position.actions[Number(cursor%BigInt(root.position.actions.length))]!;
        if(root.edges.get(action.key)!.published||!this.localAllowed(this.root,action.key))continue;
        taskIndex=this.queue.findIndex(task=>task.belief===this.root&&task.action===action.key);
        nextRoot=cursor+1n;break;
      }
      if(nextRoot===null&&nextGroup===null){
        // Complete a promising current action's probability law before
        // spending this priority visit on deeper descendants of already
        // resolved actions. The other half-burst remains round-robin root
        // coverage, with the unchanged FIFO visit between bounded bursts.
        const best=this.promisingLocalRootTask()??this.highestPriorityTasks()[0];
        if(best)taskIndex=this.queue.indexOf(best);
      }
    }
    // Serve the currently preferred but unobserved action through its existing
    // continuation. Every 32nd visit still uses FIFO, including small queues,
    // so an indefinitely pending preferred law cannot starve other support.
    if(preferredRootAction!==undefined){
      const observed=(action:string)=>root.edges.get(action)!.published||root.worlds.some(world=>
        (this.executions[world.execution]!.edges.get(action)?.projected??0)>0);
      // A delivered successor is not a published posterior until its ended
      // law has been drained/closed. Finish every such root, not only the
      // initial favorite, so alternative combos and forward reuse can open.
      const finishing=root.position.actions.find(action=>!root.edges.get(action.key)!.published&&this.localAllowed(this.root,action.key)&&
        root.worlds.every(world=>{
          const distribution=this.executions[world.execution]!.edges.get(action.key);
          return distribution&&(distribution.complete||distribution.expansion?.complete);
        }));
      // Cover root alternatives alongside the preferred public continuation.
      // Waiting for every root action's first result can spend the entire
      // slice inside a wide end-turn law and never evaluate a setup combo.
      // A partial law's first successor is coverage, never completeness.
      const uncovered=observed(preferredRootAction)&&!finishing?root.position.actions
        .filter(action=>this.localAllowed(this.root,action.key)&&!observed(action.key))
        .sort((a,b)=>(root.position.localTiePreferences?.[b.key]??0)-(root.position.localTiePreferences?.[a.key]??0))[0]:undefined;
      const focus=finishing?.key??uncovered?.key??preferredRootAction;
      const demanded=this.queue.findIndex(task=>task.belief===this.root&&task.action===focus);
      const {groups}=this.groupedRootTasks();
      let continuation:Task|undefined,continuationCursor:bigint|undefined;
      for(let offset=0;offset<groups.length;offset++){
        const cursor=this.localGroupCursor+BigInt(offset),index=Number(cursor%BigInt(groups.length));
        if(!root.edges.get(root.position.actions[index]!.key)!.published||!groups[index]!.length)continue;
        continuation=groups[index]![0];continuationCursor=cursor+1n;break;
      }
      if(this.steps%32n===31n){taskIndex=0;nextRoot=null;nextGroup=null;}
      // When the caller explicitly needs an unseen candidate before it can
      // act, do not spend half that wait deepening another published action.
      // Once the demanded candidate has a successor, normal combo/coverage
      // interleaving resumes. The independent FIFO visit is unchanged.
      else if(continuation&&observed(preferredRootAction)&&(this.steps%2n===1n||demanded<0)){
        taskIndex=this.queue.indexOf(continuation);nextRoot=null;nextGroup=continuationCursor!;
      }
      else if(demanded>=0){taskIndex=demanded;nextRoot=null;nextGroup=null;}
    }
    const task=this.queue[taskIndex];if(!task)return false;
    const burst=this.queue.length<32?0n:31n,node=this.beliefs[task.belief]!,edge=node.edges.get(task.action)!;
    this.advanceExecution(node.worlds[edge.nextWorld]!.execution,task.action);
    edge.nextWorld=(edge.nextWorld+1)%node.worlds.length;
    if(node.worlds.every(world=>this.executions[world.execution]!.edges.get(task.action)?.complete))this.publish(task.belief,edge);
    this.steps++;this.queue.splice(taskIndex,1);if(!edge.published)this.queue.push(task);
    if(this.priorityTasks){const index=this.priorityTasks.indexOf(task);if(index>=0){this.priorityTasks.splice(index,1);if(!edge.published)this.priorityTasks.push(task);}}
    if(this.rootTasks){
      const group=this.rootTasks.owners.get(task);
      // Keep an unfinished edge at its stable group position. It can use
      // successive group visits to reach its next public decision, while the
      // global FIFO above remains unchanged even if this edge never finishes.
      if(group&&edge.published){group.splice(group.indexOf(task),1);this.rootTasks.owners.delete(task);}
    }
    if(nextRoot!==null)this.rootCursor=nextRoot;if(nextGroup!==null)this.localGroupCursor=nextGroup;
    this.localRemaining=local?this.localRemaining-1n:burst;
    // Per-world continuations and historical roots cannot drive this policy.
    // Only children of complete public posteriors receive decision work.
    return true;
  }
  step():boolean{
    this.settleSchedule();const pending=this.runnableCycles().filter(key=>!this.cycles.get(key)!.complete);
    if(pending.length&&(this.preferCycle||!this.queue.length)){
      this.valuesDirty=true;
      const key=pending[Number(this.cycleCursor%BigInt(pending.length))]!;this.cycleCursor+=1n;this.cycles.get(key)!.step();
      this.backup();this.steps++;this.preferCycle=false;return true;
    }
    if(this.queue.length&&this.steps%32n===31n&&this.advanceUnpublished())return true;
    // A bounded locality burst separates FIFO services. Scaling that burst
    // quadratically with frontier size makes an old task wait cubically in
    // the number of queued tasks, even when every task needs only one step.
    // Keep the existing saved countdown and small-queue FIFO behavior, then
    // use at most 31 priority steps between fair services. An old task behind N
    // tasks gets service within at most
    // the remaining countdown plus 32*(N+1) belief scheduling steps.
    // Prepared continuations add at most one step per 31 other steps; cycle
    // algebra retains its existing alternating service.
    // Local visits move their task to the tail too; they cannot push an older
    // FIFO task backwards. No law, posterior or reward depends on this order.
    const local=this.localRemaining>0n;
    let taskIndex=0,rootNext:bigint|null=null;
    if(local){
      // A root law is a dependency of its public posterior. Give unresolved
      // root laws the second half of each priority burst, retaining the first
      // half for heuristic paths to real terminals. Global FIFO, its waiting bound,
      // and prepared successors remain independent: even an infinite root
      // law cannot prevent finite sibling work from receiving service.
      // Once roots are published, retain one root-group FIFO visit per burst
      // so a wide promising subtree cannot monopolize all priority work.
      const root=this.beliefs[this.root]!,unfinished=new Set([...root.edges.values()].filter(edge=>!edge.published&&edge.dominatedBy===null).map(edge=>edge.action));
      if((this.localRemaining===16n||unfinished.size>0&&this.localRemaining<16n)&&this.queue.length>=32){
        const {groups}=this.groupedRootTasks();
        for(let offset=0;offset<groups.length;offset++){
          const cursor=this.rootCursor+BigInt(offset),index=Number(cursor%BigInt(groups.length)),group=groups[index]!;
          if(unfinished.size&&!unfinished.has(root.position.actions[index]!.key))continue;
          if(!group.length)continue;
          const task=unfinished.size?group.find(task=>task.belief===this.root):group[0];

          taskIndex=this.queue.indexOf(task!);
          rootNext=cursor+1n;break;
        }
      }
      if(rootNext===null){
        // Compare public information-set scores across the runnable frontier.
        // Among equal scores, finish the law with more delivered conditional
        // mass first. This is work ordering, not a reward or a completeness
        // certificate: even tiny remaining mass still blocks publication.
        // Posterior weights matter; counting hidden worlds would depend on how
        // the same probability measure happened to be represented. The existing
        // FIFO services remain unchanged, including for infinite partial laws.
        const progress=new Map<typeof this.queue[number],ProbabilityMass>();
        const delivered=(task:typeof this.queue[number])=>{
          let mass=progress.get(task);if(mass)return mass;
          mass=zeroMass();
          for(const world of this.beliefs[task.belief]!.worlds){
            const law=this.executions[world.execution]!.edges.get(task.action);
            if(law)mass=addMass(mass,multiplyMass(world.mass,law.complete?unitMass():law.expansion!.delivered));
          }
          progress.set(task,mass);return mass;
        };
        // Public priorities cannot change while the task set is unchanged.
        // Reuse its maximal subsequence, but read current delivered masses on
        // every step: another belief can advance a shared execution's law.
        const candidates=this.highestPriorityTasks();let best=candidates[0];
        if(best){
          for(let index=1;index<candidates.length;index++){
            const task=candidates[index]!,order=compareMass(delivered(task),delivered(best));
            if(order>0||order===0&&task.belief===this.preferred?.belief&&task.action===this.preferred.action)best=task;
          }
          taskIndex=this.queue.indexOf(best);

        }
      }
    }
    const task=this.queue[taskIndex];if(!task)return false;
    const localBurst=this.queue.length<32?0n:31n;
    const node=this.beliefs[task.belief]!,edge=node.edges.get(task.action)!;
    const world=node.worlds[edge.nextWorld]!;
    this.advanceExecution(world.execution,task.action);
    edge.nextWorld=(edge.nextWorld+1)%node.worlds.length;
    if(node.worlds.every(row=>this.executions[row.execution]!.edges.get(task.action)?.complete))this.publish(task.belief,edge);
    // Recompute in graph order: every incoming path must see shared evidence,
    // and the discovery parent is no longer the only dependency of a belief.
    this.backup();
    this.steps++;
    this.queue.splice(taskIndex,1);if(!edge.published)this.queue.push(task);
    if(this.priorityTasks){
      const index=this.priorityTasks.indexOf(task);
      if(index>=0){this.priorityTasks.splice(index,1);if(!edge.published)this.priorityTasks.push(task);}
    }
    if(this.rootTasks){
      const group=this.rootTasks.owners.get(task);
      if(group){const index=group.indexOf(task);
        group.splice(index,1);if(!edge.published)group.push(task);else this.rootTasks.owners.delete(task);}
    }
    if(rootNext!==null)this.rootCursor=rootNext;
    this.preferred=edge.published?edge.outcomes.flatMap(row=>{
      const child=this.beliefs[row.belief]!;
      return [...child.edges.values()].filter(action=>!action.published&&action.dominatedBy===null).map(action=>({belief:row.belief,action:action.action}));
    }).find(next=>this.queue.some(task=>task.belief===next.belief&&task.action===next.action))??null:task;
    this.localRemaining=local?this.localRemaining-1n:localBurst;
    this.preferCycle=true;return true;
  }
  /** A local decision view, independent of the exact terminal certificate.
   * This reads existing public projections only and never consumes a chance
   * coordinate, resumes an old root, or changes the retained frontier. */
  localEvidence(evaluate:(position:ExactPosition)=>number,excludedRootActions:ReadonlySet<string>=new Set()){

    const result=evaluateLocalGraph(this.root,id=>{
      const node=this.beliefs[id]!;
      return{position:node.position,edges:[...node.edges.values()].map(edge=>({key:edge.action,published:edge.published,outcomes:edge.outcomes,
        pending:edge.published?[]:node.worlds.flatMap(world=>(this.executions[world.execution]!.edges.get(edge.action)?.expansion?.localFrontier?.()??[])
          .map(row=>({utility:row.utility,mass:multiplyMass(world.mass,row.mass)}))),
        leaves:edge.published?[]:node.worlds.flatMap(world=>(this.executions[world.execution]!.edges.get(edge.action)?.outcomes??[]).flatMap(row=>{
          const position=this.executions[row.execution]!.position;
          return position?[{position,mass:multiplyMass(world.mass,row.mass)}]:[];
        }))}))};
    },evaluate,excludedRootActions);
    return{...structuredClone(result),steps:this.steps,executions:this.executions.length,beliefs:this.beliefs.length,pendingEdges:this.queue.length+this.dormant.length};
  }
  evidence(){
    this.settleSchedule();const node=this.beliefs[this.root]!,rows=[...node.edges.values()];
    // A pure stuttering action may tie the optimal value only because a later
    // decision could exit. Repeatedly selecting that tie would never realize it.
    const productive=rows.filter(edge=>!edge.published||compareMass(this.selfMass(this.root,edge),unitMass())<0);
    const members=this.components()[this.componentOf[this.root]!]!,cyclic=members.length>1,witness=this.cycleChoices.get(this.root);
    const exactCycle=cyclic&&members.every(id=>this.solvedCycleNodes.has(id)&&compareBound(this.beliefs[id]!.score.lower,this.beliefs[id]!.score.upper)===0);
    const candidates=cyclic?(exactCycle&&witness&&witness.mass.numerator>0n?productive.filter(edge=>edge.action===witness.action):[]):productive;
    const pendingCycles=this.runnableCycles().filter(key=>!this.cycles.get(key)!.complete).length;
    // A first-action bound is not a completed combat strategy. Unproved
    // recurrent histories can keep promising the same exit one step later,
    // even with exact equal bounds. Finish the reachable nondominated graph
    // and its cycle certificates before publishing a decision. Strictly
    // dominated work remains retained and need not be expanded.
    const certified=this.queue.length===0&&pendingCycles===0?candidates.find(candidate=>rows.every(other=>other===candidate||compareBound(cyclic?witness!.lower:candidate.score.lower,other.score.upper)>=0)):undefined;
    return{status:certified?'proven-action' as const:node.position.terminal?'terminal' as const:'incomplete' as const,
      action:certified?structuredClone(node.position.actions.find(action=>action.key===certified.action)!):null,
      score:structuredClone(node.score),steps:this.steps,executions:this.executions.length,beliefs:this.beliefs.length,pendingEdges:this.queue.length+this.dormant.length,
      runnableEdges:this.queue.length,equivalentExecutions:this.mergedExecutions,closedNonterminalLoop:cyclic?this.solvedCycleNodes.has(this.root)&&witness?.mass.numerator===0n:rows.length>0&&productive.length===0,
      pendingCycles,
      cyclePoliciesEvaluated:this.activeCycles.reduce((count,key)=>count+this.cycles.get(key)!.evaluated,0),
      cyclePoliciesTotal:this.activeCycles.reduce((count,key)=>count+this.cycles.get(key)!.total,0n),
      cycleWitness:witness?{action:witness.action,policy:witness.policy,exitMass:structuredClone(witness.mass),exitSteps:structuredClone(witness.steps)}:null,
      actions:rows.map(edge=>({key:edge.action,distributionComplete:edge.published,score:structuredClone(edge.score),dominatedBy:edge.dominatedBy}))};
  }
  save():SearchSessionSnapshot<S,E>{
    if(this.scheduleMode==='local')this.settleLocalSchedule();else this.settleSchedule();return{version:1,root:this.root,upper:structuredClone(this.domain.upper),steps:this.steps,schedule:{...(this.scheduleMode==='local'?{mode:'local' as const}:{}),...(this.localGroupCursor?{localGroupCursor:this.localGroupCursor}:{}),localRemaining:this.localRemaining,rootCursor:this.rootCursor,preferred:this.preferred?{...this.preferred}:null,prepared:this.preparedPreferred?{...this.preparedPreferred}:null},cycles:[...this.cycles.values()].map(search=>search.save()),cycleCursor:this.cycleCursor,preferCycle:this.preferCycle,
      executions:this.executions.map((node,index)=>({current:this.domain.save(node.current),identified:node.representative!==null,equivalentTo:node.representative!==null&&node.representative!==index?node.representative:null,
        edges:node.representative!==null&&node.representative!==index?[]:[...node.edges].map(([action,edge])=>({action,complete:edge.complete,outcomes:structuredClone(edge.outcomes),expansion:edge.expansion?.save()??null}))})),
      beliefs:this.beliefs.map(node=>({worlds:structuredClone(node.worlds),parent:node.parent,edges:[...node.edges.values()].map(edge=>({action:edge.action,nextWorld:edge.nextWorld,published:edge.published,outcomes:structuredClone(edge.outcomes)}))})),queue:structuredClone([...this.queue,...this.dormant])};
  }
  static restore<C,S,E>(domain:ExactDomain<C,S,E>,saved:SearchSessionSnapshot<S,E>,mode?:'local'):SearchSession<C,S,E>{
    const result=new SearchSession(domain);result.root=saved.root;
    try{
      // Restore owned data and derived indexes directly. The producer owns
      // snapshot correctness; loading never revalidates or executes its edges.
      for(const row of saved.executions)result.retain(domain.restore(row.current));
      for(let i=0;i<saved.executions.length;i++){
        const row=saved.executions[i]!,node=result.executions[i]!,position=result.position(i),representative=row.equivalentTo??i;
        if(row.identified===false)continue;
        if(representative!==i){node.edges=result.executions[representative]!.edges;result.mergedExecutions++;}
        else{
          const bucket=result.equivalenceBuckets.get(position.information)??[];bucket.push(i);result.equivalenceBuckets.set(position.information,bucket);
        }
        node.representative=representative;
      }
      result.identify(0);
      for(let i=0;i<saved.executions.length;i++){
        const node=result.executions[i]!;
        for(const row of saved.executions[i]!.edges){
          const distribution:Distribution<C,E>={complete:row.complete,outcomes:structuredClone(row.outcomes),
            expansion:row.expansion===null?null:domain.restoreExpansion(row.expansion),
            projected:0,terminalMass:zeroMass(),terminalValue:zero(domain.upper.length),nonterminal:new Map()};
          node.edges.set(row.action,distribution);result.projectDistribution(distribution,i,row.action);
        }
      }
      for(let i=0;i<saved.beliefs.length;i++){
        const row=saved.beliefs[i]!,position=result.position(row.worlds[0]!.execution);
        const node:Belief={position,worlds:structuredClone(row.worlds),parent:row.parent,
          edges:new Map(row.edges.map(edge=>[edge.action,{...structuredClone(edge),score:result.unknown(),dominatedBy:null}])),
          score:position.terminal?{lower:position.terminal,upper:position.terminal}:result.unknown()};
        result.beliefs.push(node);result.registerBelief(i);
      }
      result.queue=structuredClone(saved.queue);result.steps=saved.steps;
      if(saved.schedule!==undefined){
        result.scheduleMode=saved.schedule.mode??'exact';result.localRemaining=saved.schedule.localRemaining;
        result.localGroupCursor=saved.schedule.localGroupCursor??0n;result.rootCursor=saved.schedule.rootCursor??0n;
        result.preferred=saved.schedule.preferred===null?null:{...saved.schedule.preferred};
        result.preparedPreferred=saved.schedule.prepared?{...saved.schedule.prepared}:null;
      }
      for(const search of saved.cycles??[]){
        const graph=result.cycleGraph(search.graph.map(state=>state.belief));
        result.cycles.set(result.cycleKey(graph),CycleSearch.restore(graph,search));
      }
      result.cycleCursor=saved.cycleCursor??0n;result.preferCycle=saved.preferCycle??false;
      if(mode)result.scheduleMode=mode;
      if(result.scheduleMode==='exact')result.backup();result.schedulingDirty=true;
      return result;
    }catch(error){result.close();throw error;}
  }
  close(){
    if(this.closed)return;this.closed=true;const errors:unknown[]=[];
    for(let i=0;i<this.executions.length;i++){
      const node=this.executions[i]!;
      if(node.representative===null||node.representative===i)for(const edge of node.edges.values())try{edge.expansion?.close();}catch(error){errors.push(error);}
      try{this.domain.close(node.current);}catch(error){errors.push(error);}
    }
    this.executions=[];this.incomingExecution.clear();this.terminalExecutions.clear();this.policyWitnesses.clear();this.preparedUpperCache.clear();this.constrainedExecutions.clear();this.incomingNonterminal.clear();this.constrainedLaws=new WeakSet();this.boundedLaws=new WeakSet();this.distributionOwners=new WeakMap();this.constraintWork.clear();this.equivalenceBuckets.clear();this.beliefIndex.clear();this.publishedExecutions.clear();this.graphComponents=[];this.cycles.clear();this.activeCycles=[];this.cycleChoices.clear();this.beliefs=[];this.queue=[];this.priorityTasks=null;this.rootTasks=null;this.dormant=[];
    if(errors.length)throw new AggregateError(errors,'Failed to release retained search contexts');
  }
}
