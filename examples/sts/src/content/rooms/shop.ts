import { typedValue } from '../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {adventures} from "../../rules/adventures.ts";
import {shops} from "../../rules/shops.ts";
import {random} from "../../rules/random.ts";
import {resources} from "../../rules/resources.ts";
import {potions} from "../../rules/potions.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {cardInstances} from "../../rules/card-instances.ts";
import {relics,type RelicDefinition} from "../../rules/relics.ts";
import {adventureDraws} from "../rewards/draws.ts";
import {relicBasePrices,potionRarities} from "../../pools.ts";
import {roundAway} from "../../numbers.ts";
import type {CardPreview,RelicTier} from "../../rules/adventures.types.ts";
import type {AdventureChoiceExports} from "../../rules/adventure-choices.ts";
import type {createAdventureAcquisition} from "../relics/acquisition.ts";
import type {ShopSetup} from "../../rules/shops.schemas.ts";
import {describeProgram,programText} from '../cards/shared/program-facts.ts';
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,whileDo,forEach,call,query,spawnEntity,despawnEntity,on,install}=rules;
const f=Math.fround;

/** Pinned source merchant programs, including its replacement-price and egg-preview quirks. */
const sourceRelicPrices:rules.Borrowed<Record<string,number>>=relicBasePrices;
export function createMerchant(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>){return defineRules({requires:[ui,acquisition,shops,adventureDraws],build(){
  const definition=defineEntity(shops.exports.kind,undefined);
  const rarity=defineEffect<number,number>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.card),start:0,end:99})),b.return(b.read(v=>{const n=v.get(roll)+v.query(adventures.exports.economy,v.input).cardRarityFactor;return n<9?2:n<46?1:0;})));});
  const tier=defineEffect<number,RelicTier>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.merchant),start:0,end:99})),b.return(b.read(v=>v.get(roll)<48?'common':v.get(roll)<82?'uncommon':'rare')));});
  const typedCard=defineEffect<{run:number;type:number;rarity:number},CardPreview>(b=>{const index=b.local<number>();return sequence(b.assign(index,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.card),start:0,end:b.read(v=>v.query(adventures.exports.cardPools,v.input.run).typeRarity[v.input.type]![v.input.rarity as 0|1|2]!.length-1)})),b.return({definition:query(adventures.exports.card,b.read(v=>({run:v.input.run,id:v.query(adventures.exports.cardPools,v.input.run).typeRarity[v.input.type]![v.input.rarity as 0|1|2]![v.get(index)]!}))),upgraded:false,misc:0}));});
  function priceReduction(id:'THE_COURIER'|'MEMBERSHIP_CARD',ratio:number){return{
    owned:defineQuery({input:z.number(),output:z.boolean(),dependencies:[adventures.exports.hasRelic],base:(r,run)=>r.query(adventures.exports.hasRelic,{run,id})}),
    factor:(owned:boolean)=>owned?ratio:1,
    apply:(price:number)=>f(f(price)*f(ratio)),
    text:`商店初始商品及删牌价格乘以${ratio}。`,
    replacementText:`补货卡牌的基础价格乘以${ratio}`,
    currentText:`当前商店商品及删牌价格乘以${ratio}`,
  };}
  const courier=priceReduction('THE_COURIER',.8),membership=priceReduction('MEMBERSHIP_CARD',.5);
  const factor=defineQuery({input:z.number(),output:z.number(),dependencies:[courier.owned,membership.owned],base:(r,run)=>f(courier.factor(r.query(courier.owned,run))*membership.factor(r.query(membership.owned,run)))});
  function removalBase(amount:number){return{query:defineQuery({input:z.number(),output:z.number(),dependencies:[adventures.exports.hasRelic,adventures.exports.economy],base:(r,run)=>r.query(adventures.exports.hasRelic,{run,id:'SMILING_MASK'})?amount:75+25*r.query(adventures.exports.economy,run).shopRemoveCount}),text:`商店删牌基础费用固定为${amount}金币，仍受信使与会员卡折扣影响。`};}
  const smilingMask=removalBase(50);
  function replacementPrice(minimum:number,maximum:number){return{effect:defineEffect<number,number>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.floatRange,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.merchant),start:minimum,end:maximum})),b.return(b.read(v=>roundAway(v.get(roll)))));}),text:`药水补货价取${minimum}至${maximum}间的随机数并四舍五入${roundAway(minimum)===roundAway(maximum)?`（当前为${roundAway(minimum)}金币）`:''}`};}
  const replacementPricing=replacementPrice(.95,1.05),newPrice=replacementPricing.effect;
  function replacementCardDiscount(){return {
    query:defineQuery({input:z.object({run:z.number(),price:z.number()}),output:z.number(),dependencies:[courier.owned],base:(r,input)=>r.query(courier.owned,input.run)?membership.apply(courier.apply(input.price)):input.price}),
    text:`持有信使时，${courier.replacementText}，然后${membership.replacementText}（不要求持有会员卡）`,
  };}
  const cardDiscount=replacementCardDiscount();
  const newCardPrice=defineEffect<{run:number;rarity:number;colorless:boolean},number>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.floatRange,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.merchant),start:.9,end:1.1})),b.return(b.read(v=>{let price=f([50,75,150][v.input.rarity]!*v.get(roll));if(v.input.colorless)price=f(price*f(1.2));return Math.trunc(v.query(cardDiscount.query,{run:v.input.run,price}));})));});
  const setup=defineEffect<number,number>(b=>{
    const stock=b.local<ShopSetup>(),card=b.local<CardPreview>(),rarities=b.local<number[]>(),rank=b.local<number>(),roll=b.local<number>(),same=b.local<boolean>(),relic=b.local<RelicDefinition>(),relicTier=b.local<RelicTier>(),potion=b.local<number>(),shop=b.local<number>();
    return sequence(
      b.assign(stock,{run:b.input,cards:[],relics:[],potions:[],prices:[],removeCost:0}),b.assign(rarities,[]),
      forEach([0,1,2,3,4],index=>sequence(
        b.assign(same,true),whileDo(same,sequence(b.assign(rank,call(rarity,b.input)),when(b.read(v=>v.get(index)===4&&v.get(rank)===0),b.assign(rank,1)),b.assign(card,call(typedCard,{run:b.input,type:b.read(v=>Math.floor(v.get(index)/2)),rarity:rank})),b.assign(same,b.read(v=>{const i=v.get(index);return(i===1||i===3)&&v.query(cardInstances.exports.sameDefinition,[v.get(stock).cards[i-1]!.definition,v.get(card).definition]);})))),
        when(b.read(v=>v.get(index)===1||v.get(index)===3),b.assign(card,query(adventureDraws.exports.preview,{run:b.input,card}))),b.assign(stock,b.read(v=>({...v.get(stock),cards:[...v.get(stock).cards,v.get(card)]}))),b.assign(rarities,b.read(v=>[...v.get(rarities),v.get(rank)])),
      )),
      forEach([1,2],rank=>sequence(b.assign(card,call(adventureDraws.exports.colorless,{run:b.input,stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.card),rarity:rank})),b.assign(stock,b.read(v=>({...v.get(stock),cards:[...v.get(stock).cards,v.get(card)]}))))),
      forEach([0,1,2,3,4,5,6],index=>sequence(b.assign(roll,call(random.exports.floatRange,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.merchant),start:.9,end:1.1})),b.assign(stock,b.read(v=>{const i=v.get(index),rank=i<5?v.get(rarities)[i]!:i===5?1:2;let price=f([50,75,150][rank]!*v.get(roll));if(i>=5)price=f(price*f(1.2));return{...v.get(stock),prices:[...v.get(stock).prices,Math.trunc(price)]};})))),
      b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.merchant),start:0,end:4})),b.assign(stock,b.read(v=>({...v.get(stock),prices:v.get(stock).prices.map((price,i)=>i===v.get(roll)?Math.trunc(price/2):price)}))),
      forEach([0,1,2],index=>sequence(when(b.read(v=>v.get(index)===2),b.assign(relicTier,'shop'),b.assign(relicTier,call(tier,b.input))),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:relicTier,shop:true,front:false,screenless:false})),b.assign(roll,call(random.exports.floatRange,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.merchant),start:.95,end:1.05})),b.assign(stock,b.read(v=>{const id=v.query(relicMetadata,v.get(relic)),base=v.get(index)===2?150:sourceRelicPrices[id]!;return{...v.get(stock),relics:[...v.get(stock).relics,v.get(relic)],prices:[...v.get(stock).prices,roundAway(f(base*v.get(roll)))]};})))),
      forEach([0,1,2],()=>sequence(b.assign(potion,call(adventureDraws.exports.rewardPotion,b.read(v=>v.query(adventures.exports.bindings,v.input).streams.potion))),b.assign(roll,call(random.exports.floatRange,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.merchant),start:.95,end:1.05})),b.assign(stock,b.read(v=>({...v.get(stock),potions:[...v.get(stock).potions,v.get(potion)],prices:[...v.get(stock).prices,roundAway(f([50,75,100][potionRarities[v.get(potion)]!]!*v.get(roll)))]}))))),
      forEach(['ascension','courier','membership'] as const,discount=>when(b.read(v=>v.get(discount)==='ascension'?v.query(adventures.exports.bindings,v.input).ascension>=16:v.query(v.get(discount)==='courier'?courier.owned:membership.owned,v.input)),b.assign(stock,b.read(v=>({...v.get(stock),prices:v.get(stock).prices.map(price=>roundAway(v.get(discount)==='membership'?membership.apply(price):v.get(discount)==='courier'?courier.apply(price):f(f(price)*f(.8))))}))))),
      b.assign(stock,b.read(v=>{const base=v.query(smilingMask.query,v.input);return{...v.get(stock),removeCost:roundAway(f(f(base)*v.query(factor,v.input)))};})),
      b.assign(shop,spawnEntity({definition,owner:b.input,scope:b.read(v=>v.query(adventures.exports.bindings,v.input).scope),setup:stock})),b.return(shop),
    );
  });
  const relicMetadata=defineQuery({input:typedValue<RelicDefinition>(),output:z.string(),kinds:[relics.exports.kind],base:(r,definition)=>r.definitionConfiguration(definition,relics.exports.kind).id});
  const pay=defineEffect<{shop:number;amount:number},void>(b=>sequence(call(resources.exports.spendGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.query(shops.exports.current,v.input.shop).run).actor),amount:b.read(v=>v.input.amount)}),call(shops.exports.announceSpent,{run:b.read(v=>v.query(shops.exports.current,v.input.shop).run),amount:b.read(v=>v.input.amount)})));
  function discountCurrentStock(reduction:ReturnType<typeof priceReduction>){return describeProgram(defineEffect<number,void>(b=>call(shops.exports.setPrices,b.read(v=>{const s=v.query(shops.exports.current,v.input);return{shop:v.input,prices:s.prices.map(price=>roundAway(reduction.apply(price))),removeCost:roundAway(reduction.apply(s.removeCost))};}))),`购买时，${reduction.currentText}。`);}
  const membershipPurchase=discountCurrentStock(membership);
  type Slot={run:number;shop:number;index:number};
  function refillRelic(){return describeProgram(defineEffect<Slot&{relic:RelicDefinition},void>(b=>{const rank=b.local<RelicTier>(),replacement=b.local<RelicDefinition>();return when(query(courier.owned,b.read(v=>v.input.run)),sequence(
    b.assign(rank,call(tier,b.read(v=>v.input.run))),b.assign(replacement,call(acquisition.exports.draw,{run:b.read(v=>v.input.run),tier:rank,shop:true,front:false,screenless:false})),call(newPrice,b.read(v=>v.input.run)),call(shops.exports.setRelic,{shop:b.read(v=>v.input.shop),index:b.read(v=>v.input.index),relic:replacement,price:b.read(v=>v.query(shops.exports.current,v.input.shop).prices[7+v.input.index]!)}),
  ),call(shops.exports.setRelic,{shop:b.read(v=>v.input.shop),index:b.read(v=>v.input.index),relic:b.read(v=>v.input.relic),price:-1}));}),'购买遗物后补货，遗物补货保留原价。');}
  const relicRefill=refillRelic();
  function refillPotion(){return describeProgram(defineEffect<Slot&{potion:number},void>(b=>{const potion=b.local<number>(),price=b.local<number>();return when(query(courier.owned,b.read(v=>v.input.run)),sequence(
    b.assign(potion,call(adventureDraws.exports.rewardPotion,b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.potion))),b.assign(price,call(newPrice,b.read(v=>v.input.run))),call(shops.exports.setPotion,{shop:b.read(v=>v.input.shop),index:b.read(v=>v.input.index),potion,price}),
  ),call(shops.exports.setPotion,{shop:b.read(v=>v.input.shop),index:b.read(v=>v.input.index),potion:b.read(v=>v.input.potion),price:-1}));}),`购买药水后补货；${replacementPricing.text}。`);}
  const potionRefill=refillPotion();
  function refillCard(){return describeProgram(defineEffect<Slot&{card:CardPreview},void>(b=>{const rank=b.local<number>(),roll=b.local<number>(),card=b.local<CardPreview>(),price=b.local<number>();return when(query(courier.owned,b.read(v=>v.input.run)),sequence(
    when(b.read(v=>v.input.index>=5),sequence(b.assign(roll,call(random.exports.float,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.merchant)})),b.assign(rank,b.read(v=>v.get(roll)<f(.3)?2:1)),b.assign(card,call(adventureDraws.exports.colorless,{run:b.read(v=>v.input.run),stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.card),rarity:rank}))),sequence(b.assign(rank,call(rewardRarity,b.read(v=>v.input.run))),b.assign(card,call(adventureDraws.exports.classCard,{run:b.read(v=>v.input.run),stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.mathUtil),rarity:rank})))),b.assign(card,query(adventureDraws.exports.preview,{run:b.read(v=>v.input.run),card})),b.assign(price,call(newCardPrice,{run:b.read(v=>v.input.run),rarity:rank,colorless:b.read(v=>v.input.index>=5)})),call(shops.exports.setCard,{shop:b.read(v=>v.input.shop),index:b.read(v=>v.input.index),card,price}),
  ),call(shops.exports.setCard,{shop:b.read(v=>v.input.shop),index:b.read(v=>v.input.index),card:b.read(v=>v.input.card),price:-1}));}),`购买卡牌后补货；${cardDiscount.text}。`);}
  const cardRefill=refillCard();
  const settleRelic=defineEffect<number,void>(b=>{const pending=b.local<z.infer<typeof import('../../rules/shops.schemas.ts').shopPurchaseSchema>>(),run=b.local<number>();return sequence(
    when(b.read(v=>v.query(shops.exports.current,v.input).pending===null),b.return(undefined)),b.assign(pending,b.read(v=>v.query(shops.exports.current,v.input).pending!)),b.assign(run,b.read(v=>v.query(shops.exports.current,v.input).run)),call(shops.exports.pending,{shop:b.input,purchase:null}),call(pay,{shop:b.input,amount:b.read(v=>v.get(pending).price)}),
    when(b.read(v=>v.query(relicMetadata,v.get(pending).relic)==='MEMBERSHIP_CARD'),call(membershipPurchase,b.input)),
    call(relicRefill,{run,shop:b.input,index:b.read(v=>v.get(pending).index),relic:b.read(v=>v.get(pending).relic)}),
    when(b.read(v=>{const s=v.query(shops.exports.current,v.input),id=v.query(relicMetadata,s.relics[v.get(pending).index]!);return id==='MOLTEN_EGG'||id==='TOXIC_EGG'||id==='FROZEN_EGG';}),call(shops.exports.setCards,{shop:b.input,cards:b.read(v=>v.query(shops.exports.current,v.input).cards.map(card=>v.query(adventureDraws.exports.preview,{run:v.get(run),card})))})),
  );});
  const beforeChoice=on(adventures.exports.requesting,{condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[shops.exports.current],base:(r,c)=>{const s=r.query(shops.exports.current,c.source);return s.run===c.event&&s.pending!==null;}}),effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(settleRelic,b.read(v=>v.input.source)))});
  const open=defineEffect<number,void>(b=>{const shop=b.local<number>(),bits=b.local<number>(),type=b.local<number>(),index=b.local<number>(),card=b.local<CardPreview>(),potion=b.local<number>(),price=b.local<number>(),bought=b.local<boolean>();return sequence(
    b.assign(shop,call(setup,b.input)),install({ability:beforeChoice,source:shop,owner:b.input,environment:{},lifetime:b.read(v=>v.query(adventures.exports.bindings,v.input).scope)}),call(adventures.exports.setScene,{run:b.input,screen:'SHOP_ROOM',continuation:true}),
    whileDo(true,sequence(
      b.assign(bits,call(ui.exports.choose,{run:b.input,actions:b.read(v=>{const s=v.query(shops.exports.current,v.get(shop)),gold=v.query(resources.exports.wealth,v.query(adventures.exports.bindings,v.input).actor).gold,out:number[]=[];for(let i=0;i<7;i++)if(s.prices[i]!==-1&&gold>=s.prices[i]!)out.push(i);for(let i=0;i<3;i++)if(s.prices[7+i]!==-1&&gold>=s.prices[7+i]!)out.push((4<<27)|i);for(let i=0;i<3;i++)if(s.prices[10+i]!==-1&&gold>=s.prices[10+i]!)out.push((3<<27)|i);if(s.removeCost!==-1&&gold>=s.removeCost)out.push(5<<27);out.push(6<<27);return out;})})),b.assign(type,b.read(v=>(v.get(bits)>>>27)&7)),b.assign(index,b.read(v=>v.get(bits)&255)),
      when(b.read(v=>v.get(type)===6),sequence(despawnEntity({entity:shop,reason:{leftShop:true}}),b.return(undefined))),
      when(b.read(v=>v.get(type)===0),sequence(
        b.assign(card,b.read(v=>v.query(shops.exports.current,v.get(shop)).cards[v.get(index)]!)),b.assign(price,b.read(v=>v.query(shops.exports.current,v.get(shop)).prices[v.get(index)]!)),call(permanentDecks.exports.obtain,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input).deck),definition:b.read(v=>v.get(card).definition),upgraded:b.read(v=>v.get(card).upgraded),specialData:b.read(v=>v.get(card).misc),count:1,upgrade:false}),call(pay,{shop,amount:price}),
        call(cardRefill,{run:b.input,shop,index,card}),
      ),when(b.read(v=>v.get(type)===3),sequence(b.assign(potion,b.read(v=>v.query(shops.exports.current,v.get(shop)).potions[v.get(index)]!)),b.assign(price,b.read(v=>v.query(shops.exports.current,v.get(shop)).prices[10+v.get(index)]!)),b.assign(bought,call(potions.exports.obtain,{inventory:b.read(v=>v.query(adventures.exports.bindings,v.input).potions),potion})),when(b.read(v=>v.get(bought)),sequence(call(pay,{shop,amount:price}),call(potionRefill,{run:b.input,shop,index,potion})))),
        when(b.read(v=>v.get(type)===4),sequence(call(shops.exports.pending,{shop,purchase:{index,price:b.read(v=>v.query(shops.exports.current,v.get(shop)).prices[7+v.get(index)]!),relic:b.read(v=>v.query(shops.exports.current,v.get(shop)).relics[v.get(index)]!)}}),call(acquisition.exports.give,{run:b.input,definition:b.read(v=>v.query(shops.exports.current,v.get(shop)).relics[v.get(index)]!)}),call(settleRelic,shop),call(adventures.exports.setScene,{run:b.input,screen:'SHOP_ROOM',continuation:true})),
          when(b.read(v=>v.get(type)===5),sequence(call(pay,{shop,amount:b.read(v=>v.query(shops.exports.current,v.get(shop)).removeCost)}),call(shops.exports.setPrices,{shop,prices:b.read(v=>v.query(shops.exports.current,v.get(shop)).prices),removeCost:-1}),call(adventures.exports.countShopRemove,{run:b.input}),call(acquisition.exports.selections.exports.select,{run:b.input,type:4,count:1,provided:null,stream:b.read(v=>v.query(adventures.exports.selection,v.input).selection.transformStream)}),call(adventures.exports.setScene,{run:b.input,screen:'SHOP_ROOM',continuation:true})),b.return(b.read(()=>{throw Error('Invalid shop action');})))))),
    )),
  );});
  const rewardRarity=defineEffect<number,number>(b=>{const roll=b.local<number>(),rank=b.local<number>();return sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.card),start:0,end:99})),b.assign(rank,b.read(v=>{const n=v.get(roll)+v.query(adventures.exports.economy,v.input).cardRarityFactor;return n<3?2:n<40?1:0;})),b.return(rank));});
  const joinText=(...parts:(string|undefined)[])=>parts.every(text=>text!==undefined)?parts.join(''):undefined;
  return{exports:{open,setup,relicTexts:Object.freeze(Object.fromEntries(Object.entries({MEMBERSHIP_CARD:joinText(membership.text,programText(membershipPurchase)),THE_COURIER:joinText(courier.text,programText(cardRefill),programText(relicRefill),programText(potionRefill)),SMILING_MASK:smilingMask.text}).filter((entry):entry is [string,string]=>entry[1]!==undefined)))}};
}});}
