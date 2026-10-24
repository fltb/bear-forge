import {blockLanguage,insertLanguage,insertRandomLanguage,removeLanguage,observeLanguage,languageMasses,lastGroupMasses,sampleLanguage,canonicalLanguage,lastMatchLanguage,type ReadonlyOrderLanguage} from './order-language.ts';
import {generateProbability,permutationAt,permutationCount,permutationCoordinate,type ProbabilityEntropy,type ProbabilityOutcomes} from '../../../../packages/card-engine/src/probability.ts';

/** Groups of exchangeable members. Without a language they are consecutive
 * bottom-to-top blocks; a language instead determines their weighted positions.
 * This is current knowledge, not an action log. Updates never execute a prefix. */
export type OrderKnowledge={blocks:number[][];resolved:boolean;unsupported:boolean;language?:ReadonlyOrderLanguage|undefined};
export function orderSize(blocks:readonly (readonly number[])[]):bigint {
  return blocks.reduce((size,block)=>size*permutationCount(block.length),1n);
}
export function orderAt(blocks:readonly (readonly number[])[],coordinate:bigint):number[] {
  if(coordinate<0n||coordinate>=orderSize(blocks))throw Error('Invalid hidden order coordinate');
  return blocks.flatMap(block=>{const size=permutationCount(block.length),at=coordinate%size;coordinate/=size;return permutationAt(block,at);});
}
export function orderCoordinate(blocks:readonly (readonly number[])[],order:readonly number[]):bigint{
  let coordinate=0n,multiplier=1n,offset=0;
  for(const block of blocks){coordinate+=multiplier*permutationCoordinate(block,order.slice(offset,offset+block.length));multiplier*=permutationCount(block.length);offset+=block.length;}
  if(offset!==order.length)throw Error('Invalid grouped permutation extent');return coordinate;
}

/** The original stable grouping operation, applied after a real shuffle. */
export function groupOrder(order:readonly number[],groups:readonly (readonly number[])[]):number[]{
  const flat=groups.flat(),members=new Set(flat);
  if(members.size!==flat.length||flat.length!==order.length||new Set(order).size!==order.length||order.some(id=>!members.has(id)))throw Error('Invalid shuffle groups');
  return groups.flatMap(group=>{const selected=new Set(group);return order.filter(id=>selected.has(id));});
}

/** A proposal for a FULL permutation, retaining random suffixes and both
 * original masses. All downstream callbacks execute on that chosen order. */
