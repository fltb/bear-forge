import {z} from 'zod';
import {linkRules} from '@bear-forge/card-engine';
import {rules} from '../src/rules/execution.ts';
import {adventureProgram,adventureContent} from '../src/program/adventure.ts';
import {adventureStart} from '../src/program/start.ts';
import {adventures} from '../src/rules/adventures.ts';
import {rooms,type RoomDefinition} from '../src/rules/rooms.ts';
import type {Room} from '../src/map.types.ts';
import {resources} from '../src/rules/resources.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {stsPorts} from '../src/adapters/ports.ts';
import {detailEvents} from '../src/adapters/detail-events.ts';
import {programSchemas,type Frame,type Ports} from '../src/game.schemas.ts';
import {eventId} from '../src/identifiers.ts';
const setup=programSchemas.setup.extend({room:z.enum(['SHOP','REST','EVENT'])});
type Setup=z.infer<typeof setup>;
const fixture=rules.defineRules({requires:[adventureProgram,detailEvents],build(){
  const entry=rules.defineEffect<Setup,Frame>(b=>{
    const run=b.local<number>(),catalog=b.local<{key:Room;definition:RoomDefinition}[]>();
    return rules.sequence(
      b.assign(catalog,adventureContent.rooms.exports.definitions),
      b.assign(run,rules.call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
      rules.call(resources.exports.gainGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).actor),amount:1000}),
      rules.call(stsPorts.exports.initialize,run),rules.call(detailEvents.exports.initialize,run),
      rules.call(adventures.exports.setRoom,{run,room:b.read(v=>v.input.room),event:eventId.UPGRADE_SHRINE}),
      rules.spawnEntity({kind:rooms.exports.kind,definition:b.read(v=>v.get(catalog).find(r=>r.key===v.input.room)!.definition),owner:run,scope:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).scope),setup:{run}}),
      b.return(rules.query(stsPorts.exports.frame,{run,actions:[],selection:null})),
    );
  });return {exports:{entry}};
}});
/** Content fixture only: original owner construction and original room programs. */
export const simulatorRoomDefinition=linkRules<{},Setup,Ports,Frame>({id:'sts/simulator-room-fixture',schemas:{...programSchemas,setup},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
