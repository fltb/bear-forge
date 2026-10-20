import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {adventureProgram,adventureContent} from '../src/content/adventure-program.ts';
import {adventureStart} from '../src/content/adventure-start.ts';
import {stsPorts} from '../src/content/sts-ports.ts';
import {adventurePotions} from '../src/content/adventure-potions.ts';
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {rooms,type RoomDefinition} from '../src/rules/rooms.ts';
import type {Room} from '../src/map.types.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import type {RelicId} from '../src/identifiers.ts';

const {defineRules,defineEffect,sequence,when,forEach,call,query,spawnEntity,despawnEntity}=rules;
const setupSchema=programSchemas.setup.extend({event:z.int32().nullable(),relic:z.custom<RelicId>().nullable()});
export type AdventureContentCase=z.infer<typeof setupSchema>;
const fixture=defineRules({requires:[adventureProgram],build(){
  const entry=defineEffect<AdventureContentCase,Frame>(b=>{
    const run=b.local<number>(),room=b.local<number>(),catalog=b.local<{key:Room;definition:RoomDefinition}[]>();
    const state=(v:rules.ReadView<AdventureContentCase>)=>v.get(query(adventures.exports.current,v.get(run)));
    return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),catalog:{cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions}})),
      b.assign(catalog,adventureContent.rooms.exports.definitions),call(resources.exports.setHealth,{entity:b.read(v=>state(v).actor),hp:490,maxHp:500}),
      call(resources.exports.gainGold,{entity:b.read(v=>state(v).actor),amount:b.read(v=>1000-v.get(query(resources.exports.current,state(v).actor)).gold)}),
      forEach(['BARRICADE','REGRET'] as const,id=>call(permanentDecks.exports.obtain,{deck:b.read(v=>state(v).deck),definition:query(adventures.exports.card,{run,id}),upgraded:false,specialData:0,count:1,upgrade:false})),
      call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true}),call(stsPorts.exports.initialize,run),call(adventurePotions.exports.initialize,run),
      when(b.read(v=>v.input.event!==null),forEach(['GOLDEN_IDOL','CIRCLET'] as const,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})}))),
      when(b.read(v=>v.input.relic!==null),call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id:b.read(v=>v.input.relic!)})})),
      when(b.read(v=>v.input.event!==null),sequence(call(adventures.exports.setRoom,{run,room:'EVENT',event:b.read(v=>v.input.event!)}),call(adventureContent.events.exports.open,run))),
      when(b.read(v=>v.input.event===null),call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true})),
      when(b.read(v=>v.input.event!==null&&state(v).room!=='EVENT'&&state(v).screen!=='MAP_SCREEN'&&v.get(query(resources.exports.current,state(v).actor)).hp>0),sequence(
        b.assign(room,spawnEntity({kind:rooms.exports.kind,definition:b.read(v=>{const definition=v.get(catalog).find(entry=>entry.key===state(v).room)?.definition;if(!definition)throw Error('Missing follow-up room');return definition;}),owner:run,scope:b.read(v=>state(v).scope),setup:{run}})),
        despawnEntity({entity:room,reason:{roomComplete:true}}),
      )),
      when(b.read(v=>v.get(query(resources.exports.current,state(v).actor)).hp===0),call(adventures.exports.setOutcome,{run,outcome:0})),
      b.return(query(stsPorts.exports.frame,{run,actions:[],selection:null})),
    );
  });
  return{exports:{entry}};
}});
export const adventureContentDefinition=linkRules<{},AdventureContentCase,Ports,Frame>({id:'sts/adventure-content-cases',schemas:{...programSchemas,setup:setupSchema},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
