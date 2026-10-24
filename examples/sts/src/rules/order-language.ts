import {sampleUniformCoordinate,type ProbabilityEntropy} from '../../../../packages/card-engine/src/probability.ts';

/** A weighted acyclic language of group labels. A path is the current sequence
 * of exchangeable groups, not a history of operations. Terminal mass and edge
 * masses permit exact marginalization without enumerating card permutations. */
export type OrderLanguage={root:number;nodes:{end:number;edges:{group:number;to:number;weight:number}[]}[]};
export type ReadonlyOrderLanguage={readonly root:number;readonly nodes:readonly {readonly end:number;readonly edges:readonly {readonly group:number;readonly to:number;readonly weight:number}[]}[]};
class Builder{
  nodes:OrderLanguage['nodes']=[];
  private intern=new Map<string,number>();
  node(end:number,edges:OrderLanguage['nodes'][number]['edges']):number{
    const merged=new Map<string,{group:number;to:number;weight:number}>();
    for(const edge of edges){if(edge.weight===0)continue;const key=edge.group+':'+edge.to,old=merged.get(key);if(old)old.weight+=edge.weight;else merged.set(key,{...edge});}
    const sorted=[...merged.values()].sort((a,b)=>a.group-b.group||a.to-b.to),key=JSON.stringify([end,sorted]);
    const old=this.intern.get(key);if(old!==undefined)return old;const id=this.nodes.length;this.nodes.push({end,edges:sorted});this.intern.set(key,id);return id;
  }
  union(choices:{node:number;weight:number}[]):number{
    let end=0;const edges:OrderLanguage['nodes'][number]['edges']=[];
    for(const choice of choices){const n=this.nodes[choice.node]!;end+=choice.weight*n.end;for(const edge of n.edges)edges.push({...edge,weight:edge.weight*choice.weight});}
    return this.node(end,edges);
  }
  importer(language:ReadonlyOrderLanguage){const memo=new Map<number,number>();const visit=(id:number):number=>{const old=memo.get(id);if(old!==undefined)return old;const n=language.nodes[id]!,next=this.node(n.end,n.edges.map(e=>({...e,to:visit(e.to)})));memo.set(id,next);return next;};return visit;}
  finish(root:number):OrderLanguage{
    const source={root,nodes:this.nodes},masses=languageMasses(source),total=masses[root]!;
    if(!(total>0))return{root:0,nodes:[{end:0,edges:[]}]};
    const nodes:OrderLanguage['nodes']=[],memo=new Map<number,number>();
    const visit=(id:number):number=>{const old=memo.get(id);if(old!==undefined)return old;const n=this.nodes[id]!,edges=n.edges.filter(e=>e.weight*masses[e.to]!>0).map(e=>({...e,to:visit(e.to)})),next=nodes.length;nodes.push({end:n.end,edges});memo.set(id,next);return next;};
    const next=visit(root),node=nodes[next]!;nodes[next]={end:node.end/total,edges:node.edges.map(e=>({...e,weight:e.weight/total}))};return{root:next,nodes};
  }
}
export function blockLanguage(blocks:readonly (readonly number[])[]):OrderLanguage{
  const b=new Builder();let root=b.node(1,[]);
  for(let group=blocks.length-1;group>=0;group--)for(let i=0;i<blocks[group]!.length;i++)root=b.node(0,[{group,to:root,weight:1}]);
  return b.finish(root);
}
export function insertLanguage(language:ReadonlyOrderLanguage,group:number,index:number):OrderLanguage{
  const b=new Builder(),copy=b.importer(language),memo=new Map<string,number>();
  function visit(id:number,at:number):number{
    const key=id+':'+at,old=memo.get(key);if(old!==undefined)return old;
    const n=language.nodes[id]!;
    const next=at===0?b.node(0,[{group,to:copy(id),weight:1}]):b.node(0,n.edges.map(e=>({...e,to:visit(e.to,at-1)})));
    if(at>0&&n.end>0)throw Error('Order insertion exceeds current length');memo.set(key,next);return next;
  }
  return b.finish(visit(language.root,index));
}
export function insertRandomLanguage(language:ReadonlyOrderLanguage,group:number,length:number):OrderLanguage{
  const b=new Builder(),choices=[];
  for(let index=0;index<=length;index++){const next=insertLanguage(language,group,index);choices.push({node:b.importer(next)(next.root),weight:1/(length+1)});}
  return b.finish(b.union(choices));
}
/** Remove one specified member of an exchangeable group. Each occurrence was
 * equally likely to hold that member, so its position is marginalized. */
