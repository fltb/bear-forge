import {z} from 'zod';
import {linkRules} from '@bear-forge/card-engine';
import {rules} from '../src/rules/execution.ts';
import {adventures,emptyAdventureRewards} from '../src/rules/adventures.ts';
import {rooms} from '../src/rules/rooms.ts';
import {resources} from '../src/rules/resources.ts';
import {adventureStart} from '../src/program/start.ts';
import {adventureContent} from '../src/program/adventure.ts';
import {adventureProgression} from '../src/program/progression.ts';
import {volibearAdventureCatalog} from '../src/program/volibear.ts';
import {volibearContent} from '../src/program/volibear-content.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {mapRelics} from '../src/content/relics/common/map.ts';
import {stsPorts,adventureChoices} from '../src/adapters/ports.ts';
import {detailEvents} from '../src/adapters/detail-events.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import type {RelicId} from '../src/identifiers.ts';
import {withStsProbabilityTracking} from '../src/search/tracking.ts';

const schema=programSchemas.setup.extend({
  mode:z.enum(['room','relic','keys','transition','neow']),act:z.number().int().min(1).max(4).default(1),
  room:z.enum(['REST','SHOP','TREASURE','EVENT']).default('REST'),event:z.number().int().default(0),
  owned:z.array(z.custom<RelicId>()).default([]),relic:z.custom<RelicId>().default('ASTROLABE'),
});
export type WindowSetup=z.infer<typeof schema>;
const {defineEffect,sequence,call,query,when,forEach}=rules;
// Owner-level entry only. Every room, selection, acquisition, act transition,
// port and settlement is the original linked definition. No historical route.
const module=rules.defineRules({requires:[stsPorts,adventureContent.cards,adventureStart,adventureContent.rooms,adventureContent.acquisition,adventureContent.neow,
  adventureChoices,mapRelics,detailEvents,adventureProgression,volibearContent.start,volibearContent.cards,volibearContent.hearts,volibearContent.history],build(){
  const ironclad={starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions};
  const entry=defineEffect<WindowSetup,Frame>(b=>{const run=b.local<number>(),room=b.local<number>(),catalog=b.local<typeof adventureContent.rooms.exports.definitions>();return sequence(
    when(b.read(v=>v.input.character==='volibear'),sequence(
      b.assign(run,call(volibearContent.start.exports.initialize,{setup:b.read(v=>({seed:v.input.seed,character:v.input.character,detailedEvents:v.input.detailedEvents})),definition:rules.defineEntity(adventures.exports.kind,volibearAdventureCatalog)})),call(volibearContent.history.exports.initialize,run),
    ),b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed,character:v.input.character,detailedEvents:v.input.detailedEvents})),definition:rules.defineEntity(adventures.exports.kind,ironclad)}))),
    b.assign(catalog,adventureContent.rooms.exports.definitions),call(stsPorts.exports.initialize,run),call(detailEvents.exports.initialize,run),
    forEach(b.read(v=>Array.from({length:v.input.act-1})),()=>call(adventureProgression.exports.nextAct,run)),
    call(resources.exports.gainGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).actor),amount:2000}),
    forEach(b.read(v=>v.input.owned),id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
    when(b.read(v=>v.input.mode==='room'),sequence(
      call(adventures.exports.setRoom,{run,room:b.read(v=>v.input.room),event:b.read(v=>v.input.event)}),
      b.assign(room,rules.spawnEntity({kind:rooms.exports.kind,definition:b.read(v=>v.get(catalog).find(row=>row.key===v.input.room)!.definition),owner:run,scope:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).scope),setup:{run}})),
      rules.despawnEntity({entity:room,reason:{roomComplete:true}}),
    )),
    when(b.read(v=>v.input.mode==='relic'),call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id:b.read(v=>v.input.relic)})})),
    when(b.read(v=>v.input.mode==='keys'),sequence(
      call(adventures.exports.setRewards,{run,rewards:{...emptyAdventureRewards(),emeraldKey:true,sapphireKey:true,relics:[query(adventures.exports.relic,{run,id:'ANCHOR'})]}}),call(adventureContent.acquisition.exports.rewards,run),
    )),
    when(b.read(v=>v.input.mode==='neow'),call(adventureContent.neow.exports.choose,run)),
    when(b.read(v=>v.input.mode==='transition'),sequence(
      call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true}),call(adventureChoices.exports.choose,{run,actions:query(mapRelics.exports.options,run)}),call(adventureProgression.exports.nextAct,run),
    )),
    call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true}),
    call(adventureChoices.exports.choose,{run,actions:query(mapRelics.exports.options,run)}),
    b.return(query(stsPorts.exports.frame,{run,actions:[],selection:null})),
  );});return{exports:{entry}};
}});
export const searchWindowsDefinition=withStsProbabilityTracking(linkRules<{},WindowSetup,Ports,Frame>({id:'sts/search-original-windows',schemas:{...programSchemas,setup:schema},initialize:()=>({}),entry:module.exports.entry,definitions:[module.exports.entry],modules:[module]}));