export function partitionFullOrder(blocks:readonly (readonly number[])[],top:readonly number[],maximum:number,source:ProbabilityEntropy):ProbabilityOutcomes|undefined{
  const knowledge={blocks:blocks.map(block=>[...block]),resolved:false,unsupported:false};
  if(top.length===0)return undefined;
  const prefix=partitionPrefixOrder(knowledge,top.length,top,Math.min(maximum,2),source);if(!prefix)return undefined;
  const outcomes:ProbabilityOutcomes['outcomes']=[];let representation=prefix.representation;
  for(const [index,row] of prefix.outcomes.entries()){
    if(typeof row.coordinate==='bigint')throw Error('Expected generated prefix');
    const carrier=row.coordinate.value as number[],conditional=revealOrdered(knowledge,carrier,top.length);
    const size=orderSize(conditional.blocks),available=index===0?Math.max(1,maximum-1):1;
    // Enumerate a small conditional tail exactly. For a large tail, one full
    // sample carries this stratum's mass; expanding seven full creation
    // continuations per existing latent world only multiplies transient work.
    const samples=generateProbability({kind:'uniform',size},size<=BigInt(available)?available:1,source);
    if(samples.representation==='particles')representation='particles';
    for(const sample of samples.outcomes){
      if(typeof sample.coordinate!=='bigint')throw Error('Expected finite permutation coordinate');
      const order=orderAt(conditional.blocks,sample.coordinate);
      outcomes.push({coordinate:orderCoordinate(blocks,order),probability:row.probability*sample.probability});
    }
  }
  return{representation,outcomes};
}
export function removeOrdered(knowledge:OrderKnowledge,entity:number):OrderKnowledge {
  const group=knowledge.blocks.findIndex(block=>block.includes(entity));if(group<0)return knowledge;
  const blocks=knowledge.blocks.map(block=>block.filter(id=>id!==entity));
  return knowledge.language?{...knowledge,blocks,language:removeLanguage(knowledge.language,group,knowledge.blocks[group]!.length)}:{...knowledge,blocks:blocks.filter(block=>block.length)};
}
export function insertOrdered(knowledge:OrderKnowledge,entity:number,index:number):OrderKnowledge {
  const blocks=knowledge.blocks.map(block=>[...block]);
  if(knowledge.language)return{...knowledge,blocks:[...blocks,[entity]],language:insertLanguage(knowledge.language,blocks.length,index)};
  let offset=0;
  for(let at=0;at<=blocks.length;at++){
    if(offset===index){blocks.splice(at,0,[entity]);return{...knowledge,blocks};}
    const block=blocks[at];if(!block)break;
    if(offset<index&&index<offset+block.length){
      return{...knowledge,blocks:[...blocks,[entity]],language:insertLanguage(blockLanguage(blocks),blocks.length,index)};
    }
    offset+=block.length;
  }
  throw Error('Invalid known order insertion');
}
export function revealPositions(knowledge:OrderKnowledge,actual:readonly number[],positions:readonly number[]):OrderKnowledge {
  if(positions.length===0)return knowledge;
  const unique=[...new Set(positions)].sort((a,b)=>a-b);
  if(unique.length===actual.length)return{blocks:actual.map(id=>[id]),resolved:knowledge.resolved,unsupported:false};
  const blocks=knowledge.blocks.map(block=>[...block]),observed=new Map<number,{from:number;to:number}>();
  for(const at of unique){const id=actual[at];if(id===undefined)throw Error('Invalid revealed position');const from=knowledge.blocks.findIndex(block=>block.includes(id));if(from<0)throw Error('Revealed card absent from knowledge');blocks[from]=blocks[from]!.filter(member=>member!==id);observed.set(at,{from,to:blocks.length});blocks.push([id]);}
  const language=observeLanguage(knowledge.language??blockLanguage(knowledge.blocks),observed);
  if(!(languageMasses(language)[language.root]!>0))throw Error('Observed order contradicts current knowledge');
  return{...knowledge,blocks,language};
}
export function revealOrdered(knowledge:OrderKnowledge,actual:readonly number[],count:number):OrderKnowledge {
  if(!knowledge.language){
    const start=Math.max(0,actual.length-count),visible=actual.slice(start),known=new Set(visible);
    const blocks=knowledge.blocks.map(block=>block.filter(id=>!known.has(id))).filter(block=>block.length);
    return{blocks:[...blocks,...visible.map(id=>[id])],resolved:knowledge.resolved,unsupported:count>=actual.length?false:knowledge.unsupported};
  }
  return revealPositions(knowledge,actual,Array.from({length:Math.min(actual.length,count)},(_,i)=>actual.length-1-i));
}
export function randomInsertion(knowledge:OrderKnowledge,entity:number):OrderKnowledge{
  const prior=removeOrdered(knowledge,entity),active=prior.blocks.filter(block=>block.length);
  // With one exchangeable group there are no remaining relative constraints:
  // uniform insertion gives one larger uniform permutation, without a graph.
  if(!prior.unsupported&&active.length<=1)return{blocks:[[...(active[0]??[]),entity]],resolved:prior.resolved,unsupported:false};
  const blocks=[...prior.blocks,[entity]],length=prior.blocks.reduce((n,block)=>n+block.length,0);
  return{...prior,blocks,language:insertRandomLanguage(prior.language??blockLanguage(prior.blocks),blocks.length-1,length)};
}
export function appendExchangeable(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]},members:readonly number[],realized?:readonly number[]):OrderKnowledge{
  // A previously materialized order may already be correlated with other
  // state. Keep that order fixed while adding a NEW independent shuffle.
  if(knowledge.resolved){
    const ids=knowledge.blocks.flat();
    if(!realized||realized.length!==ids.length||new Set(realized).size!==ids.length||realized.some(id=>!ids.includes(id)))throw Error('Materialized prefix requires its current order');
    knowledge={blocks:realized.map(id=>[id]),resolved:false,unsupported:knowledge.unsupported};
  }
  if(!members.length)return{...knowledge,blocks:knowledge.blocks.map(block=>[...block])};
  const blocks=[...knowledge.blocks.map(block=>[...block]),[...members]];
  if(!knowledge.language)return{...knowledge,blocks};
  let language=knowledge.language,length=knowledge.blocks.reduce((n,block)=>n+block.length,0);
  for(let i=0;i<members.length;i++)language=insertLanguage(language,knowledge.blocks.length,length+i);
  return{...knowledge,blocks,language};
}