export function removeLanguage(language:ReadonlyOrderLanguage,group:number,count:number):OrderLanguage{
  if(count<1)throw Error('Missing removable order member');
  const b=new Builder(),copy=b.importer(language),memo=new Map<number,number>();
  function visit(id:number):number{
    const old=memo.get(id);if(old!==undefined)return old;const n=language.nodes[id]!;
    const choices=n.edges.flatMap(e=>[
      {node:b.node(0,[{...e,to:visit(e.to)}]),weight:1},
      ...(e.group===group?[{node:copy(e.to),weight:e.weight/count}]:[]),
    ]),next=b.union(choices);memo.set(id,next);return next;
  }
  return b.finish(visit(language.root));
}
/** Condition on disclosed positions, replacing their old group labels with
 * singleton groups. Within-group identity likelihood is constant over all
 * retained paths; normalization is deferred to mass evaluation. */
export function observeLanguage(language:ReadonlyOrderLanguage,positions:ReadonlyMap<number,{from:number;to:number}>):OrderLanguage{
  const b=new Builder(),memo=new Map<string,number>();
  function visit(id:number,at:number):number{
    const key=id+':'+at,old=memo.get(key);if(old!==undefined)return old;const n=language.nodes[id]!,known=positions.get(at);
    const next=b.node(n.end,n.edges.filter(e=>!known||e.group===known.from).map(e=>({...e,group:known?.to??e.group,to:visit(e.to,at+1)})));
    memo.set(key,next);return next;
  }
  return b.finish(visit(language.root,0));
}
export function languageMasses(language:ReadonlyOrderLanguage):number[]{
  const masses:number[]=[];
  function mass(id:number):number{if(masses[id]!==undefined)return masses[id]!;const n=language.nodes[id]!;return masses[id]=n.end+n.edges.reduce((sum,e)=>sum+e.weight*mass(e.to),0);}
  mass(language.root);return masses;
}
/** Exact marginal of the last group in the current weighted sequence. No
 * full permutation or representative path is sampled to compute these masses. */
export function lastGroupMasses(language:ReadonlyOrderLanguage):Map<number,number>{
  const memo=new Map<number,Map<number,number>>();
  function visit(id:number):Map<number,number>{
    const old=memo.get(id);if(old)return old;
    const result=new Map<number,number>(),node=language.nodes[id]!;
    for(const edge of node.edges){
      const terminal=language.nodes[edge.to]!.end;
      if(terminal>0)result.set(edge.group,(result.get(edge.group)??0)+edge.weight*terminal);
      for(const [group,mass] of visit(edge.to))result.set(group,(result.get(group)??0)+edge.weight*mass);
    }
    memo.set(id,result);return result;
  }
  const mass=languageMasses(language)[language.root]!;
  if(!(mass>0))throw Error('Impossible observed order');
  return new Map([...visit(language.root)].filter(([,p])=>p>0).map(([group,p])=>[group,p/mass]));
}

