import {addMass,multiplyMass,divideMass,probabilityMass,unitMass,zeroMass,type ProbabilityMass} from '../../../../packages/card-engine/src/probability-mass.ts';
const positive=(mass:ProbabilityMass)=>mass.numerator>0n;
const keyOf=(value:unknown)=>JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item);

/** A weighted acyclic language of group labels. A path is the current sequence
 * of exchangeable groups, not a history of operations. Terminal mass and edge
 * masses permit exact marginalization without enumerating card permutations. */
export type OrderLanguage={root:number;nodes:{end:ProbabilityMass;edges:{group:number;to:number;weight:ProbabilityMass}[]}[]};
export type ReadonlyOrderLanguage={readonly root:number;readonly nodes:readonly {readonly end:ProbabilityMass;readonly edges:readonly {readonly group:number;readonly to:number;readonly weight:ProbabilityMass}[]}[]};
class Builder{
  nodes:OrderLanguage['nodes']=[];
  private intern=new Map<string,number>();
  node(end:ProbabilityMass,edges:OrderLanguage['nodes'][number]['edges']):number{
    const merged=new Map<string,{group:number;to:number;weight:ProbabilityMass}>();
    for(const edge of edges){if(!positive(edge.weight))continue;const key=edge.group+':'+edge.to,old=merged.get(key);if(old)old.weight=addMass(old.weight,edge.weight);else merged.set(key,{...edge});}
    const sorted=[...merged.values()].sort((a,b)=>a.group-b.group||a.to-b.to),key=keyOf([end,sorted]);
    const old=this.intern.get(key);if(old!==undefined)return old;const id=this.nodes.length;this.nodes.push({end,edges:sorted});this.intern.set(key,id);return id;
  }
  union(choices:{node:number;weight:ProbabilityMass}[]):number{
    let end=zeroMass();const edges:OrderLanguage['nodes'][number]['edges']=[];
    for(const choice of choices){const n=this.nodes[choice.node]!;end=addMass(end,multiplyMass(choice.weight,n.end));for(const edge of n.edges)edges.push({...edge,weight:multiplyMass(edge.weight,choice.weight)});}
    return this.node(end,edges);
  }
  importer(language:ReadonlyOrderLanguage){const memo=new Map<number,number>();const visit=(id:number):number=>{const old=memo.get(id);if(old!==undefined)return old;const n=language.nodes[id]!,next=this.node(n.end,n.edges.map(e=>({...e,to:visit(e.to)})));memo.set(id,next);return next;};return visit;}
  finish(root:number):OrderLanguage{
    const source={root,nodes:this.nodes},masses=languageMasses(source),total=masses[root]!;
    if(!positive(total))return{root:0,nodes:[{end:zeroMass(),edges:[]}]};
    const nodes:OrderLanguage['nodes']=[],memo=new Map<number,number>();
    const visit=(id:number):number=>{const old=memo.get(id);if(old!==undefined)return old;const n=this.nodes[id]!,edges=n.edges.filter(e=>positive(e.weight)&&positive(masses[e.to]!)).map(e=>({...e,to:visit(e.to)})),next=nodes.length;nodes.push({end:n.end,edges});memo.set(id,next);return next;};
    const next=visit(root),node=nodes[next]!;nodes[next]={end:divideMass(node.end,total),edges:node.edges.map(e=>({...e,weight:divideMass(e.weight,total)}))};return{root:next,nodes};
  }
}
export function blockLanguage(blocks:readonly (readonly number[])[]):OrderLanguage{
  const b=new Builder();let root=b.node(unitMass(),[]);
  for(let group=blocks.length-1;group>=0;group--)for(let i=0;i<blocks[group]!.length;i++)root=b.node(zeroMass(),[{group,to:root,weight:unitMass()}]);
  return b.finish(root);
}
export function insertLanguage(language:ReadonlyOrderLanguage,group:number,index:number):OrderLanguage{
  const b=new Builder(),copy=b.importer(language),memo=new Map<string,number>();
  function visit(id:number,at:number):number{
    const key=id+':'+at,old=memo.get(key);if(old!==undefined)return old;
    const n=language.nodes[id]!;
    const next=at===0?b.node(zeroMass(),[{group,to:copy(id),weight:unitMass()}]):b.node(zeroMass(),n.edges.map(e=>({...e,to:visit(e.to,at-1)})));
    memo.set(key,next);return next;
  }
  return b.finish(visit(language.root,index));
}
export function insertRandomLanguage(language:ReadonlyOrderLanguage,group:number,slots:number):OrderLanguage{
  const b=new Builder(),choices=[];
  for(let index=0;index<slots;index++){const next=insertLanguage(language,group,index);choices.push({node:b.importer(next)(next.root),weight:probabilityMass(1n,BigInt(slots))});}
  return b.finish(b.union(choices));
}
/** Remove one specified member of an exchangeable group. Each occurrence was
 * equally likely to hold that member, so its position is marginalized. */
