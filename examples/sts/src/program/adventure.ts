import {createSelectionCards} from "../content/characters/ironclad/cards/deck-order.ts";
import {createColorlessSelectionCards} from "../content/cards/colorless/thinking-ahead.ts";
import {rules} from '@bear-forge/card-engine';
import {adventures} from "../rules/adventures.ts";
import {rooms,type RoomDefinition} from "../rules/rooms.ts";
import {resources} from "../rules/resources.ts";
import {adventureStart} from "./start.ts";
import {adventureProgression} from "./progression.ts";
import {revival} from "./revival.ts";
import {adventurePotions} from "../content/potions/adventure.ts";
import {stsPorts,adventureChoices,combatChoices,combatSelectionUtils} from "../adapters/ports.ts";
import {createCardCatalog} from "../content/cards/catalog.ts";
import {createAdventureAcquisition} from "../content/relics/acquisition.ts";
import {createNeowChoices} from "../content/events/neow/choices.ts";
import {createMerchant} from "../content/rooms/shop.ts";
import {createAdventureEvents} from "../content/events/catalog.ts";
import {createAdventureRooms} from "../content/rooms/definitions.ts";
import {nodeAt} from "../map.ts";
import {eventId} from "../identifiers.ts";
import type {Room} from "../map.types.ts";
import type {Setup,Frame} from "../game.schemas.ts";
const {defineRules,defineEffect,sequence,whileDo,when,call,query,spawnEntity,despawnEntity}=rules;

const selectionCards=createSelectionCards(combatChoices),colorlessSelectionCards=createColorlessSelectionCards(combatChoices),cards=createCardCatalog(selectionCards,colorlessSelectionCards,combatChoices,combatSelectionUtils),acquisition=createAdventureAcquisition(adventureChoices,combatSelectionUtils),neow=createNeowChoices(adventureChoices,acquisition),merchant=createMerchant(adventureChoices,acquisition),events=createAdventureEvents(adventureChoices,acquisition),roomPrograms=createAdventureRooms(adventureChoices,acquisition,merchant,events);
/** Static author compositions, reused by owner-level fixtures without another implementation. */
export const adventureContent={cards,acquisition,neow,merchant,events,rooms:roomPrograms};

/** The sole game root: typed calls own every continuation, including nested content windows. */
export const adventureProgram=defineRules({requires:[adventureStart,adventureProgression,adventurePotions,revival,stsPorts,cards,neow,roomPrograms],build(){
  const run=defineEffect<Setup,Frame>(b=>{const game=b.local<number>(),catalog=b.local<{key:Room;definition:RoomDefinition}[]>(),x=b.local<number>(),room=b.local<number>(),dispatched=b.local<Room>(),followup=b.local<boolean>();return sequence(
    b.assign(game,call(adventureStart.exports.initialize,{setup:b.input,catalog:{cards:cards.exports.definitions,relics:acquisition.exports.definitions}})),b.assign(catalog,roomPrograms.exports.definitions),call(stsPorts.exports.initialize,game),call(adventurePotions.exports.initialize,game),call(revival.exports.initialize,game),call(neow.exports.choose,game),
    whileDo(b.read(v=>v.get(query(adventures.exports.current,v.get(game))).outcome===1),sequence(
      b.assign(x,call(adventureChoices.exports.choose,{run:game,actions:b.read(v=>{const s=v.get(query(adventures.exports.current,v.get(game)));if(s.y===14)return[0];if(s.y===-1)return Array.from({length:7},(_,x)=>x).filter(x=>nodeAt(s.map,x,0).edges.length>0);return nodeAt(s.map,s.x,s.y).edges;})})),
      call(adventures.exports.arrive,b.read(v=>{const s=v.get(query(adventures.exports.current,v.get(game))),nextX=v.get(x)&255,y=s.y+1;return{run:v.get(game),x:nextX,y,room:y===15?'BOSS' as const:nodeAt(s.map,nextX,y).room,event:eventId.INVALID};})),call(adventureProgression.exports.reseedFloor,game),call(adventures.exports.notifyEntered,{run:game,room:b.read(v=>v.get(query(adventures.exports.current,v.get(game))).room)}),
      when(b.read(v=>v.get(query(adventures.exports.current,v.get(game))).room==='EVENT'),call(roomPrograms.exports.resolveEvent,game)),
      b.assign(followup,true),whileDo(followup,sequence(b.assign(dispatched,b.read(v=>v.get(query(adventures.exports.current,v.get(game))).room)),b.assign(room,spawnEntity({kind:rooms.exports.kind,definition:b.read(v=>{const current=v.get(query(adventures.exports.current,v.get(game))).room,entry=v.get(catalog).find(entry=>entry.key===current);if(!entry)throw Error('Room content is not installed: '+current);return entry.definition;}),owner:game,scope:b.read(v=>v.get(query(adventures.exports.current,v.get(game))).scope),setup:{run:game}})),despawnEntity({entity:room,reason:{roomComplete:true}}),b.assign(followup,b.read(v=>{const s=v.get(query(adventures.exports.current,v.get(game)));return s.outcome===1&&s.screen!=='MAP_SCREEN'&&s.room!==v.get(dispatched)&&v.get(query(resources.exports.current,s.actor)).hp>0;})))),
      when(b.read(v=>v.get(query(resources.exports.current,v.get(query(adventures.exports.current,v.get(game))).actor)).hp===0),call(adventures.exports.setOutcome,{run:game,outcome:0})),
    )),call(stsPorts.exports.flush,game),b.return(query(stsPorts.exports.frame,{run:game,actions:[],selection:null})),
  );});
  return{exports:{run}};
}});
