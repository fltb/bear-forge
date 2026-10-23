import {eventBranches} from './options.ts';
import {rules} from '../../rules/execution.ts';
import {adventures} from "../../rules/adventures.ts";
import {resources} from "../../rules/resources.ts";
import {random} from "../../rules/random.ts";
import {potions} from "../../rules/potions.ts";
import {cardInstances} from "../../rules/card-instances.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {relics,type RelicDefinition} from "../../rules/relics.ts";
import {adventureEventUtils} from "./utils.ts";
import {eventId as e} from "../../identifiers.ts";
import type {RelicTier} from "../../rules/adventures.types.ts";
import type {AdventureChoiceExports} from "../../rules/adventure-choices.ts";
import type {createAdventureAcquisition} from "../relics/acquisition.ts";
import type {createAdventureLoot} from "../rewards/loot.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query,despawnEntity}=rules;
export function createSelectionAdventureEvents(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>,loot:ReturnType<typeof createAdventureLoot>){return defineRules({requires:[ui,acquisition,loot,adventureEventUtils],build(){
  const programs:Partial<Record<number,rules.Effect<number,void>>>={};
  const run=(v:rules.ReadView<number>)=>v.query(adventures.exports.bindings,v.input);
  const leave=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:b.read(v=>v.query(adventures.exports.position,v.input).hasContinuation)}));
  const randomRelic=defineEffect<number,RelicDefinition>(b=>{const tier=b.local<RelicTier>(),relic=b.local<RelicDefinition>();return sequence(b.assign(tier,call(loot.exports.tier,{run:b.input,elite:false})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier,shop:false,front:true,screenless:true})),b.return(relic));});
  programs[e.NLOTH]=defineEffect<number,void>(b=>{
    const order=b.local<readonly number[]>(),gift='NLOTHS_GIFT' as const,offers=2;
    return sequence(b.assign(order,random.exports.shuffle({stream:b.read(v=>run(v).streams.misc),items:b.read(v=>v.query(relics.exports.owned,run(v).actor))})),eventBranches(b,ui,[
      ...Array.from({length:offers},(_,id)=>({id,text:(v:rules.ReadView<number>)=>`献出${v.query(relics.exports.view,v.get(order)[id]!).id}，获得${gift}`,execute:sequence(despawnEntity({entity:b.read(v=>v.get(order)[id]!),reason:{sacrificed:true}}),call(acquisition.exports.give,{run:b.input,definition:query(adventures.exports.relic,{run:b.input,id:gift})}))})),
      {id:offers,text:'离开',execute:sequence()},
    ]),call(leave,b.input));
  });
  programs[e.FALLING]=defineEffect<number,void>(b=>{
    const indices=b.local<number[]>(),index=b.local<number>(),group=b.local<number[]>(),types=[0,1,2],optionTypes=[1,2,0];
    const selected=(v:rules.ReadView<number>,type:number)=>v.query(permanentDecks.exports.current,run(v).deck).cards[v.get(indices)[type]!]!;
    return sequence(b.assign(indices,types.map(()=>-1)),forEach(types,type=>sequence(b.assign(group,b.read(v=>v.query(permanentDecks.exports.current,run(v).deck).cards.flatMap((card,index)=>v.query(cardInstances.exports.metadata,card).type===v.get(type)?[index]:[]))),when(b.read(v=>v.get(group).length>0),sequence(b.assign(index,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:0,end:b.read(v=>v.get(group).length-1)})),b.assign(indices,b.read(v=>v.get(indices).map((n,i)=>i===v.get(type)?v.get(group)[v.get(index)]!:n))))))),eventBranches(b,ui,[
      ...optionTypes.map((type,id)=>({id,allowed:(v:rules.ReadView<number>)=>v.get(indices)[type]!==-1,text:(v:rules.ReadView<number>)=>`失去${v.query(cardInstances.exports.metadata,selected(v,type)).name}`,execute:call(permanentDecks.exports.remove,{deck:b.read(v=>run(v).deck),card:b.read(v=>selected(v,type))})})),
      {id:optionTypes.length,allowed:v=>v.get(indices).every(index=>index===-1),text:'没有可失去的牌，离开',execute:sequence()},
    ]),call(leave,b.input));
  });
  programs[e.WING_STATUE]=defineEffect<number,void>(b=>{
    const damage=7,goldRange=[50,80],removeCount=1,gold=b.local<number>();
    return sequence(eventBranches(b,ui,[
      {id:0,text:`受到${damage}伤害并移除${removeCount}张牌`,execute:sequence(call(adventureEventUtils.exports.hurt,{run:b.input,amount:damage,direct:false}),call(acquisition.exports.selections.exports.select,{run:b.input,type:4,count:removeCount,provided:null,stream:b.read(v=>run(v).streams.misc)}))},
      {id:1,allowed:v=>v.query(permanentDecks.exports.current,run(v).deck).cards.some(card=>{const c=v.query(cardInstances.exports.current,card),m=v.query(cardInstances.exports.metadata,card);return m.variants[c.upgraded?1:0].damage>=10;}),text:`获得${goldRange[0]}–${goldRange[1]}金币`,execute:sequence(b.assign(gold,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:goldRange[0]!,end:goldRange[1]!})),call(resources.exports.gainGold,{entity:b.read(v=>run(v).actor),amount:gold}))},
      {id:2,text:'离开',execute:sequence()},
    ]),call(leave,b.input));
  });
  programs[e.WE_MEET_AGAIN]=defineEffect<number,void>(b=>{const potionIndices=b.local<readonly number[]>(),potionIndex=b.local<number>(),gold=b.local<number>(),cardIndices=b.local<readonly number[]>(),cardIndex=b.local<number>(),relic=b.local<RelicDefinition>();return sequence(
    b.assign(potionIndex,-1),b.assign(potionIndices,b.read(v=>{const inventory=v.query(potions.exports.current,run(v).potions);return inventory.slots.slice(0,inventory.capacity).flatMap((p,index)=>p===1?[]:[index]);})),when(b.read(v=>v.get(potionIndices).length>0),sequence(b.assign(potionIndices,random.exports.shuffle({stream:b.read(v=>run(v).streams.misc),items:potionIndices,counted:false})),b.assign(potionIndex,b.read(v=>v.get(potionIndices)[0]!)))),
    b.assign(gold,-1),when(b.read(v=>v.query(resources.exports.wealth,run(v).actor).gold>=50),b.assign(gold,call(random.exports.int,{stream:b.read(v=>run(v).streams.misc),start:50,end:b.read(v=>Math.min(150,v.query(resources.exports.wealth,run(v).actor).gold))}))),
    b.assign(cardIndex,-1),b.assign(cardIndices,b.read(v=>v.query(permanentDecks.exports.current,run(v).deck).cards.flatMap((card,index)=>{const m=v.query(cardInstances.exports.metadata,card);return m.rarity!==3&&m.type!==3?[index]:[];}))),when(b.read(v=>v.get(cardIndices).length>0),sequence(b.assign(cardIndices,random.exports.shuffle({stream:b.read(v=>run(v).streams.misc),items:cardIndices})),b.assign(cardIndex,b.read(v=>{const deck=v.query(permanentDecks.exports.current,run(v).deck),at=v.get(cardIndices)[0]!,selected=deck.cards[at]!,state=v.query(cardInstances.exports.current,selected),definition=v.get(rules.definitionOf(cardInstances.exports.kind,selected));return deck.cards.findIndex((card,index)=>index<=at&&v.query(cardInstances.exports.matchesDefinition,{entity:card,definition})&&v.query(cardInstances.exports.current,card).upgraded===state.upgraded&&v.query(cardInstances.exports.current,card).specialData===state.specialData);})))),
    eventBranches(b,ui,[
      {id:0,allowed:v=>v.get(potionIndex)>=0,text:v=>`献出药水槽${v.get(potionIndex)}的药水，获得随机遗物`,execute:sequence(call(potions.exports.remove,{inventory:b.read(v=>run(v).potions),index:potionIndex}),b.assign(relic,call(randomRelic,b.input)),call(acquisition.exports.give,{run:b.input,definition:relic}))},
      {id:1,allowed:v=>v.get(gold)>=0,text:v=>`支付${v.get(gold)}金币，获得随机遗物`,execute:sequence(call(resources.exports.spendGold,{entity:b.read(v=>run(v).actor),amount:gold}),b.assign(relic,call(randomRelic,b.input)),call(acquisition.exports.give,{run:b.input,definition:relic}))},
      {id:2,allowed:v=>v.get(cardIndex)>=0,text:v=>`献出${v.query(cardInstances.exports.metadata,v.query(permanentDecks.exports.current,run(v).deck).cards[v.get(cardIndex)]!).name}，获得随机遗物`,execute:sequence(call(permanentDecks.exports.remove,{deck:b.read(v=>run(v).deck),card:b.read(v=>v.query(permanentDecks.exports.current,run(v).deck).cards[v.get(cardIndex)]!)}),b.assign(relic,call(randomRelic,b.input)),call(acquisition.exports.give,{run:b.input,definition:relic}))},
      {id:3,text:'离开',execute:sequence()},
    ]),call(leave,b.input),
  );});
  return{exports:{programs}};
}});}