export function canonicalOrder(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]},keys:ReadonlyMap<number,number>):OrderKnowledge{
  const blocks=knowledge.blocks.map(block=>[...block].sort((a,b)=>keys.get(a)!-keys.get(b)!));
  if(!knowledge.language)return{...knowledge,blocks};
  const groups=blocks.map((members,index)=>({members,index})).filter(group=>group.members.length).sort((a,b)=>keys.get(a.members[0]!)!-keys.get(b.members[0]!)!);
  return{...knowledge,blocks:groups.map(group=>group.members),language:canonicalLanguage(knowledge.language,new Map(groups.map((group,index)=>[group.index,index])))};
}

/** The predicate's candidate identities come from the original mechanism.
 * Only the selected identity is observed, never its real hidden position. */
export function observeLastMatch(knowledge:OrderKnowledge,matching:readonly number[],selected:number|null):OrderKnowledge{
  const eligible=new Set(matching),members=new Set(knowledge.blocks.flat());
  if(eligible.size!==matching.length||matching.some(id=>!members.has(id)))throw Error('Invalid matching order members');
  if(selected===null){if(matching.length)throw Error('Missing selected matching member');return knowledge;}
  if(!eligible.has(selected))throw Error('Selected member does not match');
  if(knowledge.resolved||matching.length===1)return knowledge;
  const blocks:number[][]=[],matchingGroups=new Set<number>();let selectedGroup=-1;
  const parts=knowledge.blocks.map(block=>{
    const categories=[block.filter(id=>!eligible.has(id)),block.filter(id=>eligible.has(id)&&id!==selected),block.filter(id=>id===selected)],groups:number[]=[];
    categories.forEach((members,category)=>{if(!members.length)return;const group=blocks.length;blocks.push(members);groups.push(group);if(category>0)matchingGroups.add(group);if(category===2)selectedGroup=group;});return groups;
  });
  const language=lastMatchLanguage(knowledge.language??blockLanguage(knowledge.blocks),parts,blocks.map(block=>block.length),selectedGroup,matchingGroups);
  if(!(languageMasses(language)[language.root]!>0))throw Error('Selected match contradicts current order');
  return{...knowledge,blocks,language};
}


/** Reveal only the next top member. The remaining order stays a distribution. */
export function topOrderChoices(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]}):{entity:number;probability:number}[]{
  if(knowledge.unsupported)throw Error('Unsupported conditional hidden order');
  const last=knowledge.blocks.findLastIndex(block=>block.length>0);
  if(last<0)throw Error('Empty hidden order');
  const masses=knowledge.language?lastGroupMasses(knowledge.language):new Map([[last,1]]);
  const choices=knowledge.blocks.flatMap((block,group)=>{const mass=masses.get(group)??0;return mass>0?block.map(entity=>({entity,probability:mass/block.length})):[];});
  if(Math.abs(choices.reduce((sum,row)=>sum+row.probability,0)-1)>1e-12)throw Error('Invalid top-order marginal');
  return choices;
}

/** A canonical representative is only a carrier for the selected top member.
 * Unrevealed positions must still be resolved through their retained law. */
export function topOrderAt(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]},coordinate:bigint):number[]{
  const choices=topOrderChoices(knowledge);
  if(coordinate<0n||coordinate>=BigInt(choices.length))throw Error('Invalid top-order coordinate');
  const selected=choices[Number(coordinate)]!.entity,prior={...knowledge,blocks:knowledge.blocks.map(block=>[...block])};
  const members=prior.blocks.flat(),representative=[...members.filter(id=>id!==selected),selected];
  const conditional=revealOrdered(prior,representative,1);
  return conditional.language?sampleLanguage(conditional.language,conditional.blocks,{check(){},word:()=>0}):conditional.blocks.flat();
}

