import type {PreparedOrdering,ResolvedOrder,RuleOrder,RuleOrdering,RulePhase} from './rules-order.types.ts';
const flat:PreparedOrdering=Object.freeze({phases:Object.freeze([]),edges:Object.freeze([]),default:0});
export function prepareOrdering(spec?:RuleOrdering):PreparedOrdering{
  if(spec===undefined)return flat;
  if(!spec||!Array.isArray(spec.phases)||spec.phases.length===0)throw Error('Rule ordering requires a finite phase list');
  const phases=spec.phases.map(item=>item.phase);
  if(phases.some(phase=>!phase||typeof phase!=='object'||Array.isArray(phase))||new Set(phases).size!==phases.length)throw Error('Rule ordering has invalid or duplicate phases');
  if(!phases.includes(spec.default))throw Error('Rule ordering default phase is undeclared');
  const edges:[number,number][]=[],successors=phases.map(()=>new Set<number>()),indegree=phases.map(()=>0);
  const edge=(from:RulePhase,to:RulePhase)=>{
    const a=phases.indexOf(from),b=phases.indexOf(to);if(a<0||b<0)throw Error('Rule ordering references an undeclared phase');
    if(!successors[a]!.has(b)){successors[a]!.add(b);indegree[b]=indegree[b]!+1;edges.push([a,b]);}
  };
  for(const item of spec.phases){for(const before of item.before??[])edge(item.phase,before);for(const after of item.after??[])edge(after,item.phase);}
  // Declaration order, which belongs to the target's static contract, breaks unconstrained ties.
  const ordered:number[]=[];
  while(ordered.length<phases.length){
    const next=indegree.findIndex((count,index)=>count===0&&!ordered.includes(index));if(next<0)throw Error('Cyclic rule phase ordering');
    ordered.push(next);for(const successor of successors[next]!)indegree[successor]=indegree[successor]!-1;
  }
  return Object.freeze({phases:Object.freeze(ordered.map(index=>phases[index]!)),edges:Object.freeze(edges.map(([a,b])=>Object.freeze([ordered.indexOf(a),ordered.indexOf(b)] as const))),default:ordered.indexOf(phases.indexOf(spec.default))});
}
export function resolveOrder(ordering:PreparedOrdering,requested:RuleOrder=0):ResolvedOrder{
  if(typeof requested==='number'){
    if(!Number.isSafeInteger(requested))throw Error('Rule order must be an integer');return{phase:ordering.default,order:requested};
  }
  if(!requested||typeof requested!=='object')throw Error('Invalid rule phase reference');
  const phase='phase' in requested?requested.phase:requested,priority='phase' in requested?requested.priority??0:0;
  if(!Number.isSafeInteger(priority))throw Error('Rule order must be an integer');
  const index=ordering.phases.indexOf(phase);if(index<0)throw Error('Rule order uses an undeclared phase');return{phase:index,order:priority};
}
export function compareOrder(a:ResolvedOrder,b:ResolvedOrder):number{return a.phase-b.phase||a.order-b.order;}
