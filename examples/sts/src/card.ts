import {linkRules} from '@bear-forge/card-engine';
import type {Setup,Ports,Frame} from './game.schemas.ts';
import {programSchemas} from './game.schemas.ts';
import {adventureProgram} from "./program/adventure.ts";

/** Shared Program plus one independent rules Context; native/controlled use this same definition. */
export const cardDefinition=linkRules<{},Setup,Ports,Frame>({
  id:'sts-lightspeed-7476a819/ironclad-a20/typed-rules-1',
  schemas:programSchemas,
  initialize:()=>({}),
  entry:adventureProgram.exports.run,
  definitions:[adventureProgram.exports.run],
  modules:[adventureProgram],
});
