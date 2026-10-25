import {divideMass,massNumber,probabilityMass,unitMass,zeroMass,type ProbabilityMass} from '../../../../packages/card-engine/src/probability-mass.ts';
import {blockLanguage,insertLanguage,insertRandomLanguage,removeLanguage,observeLanguage,lastGroupMasses,firstLanguageOrder,canonicalLanguage,lastMatchLanguage,type ReadonlyOrderLanguage} from './order-language.ts';
import {permutationAt,permutationCount,permutationCoordinate} from '../../../../packages/card-engine/src/probability.ts';

/** Groups of exchangeable members. Without a language they are consecutive
 * bottom-to-top blocks; a language instead determines their weighted positions.
 * This is current knowledge, not an action log. Updates never execute a prefix. */
export type OrderKnowledge={blocks:number[][];resolved:boolean;unsupported:boolean;language?:ReadonlyOrderLanguage|undefined};
export function orderSize(blocks:readonly (readonly number[])[]):bigint {
  return blocks.reduce((size,block)=>size*permutationCount(block.length),1n);
}
export function orderAt(blocks:readonly (readonly number[])[],coordinate:bigint):number[] {
  return blocks.flatMap(block=>{const size=permutationCount(block.length),at=coordinate%size;coordinate/=size;return permutationAt(block,at);});
}
export function orderCoordinate(blocks:readonly (readonly number[])[],order:readonly number[]):bigint{
  let coordinate=0n,multiplier=1n,offset=0;
  for(const block of blocks){coordinate+=multiplier*permutationCoordinate(block,order.slice(offset,offset+block.length));multiplier*=permutationCount(block.length);offset+=block.length;}
  return coordinate;
}

/** The original stable grouping operation, applied after a real shuffle. */
export function groupOrder(order:readonly number[],groups:readonly (readonly number[])[]):number[]{
  return groups.flatMap(group=>{const selected=new Set(group);return order.filter(id=>selected.has(id));});
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
  for(let at=0;;at++){
    if(offset===index){blocks.splice(at,0,[entity]);return{...knowledge,blocks};}
    const block=blocks[at]!;
    if(offset<index&&index<offset+block.length){
      return{...knowledge,blocks:[...blocks,[entity]],language:insertLanguage(blockLanguage(blocks),blocks.length,index)};
    }
    offset+=block.length;
  }
}
export function revealPositions(knowledge:OrderKnowledge,actual:readonly number[],positions:readonly number[]):OrderKnowledge {
  if(positions.length===0)return knowledge;
  const unique=[...new Set(positions)].sort((a,b)=>a-b);
  if(unique.length===actual.length)return{blocks:actual.map(id=>[id]),resolved:knowledge.resolved,unsupported:false};
  const blocks=knowledge.blocks.map(block=>[...block]),observed=new Map<number,{from:number;to:number}>();
  for(const at of unique){const id=actual[at]!;const from=knowledge.blocks.findIndex(block=>block.includes(id));blocks[from]=blocks[from]!.filter(member=>member!==id);observed.set(at,{from,to:blocks.length});blocks.push([id]);}
  const language=observeLanguage(knowledge.language??blockLanguage(knowledge.blocks),observed);
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
export function randomInsertion(knowledge:OrderKnowledge,entity:number,slots:number):OrderKnowledge{
  const prior=removeOrdered(knowledge,entity),active=prior.blocks.filter(block=>block.length);
  const length=prior.blocks.reduce((n,block)=>n+block.length,0);
  // With one exchangeable group there are no remaining relative constraints:
  // insertion over EVERY gap gives one larger uniform permutation. A caller
  // excluding the top gap must retain that restriction in the language.
  if(slots===length+1&&!prior.unsupported&&active.length<=1)return{blocks:[[...(active[0]??[]),entity]],resolved:prior.resolved,unsupported:false};
  const blocks=[...prior.blocks,[entity]];
  return{...prior,blocks,language:insertRandomLanguage(prior.language??blockLanguage(prior.blocks),blocks.length-1,slots)};
}
export function appendExchangeable(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]},members:readonly number[],realized?:readonly number[]):OrderKnowledge{
  // A previously materialized order may already be correlated with other
  // state. Keep that order fixed while adding a NEW independent shuffle.
  if(knowledge.resolved){
    knowledge={blocks:realized!.map(id=>[id]),resolved:false,unsupported:knowledge.unsupported};
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
  const eligible=new Set(matching);
  if(selected===null)return knowledge;
  if(knowledge.resolved||matching.length===1)return knowledge;
  const blocks:number[][]=[],matchingGroups=new Set<number>();let selectedGroup=-1;
  const parts=knowledge.blocks.map(block=>{
    const categories=[block.filter(id=>!eligible.has(id)),block.filter(id=>eligible.has(id)&&id!==selected),block.filter(id=>id===selected)],groups:number[]=[];
    categories.forEach((members,category)=>{if(!members.length)return;const group=blocks.length;blocks.push(members);groups.push(group);if(category>0)matchingGroups.add(group);if(category===2)selectedGroup=group;});return groups;
  });
  const language=lastMatchLanguage(knowledge.language??blockLanguage(knowledge.blocks),parts,blocks.map(block=>block.length),selectedGroup,matchingGroups);
  return{...knowledge,blocks,language};
}


/** Reveal only the next top member. The remaining order stays a distribution. */
export function topOrderMasses(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]}):{entity:number;mass:ProbabilityMass}[]{
  if(knowledge.unsupported)throw Error('Unsupported conditional hidden order');
  const last=knowledge.blocks.findLastIndex(block=>block.length>0);
  const masses=knowledge.language?lastGroupMasses(knowledge.language):new Map([[last,unitMass()]]);
  const choices=knowledge.blocks.flatMap((block,group)=>{
    const mass=masses.get(group)??zeroMass();
    return mass.numerator>0n?block.map(entity=>({entity,mass:divideMass(mass,probabilityMass(BigInt(block.length)))})):[];
  });
  return choices;
}
/** Legacy numeric inspection adapter; production sorting uses topOrderMasses. */
export function topOrderChoices(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]}):{entity:number;probability:number}[]{
  return topOrderMasses(knowledge).map(row=>({entity:row.entity,probability:massNumber(row.mass)}));
}

/** A canonical representative is only a carrier for the selected top member.
 * Unrevealed positions must still be resolved through their retained law. */
export function topOrderAt(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]},coordinate:bigint):number[]{
  const choices=topOrderChoices(knowledge);
  const selected=choices[Number(coordinate)]!.entity,prior={...knowledge,blocks:knowledge.blocks.map(block=>[...block])};
  const members=prior.blocks.flat(),representative=[...members.filter(id=>id!==selected),selected];
  const conditional=revealOrdered(prior,representative,1);
  return conditional.language?firstLanguageOrder(conditional.language,conditional.blocks):conditional.blocks.flat();
}

export function afterTop(knowledge:Omit<OrderKnowledge,'blocks'>&{blocks:readonly (readonly number[])[]},entity:number):OrderKnowledge{
  const owned={...knowledge,blocks:knowledge.blocks.map(block=>[...block])};
  return removeOrdered(revealOrdered(owned,[...owned.blocks.flat().filter(id=>id!==entity),entity],1),entity);
}
export function prefixRepresentative(knowledge:OrderKnowledge,top:readonly number[]):number[]{
  const selected=new Set(top),carrier=[...knowledge.blocks.flat().filter(id=>!selected.has(id)),...top.toReversed()];
  const conditional=revealOrdered(knowledge,carrier,top.length);
  return conditional.language?firstLanguageOrder(conditional.language,conditional.blocks):conditional.blocks.flat();
}
