import {rules} from '@bear-forge/card-engine';
import {adventures} from '../rules/adventures.ts';
import {ironcladStart} from './ironclad-start.ts';
import {eventId} from '../identifiers.ts';
import * as pools from '../pools.ts';
import type {Setup} from '../game.schemas.ts';
import type {AdventureCatalog,AdventureSeed} from '../rules/adventures.types.ts';
export const adventureStart=rules.defineRules({requires:[adventures,ironcladStart],build(){
  const definition=rules.defineEntity(adventures.exports.kind,undefined);
  const initialize=rules.defineEffect<{setup:Setup;catalog:AdventureCatalog},number>(b=>{const start=b.local<AdventureSeed>(),run=b.local<number>();return rules.sequence(b.assign(start,rules.call(ironcladStart.exports.initialize,b.read(v=>v.input.setup))),b.assign(run,rules.spawnEntity({definition,owner:b.read(v=>v.get(start).actor),scope:0,setup:{start,catalog:b.read(v=>v.input.catalog),initial:{event:eventId.NEOW,eventList:[...pools.act1Events],shrineList:[...pools.act1Shrines],oneTimeEvents:[...pools.oneTimeEventsAsc15],colorlessPool:[...pools.colorlessPool],note:'IRON_WAVE'}}})),b.return(run));});
  return{exports:{initialize}};
}});