export function sampleLanguage(language:ReadonlyOrderLanguage,blocks:readonly (readonly number[])[],source:ProbabilityEntropy):number[]{
  const masses=languageMasses(language);if(!(masses[language.root]!>0))throw Error('Impossible observed order');
  const remaining=blocks.map(block=>[...block]),result:number[]=[];let id=language.root;
  for(;;){
    source.check();const node=language.nodes[id]!,mass=masses[id]!;
    if(node.end>0){if(node.edges.some(e=>e.weight*masses[e.to]!>0))throw Error('Mixed order lengths');break;}
    const edges=node.edges.filter(e=>e.weight*masses[e.to]!>0);let edge=edges[0]!;
    if(edges.length>1){
      const unit=Number(sampleUniformCoordinate(1n<<53n,source))/2**53;let sum=0;
      for(const candidate of edges){edge=candidate;sum+=candidate.weight*masses[candidate.to]!/mass;if(unit<sum)break;}
    }
    const members=remaining[edge.group]!,at=Number(sampleUniformCoordinate(BigInt(members.length),source));result.push(members.splice(at,1)[0]!);id=edge.to;
  }
  if(remaining.some(group=>group.length))throw Error('Incomplete order language');return result;
}

/** Canonical group and node identities keep a fixed entropy cursor independent
 * of graph allocation order or the hidden insertion position later forgotten. */
export function canonicalLanguage(language:ReadonlyOrderLanguage,groups:ReadonlyMap<number,number>):OrderLanguage{
  const masses=languageMasses(language),heights=new Map<number,number>(),levels=new Map<number,number[]>();
  function height(id:number):number{const old=heights.get(id);if(old!==undefined)return old;const n=language.nodes[id]!,h=n.edges.reduce((best,e)=>e.weight*masses[e.to]!>0?Math.max(best,1+height(e.to)):best,0);heights.set(id,h);const level=levels.get(h)??[];level.push(id);levels.set(h,level);return h;}
  height(language.root);const nodes:OrderLanguage['nodes']=[],mapped=new Map<number,number>();
  for(const level of [...levels.keys()].sort((a,b)=>a-b)){
    const forms=levels.get(level)!.map(id=>{const node=language.nodes[id]!,mass=masses[id]!,edges=new Map<string,{group:number;to:number;weight:number}>();
      for(const edge of node.edges){if(!(edge.weight*masses[edge.to]!>0))continue;const group=groups.get(edge.group);if(group===undefined)throw Error('Missing order group');const to=mapped.get(edge.to)!,weight=edge.weight*masses[edge.to]!/mass,key=group+':'+to,prior=edges.get(key);if(prior)prior.weight+=weight;else edges.set(key,{group,to,weight});}
      const value={end:node.end/mass,edges:[...edges.values()].sort((a,b)=>a.group-b.group||a.to-b.to)};return{id,value,key:JSON.stringify(value)};
    }).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
    let previous='',index=-1;for(const form of forms){if(form.key!==previous){index=nodes.length;nodes.push(form.value);previous=form.key;}mapped.set(form.id,index);}
  }
  return{root:mapped.get(language.root)!,nodes};
}

/** Refine exchangeable groups by a supplied predicate and condition on the
 * observed last matching member. Category choices are without replacement;
 * the original within-group permutations supply their hypergeometric mass. */
export function lastMatchLanguage(language:ReadonlyOrderLanguage,parts:readonly (readonly number[])[],sizes:readonly number[],selected:number,matching:ReadonlySet<number>):OrderLanguage{
  const b=new Builder(),memo=new Map<string,number>();
  function visit(id:number,remaining:readonly number[],seen:boolean):number{
    const key=id+':'+Number(seen)+':'+remaining.join(','),old=memo.get(key);if(old!==undefined)return old;
    const node=language.nodes[id]!,edges:OrderLanguage['nodes'][number]['edges']=[];
    for(const edge of node.edges){
      const candidates=parts[edge.group]!,total=candidates.reduce((sum,group)=>sum+remaining[group]!,0);
      if(!total)continue;
      for(const group of candidates){
        const count=remaining[group]!;if(!count||seen&&matching.has(group))continue;
        const next=[...remaining];next[group]=count-1;
        edges.push({group,to:visit(edge.to,next,seen||group===selected),weight:edge.weight*count/total});
      }
    }
    const next=b.node(seen?node.end:0,edges);memo.set(key,next);return next;
  }
  return b.finish(visit(language.root,sizes,false));
}
