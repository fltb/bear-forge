import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {adventureProgram,adventureContent} from '../src/content/adventure-program.ts';
import {adventureStart} from '../src/content/adventure-start.ts';
import {combatProgram} from '../src/content/combat-program.ts';
import {stsPorts} from '../src/content/sts-ports.ts';
import {adventures} from '../src/rules/adventures.ts';
import {resources} from '../src/rules/resources.ts';
import {potions} from '../src/rules/potions.ts';
import {programSchemas,type Ports,type Frame} from '../src/game.schemas.ts';
import {potionId,type RelicId} from '../src/identifiers.ts';

const {defineRules,defineEffect,sequence,when,forEach,call,query}=rules;
const setupSchema=programSchemas.setup.extend({
  encounter:z.int32(),relics:z.array(z.custom<RelicId>()),potion:z.int32().nullable(),
  durable:z.boolean(),elite:z.boolean(),
});
export type CombatContentCase=z.infer<typeof setupSchema>;
const fixture=defineRules({requires:[adventureProgram],build(){
  const entry=defineEffect<CombatContentCase,Frame>(b=>{
    const run=b.local<number>();
    const state=(v:rules.ReadView<CombatContentCase>)=>v.get(query(adventures.exports.current,v.get(run)));
    return sequence(
      b.assign(run,call(adventureStart.exports.initialize,{setup:b.read(v=>({seed:v.input.seed})),catalog:{cards:adventureContent.cards.exports.definitions,relics:adventureContent.acquisition.exports.definitions}})),
      when(b.read(v=>v.input.durable),call(resources.exports.setHealth,{entity:b.read(v=>state(v).actor),hp:9990,maxHp:10000})),
      when(b.read(v=>v.input.potion===potionId.FAIRY_POTION||v.input.relics.includes('LIZARD_TAIL')),call(resources.exports.setHealth,{entity:b.read(v=>state(v).actor),hp:1,maxHp:80})),
      forEach(b.read(v=>v.input.relics),id=>call(adventureContent.acquisition.exports.give,{run,definition:query(adventures.exports.relic,{run,id})})),
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
