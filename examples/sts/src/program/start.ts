import {rules} from '@bear-forge/card-engine';
import {adventures} from "../rules/adventures.ts";
import {ironcladStart} from "../content/characters/ironclad/start.ts";
import {eventId} from "../identifiers.ts";
import * as pools from "../pools.ts";
import type {Setup} from "../game.schemas.ts";
import type {AdventureCatalog,AdventureSetup,AdventureSeed} from "../rules/adventures.types.ts";
export const adventureStart=rules.defineRules({requires:[adventures,ironcladStart],build(){
  const initialize=rules.defineEffect<{setup:Setup;definition:rules.EntityDefinition<AdventureCatalog,AdventureSetup>},number>(b=>{const start=b.local<AdventureSeed>(),run=b.local<number>();return rules.sequence(b.assign(start,rules.call(ironcladStart.exports.initialize,b.read(v=>v.input.setup))),b.assign(run,rules.spawnEntity({kind:adventures.exports.kind,definition:b.read(v=>v.input.definition),owner:b.read(v=>v.get(start).actor),scope:0,setup:{start,initial:{event:eventId.NEOW,eventList:[...pools.act1Events],shrineList:[...pools.act1Shrines],oneTimeEvents:[...pools.oneTimeEventsAsc15],colorlessPool:[...pools.colorlessPool],note:'IRON_WAVE'}}})),b.return(run));});
  return{exports:{initialize}};
}});