export function removeLanguage(language:ReadonlyOrderLanguage,group:number,count:number):OrderLanguage{
  const b=new Builder(),copy=b.importer(language),memo=new Map<number,number>();
  function visit(id:number):number{
    const old=memo.get(id);if(old!==undefined)return old;const n=language.nodes[id]!;
    const choices=n.edges.flatMap(e=>[
      {node:b.node(zeroMass(),[{...e,to:visit(e.to)}]),weight:unitMass()},
      ...(e.group===group?[{node:copy(e.to),weight:divideMass(e.weight,probabilityMass(BigInt(count)))}]:[]),
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
export function languageMasses(language:ReadonlyOrderLanguage):ProbabilityMass[]{
  const masses:ProbabilityMass[]=[];
  function mass(id:number):ProbabilityMass{if(masses[id]!==undefined)return masses[id]!;const n=language.nodes[id]!;return masses[id]=n.edges.reduce((sum,e)=>addMass(sum,multiplyMass(e.weight,mass(e.to))),n.end);}
  mass(language.root);return masses;
}
/** Exact marginal of the last group in the current weighted sequence. No
 * full permutation or representative path is sampled to compute these masses. */
export function lastGroupMasses(language:ReadonlyOrderLanguage):Map<number,ProbabilityMass>{
  const memo=new Map<number,Map<number,ProbabilityMass>>();
  function visit(id:number):Map<number,ProbabilityMass>{
    const old=memo.get(id);if(old)return old;
    const result=new Map<number,ProbabilityMass>(),node=language.nodes[id]!;
    for(const edge of node.edges){
      const terminal=language.nodes[edge.to]!.end;
      if(positive(terminal))result.set(edge.group,addMass(result.get(edge.group)??zeroMass(),multiplyMass(edge.weight,terminal)));
      for(const [group,mass] of visit(edge.to))result.set(group,addMass(result.get(group)??zeroMass(),multiplyMass(edge.weight,mass)));
    }
    memo.set(id,result);return result;
  }
  const mass=languageMasses(language)[language.root]!;
  return new Map([...visit(language.root)].filter(([,p])=>positive(p)).map(([group,p])=>[group,divideMass(p,mass)]));
}

/** A valid deterministic carrier, never a sampled realization of the law.
 * Callers must retain the conditional language for every unobserved position. */
export function firstLanguageOrder(language:ReadonlyOrderLanguage,blocks:readonly (readonly number[])[]):number[]{
  const masses=languageMasses(language),remaining=blocks.map(block=>[...block]),result:number[]=[];
  let id=language.root;
  for(;;){
    const node=language.nodes[id]!;
    if(positive(node.end))break;
    const edge=node.edges.find(edge=>positive(edge.weight)&&positive(masses[edge.to]!))!;
    const entity=remaining[edge.group]!.shift()!;
    result.push(entity);id=edge.to;
  }
  return result;
}

/** Canonical group and node identities keep a fixed entropy cursor independent
 * of graph allocation order or the hidden insertion position later forgotten. */
export function canonicalLanguage(language:ReadonlyOrderLanguage,groups:ReadonlyMap<number,number>):OrderLanguage{
  const masses=languageMasses(language),heights=new Map<number,number>(),levels=new Map<number,number[]>();
  function height(id:number):number{const old=heights.get(id);if(old!==undefined)return old;const n=language.nodes[id]!,h=n.edges.reduce((best,e)=>positive(e.weight)&&positive(masses[e.to]!)?Math.max(best,1+height(e.to)):best,0);heights.set(id,h);const level=levels.get(h)??[];level.push(id);levels.set(h,level);return h;}
  height(language.root);const nodes:OrderLanguage['nodes']=[],mapped=new Map<number,number>();
  for(const level of [...levels.keys()].sort((a,b)=>a-b)){
    const forms=levels.get(level)!.map(id=>{const node=language.nodes[id]!,mass=masses[id]!,edges=new Map<string,{group:number;to:number;weight:ProbabilityMass}>();
      for(const edge of node.edges){if(!(positive(edge.weight)&&positive(masses[edge.to]!)))continue;const group=groups.get(edge.group)!;const to=mapped.get(edge.to)!,weight=divideMass(multiplyMass(edge.weight,masses[edge.to]!),mass),key=group+':'+to,prior=edges.get(key);if(prior)prior.weight=addMass(prior.weight,weight);else edges.set(key,{group,to,weight});}
      const value={end:divideMass(node.end,mass),edges:[...edges.values()].sort((a,b)=>a.group-b.group||a.to-b.to)};return{id,value,key:keyOf(value)};
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
        edges.push({group,to:visit(edge.to,next,seen||group===selected),weight:multiplyMass(edge.weight,probabilityMass(BigInt(count),BigInt(total)))});
      }
    }
    const next=b.node(seen?node.end:zeroMass(),edges);memo.set(key,next);return next;
  }
  return b.finish(visit(language.root,sizes,false));
}
