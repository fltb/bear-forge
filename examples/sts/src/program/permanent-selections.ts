import {rules} from '@bear-forge/card-engine';
import {adventures} from "../rules/adventures.ts";
import {cardInstances} from "../rules/card-instances.ts";
import {permanentDecks} from "../rules/permanent-decks.ts";
import {adventureDraws} from "../content/rewards/draws.ts";
import {resources} from "../rules/resources.ts";
import {relics} from "../rules/relics.ts";
import type {AdventureChoiceExports} from "../rules/adventure-choices.ts";
import type {AdventureSelected,AdventureSelection,CardPreview} from "../rules/adventures.types.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query,definitionOf}=rules;
export type SelectionInput={run:number;type:number;count:number;provided:AdventureSelected[]|null;stream:number};
export function createPermanentSelections(ui:rules.RuleModule<AdventureChoiceExports>){return defineRules({requires:[ui,adventureDraws],build(){
  const prepare=defineEffect<SelectionInput,void>(b=>{const candidates=b.local<AdventureSelected[]>();return sequence(
    b.assign(candidates,b.read(v=>{if(v.input.provided!==null)return v.input.provided;const run=v.get(query(adventures.exports.current,v.input.run)),deck=v.get(query(permanentDecks.exports.current,run.deck));return deck.cards.flatMap((card,deckIndex)=>{const type=v.input.type,include=type===5||type===3&&v.get(query(cardInstances.exports.canUpgrade,card))||(type===1||type===4||type===8)&&v.get(query(cardInstances.exports.canTransform,card))&&!deck.bottles.includes(deckIndex)||type===2&&v.get(query(cardInstances.exports.canTransform,card));if(!include)return[];const c=v.get(query(cardInstances.exports.current,card));return[{card:{definition:v.get(definitionOf(cardInstances.exports.kind,card)),upgraded:c.upgraded,misc:c.specialData},deckIndex}];});})),
    call(adventures.exports.beginSelection,{run:b.read(v=>v.input.run),selection:{type:b.read(v=>v.input.type),count:b.read(v=>v.input.count),cards:candidates,selected:[],transformStream:b.read(v=>v.input.type===1?v.input.stream:v.get(query(adventures.exports.current,v.input.run)).selection.transformStream)}})
  );});
  const finish=defineEffect<{run:number},void>(b=>{const done=b.local<boolean>(),index=b.local<number>(),selected=b.local<AdventureSelection>(),transformed=b.local<CardPreview>();return sequence(
    when(b.read(v=>{const s=v.get(query(adventures.exports.current,v.input.run));return v.get(query(resources.exports.current,s.actor)).hp<=0||s.selection.cards.length===0||s.selection.count<=0;}),b.return(undefined)),b.assign(done,false),
    whileDo(b.read(v=>!v.get(done)),sequence(b.assign(index,call(ui.exports.choose,{run:b.read(v=>v.input.run),actions:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).selection.cards.map((_,i)=>i))})),b.assign(done,call(adventures.exports.acceptSelection,{run:b.read(v=>v.input.run),index:b.read(v=>v.get(index)&255)})))),b.assign(selected,b.read(v=>v.get(query(adventures.exports.current,v.input.run)).selection)),
    when(b.read(v=>[1,2,4].includes(v.get(selected).type)),sequence(
      forEach(b.read(v=>[...v.get(selected).selected].reverse()),picked=>call(permanentDecks.exports.remove,b.read(v=>{const deck=v.get(query(adventures.exports.current,v.input.run)).deck,cards=v.get(query(permanentDecks.exports.current,deck)).cards,card=cards[Math.min(v.get(picked).deckIndex,cards.length-1)];if(card===undefined)throw Error('Source permanent selection requires a remaining card');return{deck,card};}))),
      when(b.read(v=>v.get(selected).type!==4),forEach(b.read(v=>v.get(selected).selected),picked=>sequence(
        b.assign(transformed,call(adventureDraws.exports.transformed,{run:b.read(v=>v.input.run),card:b.read(v=>v.get(picked).card),stream:b.read(v=>v.get(selected).type===2?v.get(query(adventures.exports.current,v.input.run)).streams.misc:v.get(selected).transformStream),autoUpgrade:b.read(v=>v.get(selected).type===2)})),
        call(permanentDecks.exports.obtain,{deck:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).deck),definition:b.read(v=>v.get(transformed).definition),upgraded:b.read(v=>v.get(transformed).upgraded),specialData:b.read(v=>v.get(transformed).misc),count:1,upgrade:false}),
      ))),
      when(b.read(v=>v.get(selected).type===1),call(adventures.exports.setTransformStream,{run:b.read(v=>v.input.run),stream:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).streams.card)})),b.return(undefined),
    )),
    when(b.read(v=>v.get(selected).type===3),sequence(
      forEach(b.read(v=>v.get(selected).selected),picked=>call(permanentDecks.exports.upgrade,b.read(v=>{const deck=v.get(query(adventures.exports.current,v.input.run)).deck,card=v.get(query(permanentDecks.exports.current,deck)).cards[v.get(picked).deckIndex];if(card===undefined)throw Error('Upgrade index is no longer valid');return{deck,card};}))),b.return(undefined),
    )),
    when(b.read(v=>v.get(selected).type===5||v.get(selected).type===6),sequence(
      forEach(b.read(v=>v.get(selected).selected),picked=>call(permanentDecks.exports.obtain,{deck:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).deck),definition:b.read(v=>v.get(picked).card.definition),upgraded:b.read(v=>v.get(picked).card.upgraded),specialData:b.read(v=>v.get(picked).card.misc),count:1,upgrade:false})),b.return(undefined),
    )),
    when(b.read(v=>v.get(selected).type===7),sequence(
      call(permanentDecks.exports.bottle,b.read(v=>{const selected=v.get(query(adventures.exports.current,v.input.run)).selection.selected[0]!;const type=v.get(query(cardInstances.exports.definitionMetadata,selected.card.definition)).type;if(type<0||type>2)throw Error('Invalid bottled type');return{deck:v.get(query(adventures.exports.current,v.input.run)).deck,index:selected.deckIndex,type:type as 0|1|2};})),b.return(undefined),
    )),
    when(b.read(v=>v.get(selected).type===8),sequence(
      forEach(b.read(v=>v.get(selected).selected),picked=>sequence(
        when(b.read(v=>v.get(query(cardInstances.exports.definitionMetadata,v.get(picked).card.definition)).type===3),call(relics.exports.obtain,{actor:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).actor),definition:query(adventures.exports.relic,{run:b.read(v=>v.input.run),id:'SPIRIT_POOP'}),scope:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).scope)}),
          when(b.read(v=>v.get(query(cardInstances.exports.definitionMetadata,v.get(picked).card.definition)).rarity===2),sequence(call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).actor),amount:10}),call(resources.exports.heal,{entity:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).actor),amount:b.read(v=>v.get(query(resources.exports.current,v.get(query(adventures.exports.current,v.input.run)).actor)).maxHp)})),
            when(b.read(v=>v.get(query(cardInstances.exports.definitionMetadata,v.get(picked).card.definition)).rarity!==3),call(resources.exports.heal,{entity:b.read(v=>v.get(query(adventures.exports.current,v.input.run)).actor),amount:b.read(v=>v.get(query(cardInstances.exports.definitionMetadata,v.get(picked).card.definition)).rarity===1?10:5)})))),
        call(permanentDecks.exports.remove,b.read(v=>{const deck=v.get(query(adventures.exports.current,v.input.run)).deck;return{deck,card:v.get(query(permanentDecks.exports.current,deck)).cards[v.get(picked).deckIndex]!};})),
      )),b.return(undefined),
    )),
    b.return(b.read(()=>{throw Error('Permanent selection effect is not implemented');})),
  );});

  const select=defineEffect<SelectionInput,void>(b=>sequence(call(prepare,b.input),call(finish,{run:b.read(v=>v.input.run)})));
  return{exports:{prepare,finish,select}};
}});}
