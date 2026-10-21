import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {adventureStart} from "../src/program/start.ts";
import {adventureContent} from "../src/program/adventure.ts";
import {adventureViews} from "../src/adapters/adventure-views.ts";
import {adventures} from '../src/rules/adventures.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {resources} from '../src/rules/resources.ts';

import {programSchemas,GameViewSchema,type Setup,type Ports} from '../src/game.schemas.ts';
import type {CardId,RelicId} from '../src/identifiers.ts';
const {defineEffect,sequence,forEach,call,query}=rules;
export type DeckCaseStep={kind:'obtain';id:CardId;count?:number;upgraded?:boolean;misc?:number}|{kind:'remove'|'upgrade';index:number}|{kind:'upgrade-random';count:number}|{kind:'bottle';index:number;type:0|1|2};
type GameView=z.infer<typeof GameViewSchema>;
/** Normal construction followed only by explicit production owner operations. */
export function deckCaseFixture(steps:readonly DeckCaseStep[],owned:readonly RelicId[]){
  const entry=defineEffect<Setup,GameView[]>(b=>{
    const run=b.local<number>(),history=b.local<GameView[]>();
    const cardAt=(index:number)=>b.read(v=>{const s=v.get(query(adventures.exports.current,v.get(run))),card=v.get(query(permanentDecks.exports.current,s.deck)).cards[index];if(card===undefined)throw Error('Invalid deck case index');return card;});
    return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,catalog:{cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions}})),
      forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),b.assign(history,[query(adventureViews.exports.privateGame,run)]),
      ...steps.flatMap(step=>{
        const deck=b.read(v=>v.get(query(adventures.exports.current,v.get(run))).deck);
        const operation=step.kind==='obtain'?call(permanentDecks.exports.obtain,{deck,definition:query(adventures.exports.card,{run,id:step.id}),count:step.count??1,upgraded:step.upgraded??false,specialData:step.misc??0,upgrade:false}):step.kind==='remove'?call(permanentDecks.exports.remove,{deck,card:cardAt(step.index)}):step.kind==='upgrade'?call(permanentDecks.exports.upgrade,{deck,card:cardAt(step.index)}):step.kind==='bottle'?call(permanentDecks.exports.bottle,{deck,index:step.index,type:step.type}):call(permanentDecks.exports.upgradeRandom,{deck,stream:b.read(v=>v.get(query(adventures.exports.current,v.get(run))).streams.misc),count:step.kind==='upgrade-random'?step.count:0});
        return[operation,b.assign(history,b.read(v=>[...v.get(history),v.get(query(adventureViews.exports.privateGame,v.get(run)))]))];
      }),b.return(history),
    );
  });
  return linkRules<{},Setup,Ports,GameView[]>({id:'sts/adventure-deck-case',schemas:{...programSchemas,result:z.array(GameViewSchema)},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureStart,adventureContent.acquisition,adventureViews]});
}
export function shopCaseFixture(owned:readonly RelicId[]){
  const entry=defineEffect<Setup,GameView>(b=>{const run=b.local<number>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,catalog:{cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions}})),forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
    call(resources.exports.gainGold,{entity:b.read(v=>v.get(query(adventures.exports.current,v.get(run))).actor),amount:b.read(v=>10000-v.get(query(resources.exports.current,v.get(query(adventures.exports.current,v.get(run))).actor)).gold)}),call(adventures.exports.setRoom,{run,room:'SHOP',event:0}),call(adventures.exports.setScene,{run,screen:'SHOP_ROOM',continuation:true}),call(adventureContent.merchant.exports.open,run),b.return(query(adventureViews.exports.privateGame,run)),
  );});
  return linkRules<{},Setup,Ports,GameView>({id:'sts/adventure-shop-case',schemas:{...programSchemas,result:GameViewSchema},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureStart,adventureContent.acquisition,adventureContent.merchant,adventureViews]});
}

export function eventSamplingFixture(owned:readonly RelicId[],lastShops:readonly boolean[]){
  const entry=defineEffect<Setup,{outcomes:{room:string;event:number}[];state:GameView}>(b=>{const run=b.local<number>(),outcomes=b.local<{room:string;event:number}[]>();return sequence(
    b.assign(run,call(adventureStart.exports.initialize,{setup:b.input,catalog:{cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions}})),forEach(owned,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),b.assign(outcomes,[]),
    forEach(lastShops,lastRoomWasShop=>sequence(call(adventureContent.events.exports.sample,{run,lastRoomWasShop}),b.assign(outcomes,b.read(v=>{const s=v.get(query(adventures.exports.current,v.get(run)));return[...v.get(outcomes),{room:s.room,event:s.event}];})))),b.return({outcomes,state:query(adventureViews.exports.privateGame,run)}),
  );});
  return linkRules({id:'sts/adventure-event-sampling-case',schemas:{...programSchemas,result:z.object({outcomes:z.array(z.object({room:z.string(),event:z.int32()})),state:GameViewSchema})},initialize:()=>({}),entry,definitions:[entry],modules:[adventureContent.cards,adventureStart,adventureContent.acquisition,adventureContent.events,adventureViews]});
}
