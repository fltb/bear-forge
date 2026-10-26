import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {linkRules} from '@bear-forge/card-engine';
import {adventureProgram,adventureContent} from "../src/program/adventure.ts";
import {adventureStart} from "../src/program/start.ts";
import {stsPorts} from "../src/adapters/ports.ts";
import {adventurePotions} from "../src/content/potions/adventure.ts";
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {combatProgram} from '../src/program/combat.ts';
import {encounterId,potionId} from '../src/identifiers.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {rooms,type RoomDefinition} from '../src/rules/rooms.ts';
import type {Room} from '../src/map.types.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import type {RelicId} from '../src/identifiers.ts';

const {defineRules,defineEffect,sequence,when,forEach,call,query,spawnEntity,despawnEntity}=rules;
const setupSchema=programSchemas.setup.extend({event:z.int32().nullable(),relic:z.custom<RelicId>().nullable(),owned:z.array(z.custom<RelicId>()).optional(),copyCard:z.boolean().optional(),rewardRelic:z.boolean().optional(),emptyDeck:z.boolean().optional(),fightAfterReward:z.boolean().optional()});
export type AdventureContentCase=z.infer<typeof setupSchema>;
const fixture=defineRules({requires:[adventureProgram],build(){
  const entry=defineEffect<AdventureContentCase,Frame>(b=>{
    const run=b.local<number>(),room=b.local<number>(),catalog=b.local<{key:Room;definition:RoomDefinition}[]>();
    const state=(v:rules.ReadView<AdventureContentCase>)=>v.get(query(adventures.exports.current,v.get(run)));
    return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
      b.assign(catalog,adventureContent.rooms.exports.definitions),call(resources.exports.setHealth,{entity:b.read(v=>state(v).actor),hp:490,maxHp:500}),
      call(resources.exports.gainGold,{entity:b.read(v=>state(v).actor),amount:b.read(v=>1000-v.get(query(resources.exports.current,state(v).actor)).gold)}),
      forEach(['BARRICADE','REGRET'] as const,id=>call(permanentDecks.exports.obtain,{deck:b.read(v=>state(v).deck),definition:query(adventures.exports.card,{run,id}),upgraded:false,specialData:0,count:1,upgrade:false})),
      call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true}),call(stsPorts.exports.initialize,run),call(adventurePotions.exports.initialize,run),
      when(b.read(v=>v.input.event!==null),forEach(['GOLDEN_IDOL','CIRCLET'] as const,id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})}))),
      forEach(b.read(v=>v.input.owned??[]),id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
      when(b.read(v=>v.input.emptyDeck===true),forEach(b.read(v=>[...v.query(permanentDecks.exports.current,state(v).deck).cards].reverse()),card=>call(permanentDecks.exports.remove,{deck:b.read(v=>state(v).deck),card}))),
      when(b.read(v=>v.input.copyCard===true),sequence(call(permanentDecks.exports.obtain,{deck:b.read(v=>state(v).deck),definition:query(adventures.exports.card,{run,id:'SEARING_BLOW'}),upgraded:true,specialData:3,count:1,upgrade:false}),call(permanentDecks.exports.bottle,{deck:b.read(v=>state(v).deck),index:13,type:0}))),
      when(b.read(v=>v.input.relic!==null),when(b.read(v=>v.input.rewardRelic===true),sequence(call(adventures.exports.setRewards,{run,rewards:{gold:[17],cards:[[{definition:query(adventures.exports.card,{run,id:'BASH'}),upgraded:false,misc:0}]],potions:b.read(v=>v.input.fightAfterReward?[potionId.DEXTERITY_POTION]:[]),relics:[query(adventures.exports.relic,{run,id:b.read(v=>v.input.relic!)})],emeraldKey:false,sapphireKey:true}}),call(adventureContent.acquisition.exports.rewards,run)),call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id:b.read(v=>v.input.relic!)})}))),
      when(b.read(v=>v.input.event!==null),sequence(call(adventures.exports.setRoom,{run,room:'EVENT',event:b.read(v=>v.input.event!)}),call(adventureContent.events.exports.open,run))),
      when(b.read(v=>v.input.event===null),call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true})),
      when(b.read(v=>v.input.fightAfterReward===true),sequence(call(adventures.exports.setRoom,{run,room:'MONSTER',event:0}),call(combatProgram.exports.run,{run,encounter:encounterId.CULTIST}))),
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
