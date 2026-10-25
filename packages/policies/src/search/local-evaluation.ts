import {addMass,compareMass,multiplyMass,numericMass,subtractMass,unitMass,zeroMass,type ProbabilityMass} from '../../../card-engine/src/probability-mass.ts';
import type {ExactPosition} from './session.types.ts';

/** Read-only projection of retained work. Partial laws deliberately expose
 * public leaves, not per-hidden-world continuation decisions. */
export type LocalEdge={key:string;published:boolean;outcomes:{belief:number;mass:ProbabilityMass}[];
  leaves:{position:ExactPosition;mass:ProbabilityMass}[];pending?:{utility:number;mass:ProbabilityMass}[]};
export type LocalNode={position:ExactPosition;edges:LocalEdge[]};
type Value={lower:ProbabilityMass;upper:ProbabilityMass;estimate:ProbabilityMass;unresolved:ProbabilityMass;
  frontier:ProbabilityMass;terminal:ProbabilityMass;minimumTerminal:ProbabilityMass;cycle:ProbabilityMass};
const empty=():Value=>({lower:zeroMass(),upper:zeroMass(),estimate:zeroMass(),unresolved:zeroMass(),frontier:zeroMass(),terminal:zeroMass(),minimumTerminal:zeroMass(),cycle:zeroMass()});
const sum=(left:Value,right:Value,mass:ProbabilityMass):Value=>Object.fromEntries(Object.entries(left).map(([key,value])=>[key,addMass(value,multiplyMass(right[key as keyof Value],mass))])) as Value;
type LocalAction=Value&{key:string;distributionComplete:boolean;stuttering:boolean;immediateEstimate:ProbabilityMass;observedSuccessorMass:ProbabilityMass;tiePreference:number};
const preferable=(left:LocalAction,right:LocalAction)=>{
  // A fully observed minimum terminal cannot beat a still viable local plan.
  // This is selection among retained plans, never deletion of a probability law.
  const fatalLeft=compareMass(left.minimumTerminal,unitMass())===0,fatalRight=compareMass(right.minimumTerminal,unitMass())===0;
  if(fatalLeft!==fatalRight)return !fatalLeft;
  // Unknown probability is not an observed zero utility. Compare the explicit
  // public-board prior estimate, with a separate penalty for confirmed death.
  // Cross-addition compares estimate - death without signed probability mass.
  const value=compareMass(addMass(left.estimate,right.minimumTerminal),addMass(right.estimate,left.minimumTerminal));if(value)return value>0;
  const loss=compareMass(left.minimumTerminal,right.minimumTerminal);if(loss)return loss<0;
  const cycle=compareMass(left.cycle,right.cycle);if(cycle)return cycle<0;
  // Equal lookahead plans prefer value already realized by the next original
  // successor, rather than spending another action before reaching it. This
  // only breaks exact utility/risk ties; a better setup line still wins.
  const immediate=compareMass(left.immediateEstimate,right.immediateEstimate);if(immediate)return immediate>0;
  const upper=compareMass(left.upper,right.upper);if(upper)return upper>0;
  return left.tiePreference>right.tiePreference;
};

/** Finite retained graph evaluation, without executing an edge or declaring a
 * horizon terminal. Scores are bounded heuristic utilities, NOT true-return
 * bounds. Missing probability keeps [0,1] and its exact original mass. */