/** Marginalize an ordered top prefix without fixing its unseen suffix. */
type ReadonlyKnowledge=Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]};
const copyKnowledge=(value:ReadonlyKnowledge):OrderKnowledge=>({...value,blocks:value.blocks.map(block=>[...block])});
function prefixLength(knowledge:{blocks:readonly (readonly number[])[]},count:number):number{
  if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid revealed prefix length');
  return Math.min(count,knowledge.blocks.reduce((sum,block)=>sum+block.length,0));
}
function afterTop(knowledge:OrderKnowledge,entity:number):OrderKnowledge{
  return removeOrdered(revealOrdered(knowledge,[...knowledge.blocks.flat().filter(id=>id!==entity),entity],1),entity);
}
function prefixRepresentative(knowledge:OrderKnowledge,top:readonly number[]):number[]{
  const selected=new Set(top),carrier=[...knowledge.blocks.flat().filter(id=>!selected.has(id)),...top.toReversed()];
  const conditional=revealOrdered(knowledge,carrier,top.length);
  return conditional.language?sampleLanguage(conditional.language,conditional.blocks,{check(){},word:()=>0}):conditional.blocks.flat();
}
export function prefixOrderChoices(knowledge:ReadonlyKnowledge,count:number,maximum=8):{top:number[];probability:number}[]|null{
  if(!Number.isSafeInteger(maximum)||maximum<1)throw Error('Invalid prefix support limit');
  const length=prefixLength(knowledge,count),result:{top:number[];probability:number}[]=[];
  function visit(current:OrderKnowledge,top:number[],probability:number):boolean{
    if(top.length===length){result.push({top,probability});return result.length<=maximum;}
    for(const choice of topOrderChoices(current))if(!visit(afterTop(current,choice.entity),[...top,choice.entity],probability*choice.probability))return false;
    return true;
  }
  return visit(copyKnowledge(knowledge),[],1)?result:null;
}
export function prefixOrderAt(knowledge:ReadonlyKnowledge,count:number,coordinate:bigint):number[]{
  const choices=prefixOrderChoices(knowledge,count);
  if(!choices||coordinate<0n||coordinate>=BigInt(choices.length))throw Error('Invalid prefix-order coordinate');
  return prefixRepresentative(copyKnowledge(knowledge),choices[Number(coordinate)]!.top);
}
export function samplePrefixOrder(knowledge:ReadonlyKnowledge,count:number,source:import('../../../../packages/card-engine/src/probability.ts').ProbabilityEntropy):number[]{
  const length=prefixLength(knowledge,count),top:number[]=[];let current=copyKnowledge(knowledge);
  for(let i=0;i<length;i++){
    source.check();const choices=topOrderChoices(current),selected=generateProbability({kind:'weighted',weights:choices.map(row=>row.probability)},1,source).outcomes[0]!;
    const entity=choices[Number(selected.coordinate)]!.entity;top.push(entity);current=afterTop(current,entity);
  }
  source.check();return prefixRepresentative(copyKnowledge(knowledge),top);
}

/** Partition a prefix law by a proposed publicly visible sequence. This does
 * not assume the proposal describes this operation: the complement remains
 * represented with its original mass until the final public IO is matched. */
export function partitionPrefixOrder(knowledge:ReadonlyKnowledge,count:number,top:readonly number[],maximum:number,source:import('../../../../packages/card-engine/src/probability.ts').ProbabilityEntropy):import('../../../../packages/card-engine/src/probability.ts').ProbabilityOutcomes|undefined{
  if(top.length!==prefixLength(knowledge,count)||new Set(top).size!==top.length||maximum<2)return undefined;
  type Divergence={current:OrderKnowledge;prefix:number[];choices:{entity:number;probability:number}[];mass:number};
  const divergences:Divergence[]=[];let current=copyKnowledge(knowledge),mass=1;
  for(let i=0;i<top.length;i++){
    source.check();const choices=topOrderChoices(current),selected=choices.find(row=>row.entity===top[i]);
    if(!selected)return undefined;
    const other=choices.filter(row=>row.entity!==top[i]),rest=other.reduce((sum,row)=>sum+row.probability,0);
    if(rest>0)divergences.push({current,prefix:top.slice(0,i),choices:other.map(row=>({...row,probability:row.probability/rest})),mass:mass*rest});
    mass*=selected.probability;current=afterTop(current,selected.entity);
  }
  const remainder=divergences.reduce((sum,row)=>sum+row.mass,0);
  const outcomes:import('../../../../packages/card-engine/src/probability.ts').ProbabilityOutcomes['outcomes']=[{coordinate:{kind:'sample',value:prefixRepresentative(copyKnowledge(knowledge),top)},probability:mass}];
  if(remainder===0)return{representation:'exact',outcomes};
  if(!(mass>0)||Math.abs(mass+remainder-1)>1e-12)throw Error('Invalid prefix partition mass');
  function choose<T extends {probability:number}>(rows:readonly T[]):T{
    const result=generateProbability({kind:'weighted',weights:rows.map(row=>row.probability)},1,source);return rows[Number(result.outcomes[0]!.coordinate)]!;
  }
  for(let sample=1;sample<maximum;sample++){
    source.check();const divergence=choose(divergences.map(row=>({...row,probability:row.mass/remainder}))),different=choose(divergence.choices);
    let remaining=afterTop(divergence.current,different.entity);const prefix=[...divergence.prefix,different.entity];
    while(prefix.length<top.length){source.check();const next=choose(topOrderChoices(remaining));prefix.push(next.entity);remaining=afterTop(remaining,next.entity);}
    outcomes.push({coordinate:{kind:'sample',value:prefixRepresentative(copyKnowledge(knowledge),prefix)},probability:remainder/(maximum-1)});
  }
  return{representation:'particles',outcomes};
}
