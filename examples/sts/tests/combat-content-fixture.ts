import {relics} from '../src/rules/relics.ts';
import {startingRelics} from '../src/content/characters/ironclad/relics/burning-blood.ts';
import {z} from 'zod';
import {rules} from '../src/rules/execution.ts';
import {linkRules} from '@bear-forge/card-engine';
import {adventureProgram,adventureContent} from "../src/program/adventure.ts";
import {adventureStart} from "../src/program/start.ts";
import {combatProgram} from "../src/program/combat.ts";
import {stsPorts} from "../src/adapters/ports.ts";
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {potions} from '../src/rules/potions.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import {potionId,type RelicId} from '../src/identifiers.ts';

const {defineRules,defineEffect,sequence,when,forEach,call,query}=rules;
const setupSchema=programSchemas.setup.extend({
  encounter:z.int32(),relics:z.array(z.custom<RelicId>()),potion:z.int32().nullable(),
  durable:z.boolean(),elite:z.boolean(),spentOmamori:z.int32().min(0).max(2).optional(),
});
export type CombatContentCase=z.infer<typeof setupSchema>;
const fixture=defineRules({requires:[adventureProgram],build(){
  const entry=defineEffect<CombatContentCase,Frame>(b=>{
    const run=b.local<number>();
    const state=(v:rules.ReadView<CombatContentCase>)=>v.get(query(adventures.exports.current,v.get(run)));
    return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),definition:rules.defineEntity(adventures.exports.kind,{starterRelic:startingRelics.exports.BurningBlood,cardPools:adventureContent.cards.exports.cardPools,cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions})})),
      when(b.read(v=>v.input.durable),call(resources.exports.setHealth,{entity:b.read(v=>state(v).actor),hp:9990,maxHp:10000})),
      when(b.read(v=>v.input.potion===potionId.FAIRY_POTION||v.input.relics.includes('LIZARD_TAIL')),call(resources.exports.setHealth,{entity:b.read(v=>state(v).actor),hp:1,maxHp:80})),
      forEach(b.read(v=>v.input.relics),id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
      forEach(b.read(v=>Array.from({length:v.input.spentOmamori??0})),()=>call(relics.exports.interact,b.read(v=>{const entity=v.query(relics.exports.find,{actor:state(v).actor,definition:v.query(adventures.exports.relic,{run:v.get(run),id:'OMAMORI'})});if(entity===null)throw Error('Missing Omamori');return entity;}))),
      when(b.read(v=>v.input.potion!==null),call(potions.exports.obtain,{inventory:b.read(v=>state(v).potions),potion:b.read(v=>v.input.potion!)})),
      call(adventures.exports.setRoom,{run,room:b.read(v=>v.input.elite?'ELITE':'MONSTER'),event:0}),
      call(stsPorts.exports.initialize,run),call(combatProgram.exports.run,{run,encounter:b.read(v=>v.input.encounter)}),
      call(adventures.exports.setScene,{run,screen:'MAP_SCREEN',continuation:true}),
      b.return(query(stsPorts.exports.frame,{run,actions:[],selection:null})),
    );
  });
  return{exports:{entry}};
}});
/** Explicit owner-level content setup; all play still uses the sole combat root. */
export const combatContentDefinition=linkRules<{},CombatContentCase,Ports,Frame>({id:'sts/combat-content-cases',schemas:{...programSchemas,setup:setupSchema},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
export const combatContentRules=fixture;