export function evaluateLocalGraph(root:number,read:(id:number)=>LocalNode,evaluate:(position:ExactPosition)=>number,excludedRootActions:ReadonlySet<string>=new Set()){
  const leaf=(position:ExactPosition,cycle=false):Value=>{
    const score=evaluate(position);

    const value=numericMass(score),terminal=position.terminal!==null;
    return{lower:value,upper:value,estimate:value,unresolved:zeroMass(),frontier:terminal?zeroMass():unitMass(),terminal:terminal?unitMass():zeroMass(),
      minimumTerminal:terminal&&score===0?unitMass():zeroMass(),cycle:cycle?unitMass():zeroMass()};
  };
  const unknown=(mass:ProbabilityMass,prior:ProbabilityMass):Value=>({...empty(),upper:mass,estimate:multiplyMass(mass,prior),unresolved:mass});
  const nodes=new Map<number,LocalNode>(),values=new Map<number,Value>(),choices=new Map<string,string>(),rows=new Map<number,LocalAction[]>();
  const node=(id:number)=>{let value=nodes.get(id);if(!value){value=read(id);nodes.set(id,value);}return value;};
  const rootInformation=node(root).position.information;
  let rootCandidate:string|undefined,hasPrefixPrior=false;
  const allowed=(position:ExactPosition,key:string)=>!position.localExclusions?.some(row=>row.key===key)&&
    !(position.information===rootInformation&&excludedRootActions.has(key));
  type Frame={id:number;children:number[];cursor:number};
  const active=new Set<number>(),stack:Frame[]=[];
  const push=(id:number)=>{const current=node(id);active.add(id);stack.push({id,children:current.edges.filter(edge=>edge.published&&allowed(current.position,edge.key)).flatMap(edge=>edge.outcomes.map(row=>row.belief)),cursor:0});};
  push(root);
  while(stack.length){
    const frame=stack[stack.length-1]!,current=node(frame.id);
    if(frame.cursor<frame.children.length){const child=frame.children[frame.cursor++]!;if(!values.has(child)&&!active.has(child))push(child);continue;}
    const prior=leaf(current.position).estimate;
    const actions=current.edges.map(edge=>{
      let value=empty(),known=zeroMass(),immediateEstimate=zeroMass();
      if(edge.published){
        for(const row of edge.outcomes){
          const direct=leaf(node(row.belief).position,!values.has(row.belief));
          value=sum(value,values.get(row.belief)??direct,row.mass);known=addMass(known,row.mass);
          immediateEstimate=addMass(immediateEstimate,multiplyMass(direct.estimate,row.mass));
        }
      }else{
        // No max over hidden outcomes: each gets only its PUBLIC board score.
        for(const row of edge.leaves){const direct=leaf(row.position);value=sum(value,direct,row.mass);known=addMass(known,row.mass);
          immediateEstimate=addMass(immediateEstimate,multiplyMass(direct.estimate,row.mass));}
      }

      // The unobserved tail retains its full mass and [0,1] interval. Its
      // decision-only prior comes from retained PUBLIC prefixes or the source
      // board, never normalized samples or a best hidden-world continuation.
      const remaining=subtractMass(unitMass(),known);
      let prefixMass=zeroMass(),prefixEstimate=zeroMass();
      for(const row of edge.pending??[]){
        prefixMass=addMass(prefixMass,row.mass);
        prefixEstimate=addMass(prefixEstimate,multiplyMass(row.mass,numericMass(row.utility)));hasPrefixPrior=true;
      }
      // Unfinished originals may already have changed the public board before
      // their next draw. Weight those actual prefixes, never normalize observed
      // leaves or replace a tail by a hidden-world optimal continuation.
      const tail=unknown(remaining,prior);
      tail.estimate=addMass(prefixEstimate,multiplyMass(subtractMass(remaining,prefixMass),prior));
      value=sum(value,tail,unitMass());
      immediateEstimate=addMass(immediateEstimate,tail.estimate);
      return{immediateEstimate,observedSuccessorMass:known,tiePreference:current.position.localTiePreferences?.[edge.key]??0,key:edge.key,distributionComplete:edge.published,stuttering:edge.published&&edge.outcomes.every(row=>row.belief===frame.id),...value};
    });
    rows.set(frame.id,actions);
    // An explicit root heuristic applies to every occurrence of the same
    // public information, never separately to hidden posterior worlds. Rows
    // and probability laws remain present in the returned evidence and graph.
    const eligible=actions.filter(action=>allowed(current.position,action.key));
    // One action per information key throughout this evaluation. A later
    // occurrence cannot pick another action based on its hidden posterior.
    const fixed=choices.get(current.position.information);
    let best=fixed===undefined?undefined:eligible.find(action=>action.key===fixed);

    const productive=eligible.some(action=>!action.stuttering)?eligible.filter(action=>!action.stuttering):eligible;
    if(!best)for(const action of productive)if(!best||preferable(action,best))best=action;
    if(frame.id===root&&fixed===undefined){
      // An anytime decision need not chase a more optimistic but wholly
      // unseen source-board prior after its work slice. Select among reached
      // successors, retaining every unopened law in the evidence/frontier.
      // Do not turn a short slice into forced suicide when only a known fatal
      // action has been observed and another candidate remains unexplored.
      const observed=productive.filter(action=>action.observedSuccessorMass.numerator>0n&&compareMass(action.minimumTerminal,unitMass())<0);
      if(observed.length){best=observed[0];for(const action of observed)if(preferable(action,best!))best=action;}
    }
    if(frame.id===root)rootCandidate=best?.key;
    const observed=eligible.some(action=>compareMass(action.unresolved,unitMass())<0);
    if(best&&(observed||fixed!==undefined)){
      choices.set(current.position.information,best.key);
      // Unknown mass already carries this node's public-board prior. Once
      // original successors reveal a loss, propagate it instead of replacing
      // the continuation by the better score before that loss. Otherwise an
      // extra resource-consuming action can falsely postpone an inevitable cost.
      values.set(frame.id,best);
    }
    else values.set(frame.id,leaf(current.position));
    active.delete(frame.id);stack.pop();
  }
  const actions=rows.get(root)!,selected=choices.get(node(root).position.information)??rootCandidate;
  // A source-board prior can order work, but supplies no evidence about an
  // action that has never reached a successor. Request that original edge
  // next. This is a decision prerequisite, not deletion or renormalization of
  // its unknown support. Descendant uncertainty remains separately visible.
  const ready=selected!==undefined&&actions.find(row=>row.key===selected)!.observedSuccessorMass.numerator>0n;
  return{action:ready?node(root).position.actions.find(action=>action.key===selected)??null:null,
    pendingAction:ready?null:selected??null,
    actions,excludedRootActions:[...new Set([...excludedRootActions,...(node(root).position.localExclusions??[]).map(row=>row.key)])],
    heuristicExclusions:structuredClone(node(root).position.localExclusions??[]),informationDecisions:choices.size,method:'public-prior-local-utility' as const,
    unknownPrior:hasPrefixPrior?'retained-public-prefix-or-source' as const:'source-public-board' as const,confirmedDeathPenalty:1,searchComplete:false as const};
}
