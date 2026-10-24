import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {adventures} from "../../rules/adventures.ts";
import {cardInstances} from "../../rules/card-instances.ts";
import {random} from "../../rules/random.ts";
import {potionId} from "../../identifiers.ts";
import * as pools from "../../pools.ts";
import type {CardPreview} from "../../rules/adventures.types.ts";
import {previewSchema} from "../../rules/adventures.schemas.ts";
import type {Room} from "../../map.types.ts";
const {defineRules,defineQuery,defineEffect,sequence,call,query,when,whileDo,forEach}=rules;
export const libraryCardCount=20;
export const adventureDraws=defineRules({requires:[adventures],build(){
  const freshCard=defineQuery({input:z.object({candidate:previewSchema,existing:z.array(previewSchema)}),output:z.boolean(),dependencies:[cardInstances.exports.sameDefinition],base:(r,i)=>!i.existing.some(card=>r.query(cardInstances.exports.sameDefinition,[card.definition,i.candidate.definition]))});
  const classCard=defineEffect<{run:number;stream:number;rarity:number;rewardExclude?:CardPreview[]},CardPreview>(b=>{const index=b.local<number>();return sequence(b.assign(index,call(random.exports.mappedInt,b.read(v=>{
    const pool=v.query(adventures.exports.cardPools,v.input.run).rarity[v.input.rarity];if(!pool)throw Error('Invalid class card rarity');
    const values=pool.map((_,index)=>index);
    return{stream:v.input.stream,values,...(v.input.rewardExclude?{declarations:pool.map(id=>{
      const candidate={definition:v.query(adventures.exports.card,{run:v.input.run,id}),upgraded:false,misc:0};
      return v.query(freshCard,{candidate,existing:v.input.rewardExclude!})?{name:'reward-card',value:id}:null;
    })}:{})};
  }))),b.return({definition:query(adventures.exports.card,b.read(v=>({run:v.input.run,id:v.query(adventures.exports.cardPools,v.input.run).rarity[v.input.rarity]![v.get(index)]!}))),upgraded:false,misc:0}));});
  const colorless=defineEffect<{run:number;stream:number;rarity:number;publication?:string},CardPreview>(b=>{const index=b.local<number>();return sequence(b.assign(index,call(random.exports.mappedInt,b.read(v=>{
    const pool=v.input.rarity===2?pools.rareColorless:pools.uncommonColorless;
    return{stream:v.input.stream,values:pool.map((_,index)=>index),...(v.input.publication?{declarations:pool.map(value=>({name:v.input.publication!,value}))}:{})};
  }))),b.return({definition:query(adventures.exports.card,b.read(v=>({run:v.input.run,id:(v.input.rarity===2?pools.rareColorless:pools.uncommonColorless)[v.get(index)]!}))),upgraded:false,misc:0}));});
  const potionRank=(roll:number)=>roll<65?0:roll<90?1:2;
  const potionMatches=(id:number,rank:number)=>pools.potionRarities[id]===rank;
  const pickPotion=defineEffect<{stream:number;rewardRank?:number},number>(b=>{const id=b.local<number>();return sequence(
    b.assign(id,call(random.exports.mappedInt,b.read(v=>{
      const values=pools.ironcladPotions.map(name=>potionId[name]);
      return{stream:v.input.stream,values,...(v.input.rewardRank===undefined?{}:{declarations:values.map(value=>potionMatches(value,v.input.rewardRank!)?{name:'reward-potion',value}:null)})};
    }))),b.return(id));});
  const potion=defineEffect<number,number>(b=>{const id=b.local<number>();return sequence(b.assign(id,call(pickPotion,{stream:b.input})),b.return(id));});
  // A draw is not necessarily revealed: some original callers discard it.
  // Only a caller that exposes the result may request public declarations.
  const rewardPotion=defineEffect<number|{stream:number;publish:boolean},number>(b=>{const stream=b.local<number>(),publish=b.local<boolean>(),rank=b.local<number>(),id=b.local<number>();return sequence(
    b.assign(stream,b.read(v=>typeof v.input==='number'?v.input:v.input.stream)),b.assign(publish,b.read(v=>typeof v.input!=='number'&&v.input.publish)),
    b.assign(rank,call(random.exports.mappedInt,b.read(v=>{const values=Array.from({length:100},(_,roll)=>potionRank(roll));return{stream:v.get(stream),values,...(v.get(publish)?{declarations:values.map(value=>({name:'reward-potion-rarity',value}))}:{})};}))),
    whileDo(true,sequence(b.assign(id,call(pickPotion,b.read(v=>({stream:v.get(stream),...(v.get(publish)?{rewardRank:v.get(rank)}:{})})))),when(b.read(v=>potionMatches(v.get(id),v.get(rank))),b.return(id)))),
  );});
  const limitedRewardPotion=defineEffect<number,number>(b=>{const roll=b.local<number>(),id=b.local<number>();return sequence(b.assign(roll,call(random.exports.int,{stream:b.input,start:0,end:99})),call(potion,b.input),whileDo(true,sequence(b.assign(id,call(potion,b.input)),when(b.read(v=>v.get(id)!==potionId.FRUIT_JUICE&&potionMatches(v.get(id),potionRank(v.get(roll)))),b.return(id)))));});
  const curse=defineEffect<number,CardPreview>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.card),start:0,end:9})),b.return({definition:query(adventures.exports.card,{run:b.input,id:b.read(v=>pools.curseCardPool[v.get(roll)]!)}),upgraded:false,misc:0}));});
  function neowOffer(count:number,uncommonChance:number){
    const fixedRank=(rank:number)=>({pick:(_uncommon:boolean)=>rank,text:['普通','罕见','稀有'][rank]!});
    const mixedRank={pick:(uncommon:boolean)=>uncommon?1:0,text:`普通或罕见（罕见判定概率${uncommonChance*100}%）`};
    const rankFor=(rare:boolean,colorless:boolean)=>rare?fixedRank(2):colorless?fixedRank(1):mixedRank;
    const effect=defineEffect<{run:number;rare:boolean;colorless:boolean},CardPreview[]>(b=>{const out=b.local<CardPreview[]>(),rarity=b.local<number>(),uncommon=b.local<boolean>(),picked=b.local<CardPreview>(),fresh=b.local<boolean>();return sequence(b.assign(out,[]),whileDo(b.read(v=>v.get(out).length<count),sequence(
      // This draw is consumed even for fixed-rarity offers.
      b.assign(uncommon,call(random.exports.chance,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.neow),chance:uncommonChance})),b.assign(rarity,b.read(v=>rankFor(v.input.rare,v.input.colorless).pick(v.get(uncommon)))),b.assign(fresh,false),
      whileDo(b.read(v=>!v.get(fresh)),sequence(when(b.read(v=>v.input.colorless),b.assign(picked,call(colorless,{run:b.read(v=>v.input.run),stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.card),rarity})),b.assign(picked,call(classCard,{run:b.read(v=>v.input.run),stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.neow),rarity}))),b.assign(fresh,query(freshCard,{candidate:picked,existing:out})))),b.assign(out,b.read(v=>[...v.get(out),v.get(picked)])),
    )),b.return(out));});
    return {effect,text:(rare:boolean,colorless:boolean)=>`提供${count}张不重复的${rankFor(rare,colorless).text}${colorless?'无色':'角色'}牌`};
  }
  const neowProgram=neowOffer(3,.33),neow=neowProgram.effect;
  const transformed=defineEffect<{run:number;card:CardPreview;stream:number;autoUpgrade:boolean},CardPreview>(b=>{const index=b.local<number>();const pool=(v:rules.ReadView<{run:number;card:CardPreview;stream:number;autoUpgrade:boolean}>)=>{const m=v.query(cardInstances.exports.definitionMetadata,v.input.card.definition);return m.color===5?pools.curseCardPool:m.color===4?pools.srcColorlessCardPool:v.query(adventures.exports.cardPools,v.input.run).transform;};return sequence(
    b.assign(index,call(random.exports.int,{stream:b.read(v=>v.input.stream),start:0,end:b.read(v=>{const m=v.query(cardInstances.exports.definitionMetadata,v.input.card.definition);return pool(v).length-(m.color===5||m.color===4||m.color===v.query(adventures.exports.cardPools,v.input.run).color&&m.rarity!==3?2:1);})})),
    b.return(b.read(v=>{const m=v.query(cardInstances.exports.definitionMetadata,v.input.card.definition),list=pool(v),at=v.get(index),candidate=v.query(adventures.exports.card,{run:v.input.run,id:list[at]!});const same=v.query(cardInstances.exports.sameDefinition,[candidate,v.input.card.definition]);return{definition:same&&(m.color===5||m.color===4||m.color===v.query(adventures.exports.cardPools,v.input.run).color&&m.rarity!==3)?v.query(adventures.exports.card,{run:v.input.run,id:list[at+1]!}):candidate,upgraded:m.color===5||m.color===4?false:v.input.autoUpgrade,misc:0};})),
  );});
  const preview=defineQuery({input:z.object({run:z.number(),card:previewSchema}),output:previewSchema,dependencies:[cardInstances.exports.definitionMetadata,adventures.exports.hasRelic,adventures.exports.card,cardInstances.exports.sameDefinition],base:(r,i)=>{const type=r.query(cardInstances.exports.definitionMetadata,i.card.definition).type,egg=(['MOLTEN_EGG','TOXIC_EGG','FROZEN_EGG'] as const)[type];if(!egg||!r.query(adventures.exports.hasRelic,{run:i.run,id:egg}))return i.card;const repeated=r.query(cardInstances.exports.sameDefinition,[i.card.definition,r.query(adventures.exports.card,{run:i.run,id:'SEARING_BLOW'})]);return{...i.card,upgraded:true,misc:repeated?((i.card.misc+1)<<16)>>16:i.card.misc};}});
  function choiceAdjustment(id:'QUESTION_CARD'|'BUSTED_CROWN',amount:number){return{
    query:defineQuery({input:z.number(),output:z.number(),dependencies:[adventures.exports.hasRelic],base:(r,run)=>r.query(adventures.exports.hasRelic,{run,id})?amount:0}),
    text:`卡牌奖励的选项数${amount>=0?'增加':'减少'}${Math.abs(amount)}。`,
  };}
  const questionCard=choiceAdjustment('QUESTION_CARD',1),bustedCrown=choiceAdjustment('BUSTED_CROWN',-2);
  function rewardRank(multiplier:number){return{
    query:defineQuery({input:z.object({run:z.number(),room:z.string(),roll:z.number()}),output:z.number(),dependencies:[adventures.exports.hasRelic,adventures.exports.economy],base:(r,input)=>{
      const adjusted=input.roll+r.query(adventures.exports.economy,input.run).cardRarityFactor;
      if(input.room==='BOSS')return 2;
      const rare=(input.room==='ELITE'?10:3)*(input.room!=='REST'&&r.query(adventures.exports.hasRelic,{run:input.run,id:'NLOTHS_GIFT'})?multiplier:1);
      return adjusted<rare?2:adjusted<rare+(input.room==='ELITE'?40:37)?1:0;
    }}),
    text:`非休息处的角色卡牌奖励，稀有牌判定阈值乘以${multiplier}；Boss奖励仍固定稀有。`,
  };}
  const nlothsGift=rewardRank(3);
  const reward=defineEffect<{run:number;room:Room;publish?:boolean},CardPreview[]>(b=>{const count=b.local<number>(),out=b.local<CardPreview[]>(),rarities=b.local<number[]>(),rarity=b.local<number>(),picked=b.local<CardPreview>(),fresh=b.local<boolean>(),up=b.local<boolean>();return sequence(
    b.assign(count,b.read(v=>3+v.query(questionCard.query,v.input.run)+v.query(bustedCrown.query,v.input.run))),b.assign(out,[]),b.assign(rarities,[]),
    whileDo(b.read(v=>v.get(out).length<v.get(count)),sequence(b.assign(rarity,call(random.exports.mappedInt,b.read(v=>{const values=Array.from({length:100},(_,roll)=>v.query(nlothsGift.query,{run:v.input.run,room:v.input.room,roll}));return{stream:v.query(adventures.exports.bindings,v.input.run).streams.card,values,...(v.input.publish?{declarations:values.map(value=>({name:'reward-rarity',value}))}:{})};}))),
      when(b.read(v=>v.get(rarity)===0||v.get(rarity)===2),call(adventures.exports.setRarity,{run:b.read(v=>v.input.run),factor:b.read(v=>v.get(rarity)===2?5:Math.max(-40,v.query(adventures.exports.economy,v.input.run).cardRarityFactor-1))})),b.assign(fresh,false),
      whileDo(b.read(v=>!v.get(fresh)),sequence(b.assign(picked,call(classCard,b.read(v=>({run:v.input.run,stream:v.query(adventures.exports.bindings,v.input.run).streams.card,rarity:v.get(rarity),...(v.input.publish?{rewardExclude:v.get(out)}:{})})))),b.assign(fresh,query(freshCard,{candidate:picked,existing:out})))),b.assign(out,b.read(v=>[...v.get(out),v.get(picked)])),b.assign(rarities,b.read(v=>[...v.get(rarities),v.get(rarity)])),
    )),forEach(b.read(v=>v.get(out).map((_,i)=>i)),index=>sequence(b.assign(up,false),when(b.read(v=>v.get(rarities)[v.get(index)]!==2),b.assign(up,call(random.exports.chance,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.card),chance:b.read(v=>{const s=v.query(adventures.exports.status,v.input.run);return s.act<2?0:s.act===2?(s.ascension<12?.25:.125):(s.ascension<12?.5:.25);})}))),b.assign(out,b.read(v=>v.get(out).map((c,i)=>i!==v.get(index)?c:v.get(up)?{...c,upgraded:true}:v.query(preview,{run:v.input.run,card:c})))))),b.return(out),
  );});
  const rarity=defineEffect<{run:number;room:Room},number>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.card),start:0,end:99})),b.return(query(nlothsGift.query,{run:b.read(v=>v.input.run),room:b.read(v=>v.input.room),roll})));});
  const shuffledColorless=defineEffect<{run:number;rarity:number},CardPreview>(b=>{const cards=b.local<readonly import('../../rules/permanent-decks.types.ts').PermanentCardDefinition[]>();return sequence(b.assign(cards,random.exports.shuffle({stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.shuffle),items:b.read(v=>v.query(adventures.exports.pools,v.input.run).colorlessPool)})),call(adventures.exports.setColorlessPool,{run:b.read(v=>v.input.run),cards:b.read(v=>[...v.get(cards)])}),b.return(b.read(v=>({definition:v.get(cards).find(card=>v.query(cardInstances.exports.definitionMetadata,card).rarity===v.input.rarity)??v.query(adventures.exports.card,{run:v.input.run,id:'SWIFT_STRIKE'}),upgraded:false,misc:0}))));});
  const library=defineEffect<number,CardPreview[]>(b=>{const cards=b.local<CardPreview[]>(),candidate=b.local<CardPreview>(),rank=b.local<number>();return sequence(b.assign(cards,[]),whileDo(b.read(v=>v.get(cards).length<libraryCardCount),sequence(b.assign(rank,call(rarity,{run:b.input,room:'EVENT'})),b.assign(candidate,call(classCard,{run:b.input,rarity:rank,stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.card)})),when(b.read(v=>!v.get(cards).some(other=>v.query(cardInstances.exports.sameDefinition,[other.definition,v.get(candidate).definition]))),b.assign(cards,b.read(v=>[v.query(preview,{run:v.input,card:v.get(candidate)}),...v.get(cards)]))))),b.return(cards));});
  const colorlessReward=defineEffect<number,CardPreview[]>(b=>{const cards=b.local<CardPreview[]>(),candidate=b.local<CardPreview>(),rare=b.local<boolean>(),fresh=b.local<boolean>();return sequence(b.assign(cards,[]),whileDo(b.read(v=>v.get(cards).length<3+v.query(questionCard.query,v.input)+v.query(bustedCrown.query,v.input)),sequence(b.assign(rare,call(random.exports.chance,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.card),chance:.3})),when(rare,call(adventures.exports.setRarity,{run:b.input,factor:5})),b.assign(fresh,false),whileDo(b.read(v=>!v.get(fresh)),sequence(b.assign(candidate,call(colorless,{run:b.input,stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.card),rarity:b.read(v=>v.get(rare)?2:1)})),b.assign(fresh,b.read(v=>!v.get(cards).some(other=>v.query(cardInstances.exports.sameDefinition,[other.definition,v.get(candidate).definition])))))),b.assign(cards,b.read(v=>[...v.get(cards),v.query(preview,{run:v.input,card:v.get(candidate)})])))),b.return(cards));});
  return{exports:{freshCard,classCard,colorless,potion,rewardPotion,limitedRewardPotion,curse,neow,neowProgram,transformed,preview,reward,rarity,shuffledColorless,library,colorlessReward,relicTexts:Object.freeze({QUESTION_CARD:questionCard.text,BUSTED_CROWN:bustedCrown.text,NLOTHS_GIFT:nlothsGift.text})}};
}});
