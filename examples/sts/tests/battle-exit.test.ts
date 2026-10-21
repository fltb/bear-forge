import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,ruleModules,linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {ironcladStart} from "../src/content/characters/ironclad/start.ts";
import type {IroncladStart} from "../src/content/characters/ironclad/start.types.ts";
import {resources} from '../src/rules/resources.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {cardInstances} from '../src/rules/card-instances.ts';
import {battles} from '../src/rules/battles.ts';
import {adventures} from '../src/rules/adventures.ts';
import {powers} from '../src/rules/powers.ts';
import {cardPiles} from '../src/rules/card-piles.ts';
import {zones} from '../src/rules/zones.ts';
import {combatScope} from '../src/rules/combat-actions.ts';
import {SetupSchema,type Setup} from '../src/game.schemas.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineRules,defineEntity,defineEffect,sequence,call,query,spawnEntity}=rules;
const fixture=defineRules({requires:[ironcladStart,adventures],build(){
  const targetDefinition=defineEntity(resources.exports.actor,{side:1}),registryDefinition=defineEntity(powers.exports.registryKind,undefined),battleDefinition=defineEntity(battles.exports.kind,undefined);
  const entry=defineEffect<Setup,unknown>(b=>{const start=b.local<IroncladStart>(),scope=b.local<number>(),target=b.local<number>(),registry=b.local<number>(),battle=b.local<number>(),master=b.local<number>(),card=b.local<number>(),before=b.local<boolean>(),after=b.local<boolean>();return sequence(
    b.assign(start,call(ironcladStart.exports.initialize,b.input)),b.assign(scope,ruleModules.openScope(combatScope,0)),b.assign(target,spawnEntity({definition:targetDefinition,owner:null,scope,setup:{hp:1,maxHp:1,block:0,energy:0,gold:0}})),b.assign(registry,spawnEntity({definition:registryDefinition,owner:b.read(v=>v.get(start).actor),scope})),
    call(resources.exports.rechargeEnergy,{entity:b.read(v=>v.get(start).actor),amount:3}),b.assign(battle,spawnEntity({definition:battleDefinition,owner:b.read(v=>v.get(start).actor),scope,setup:{actor:b.read(v=>v.get(start).actor),registry,enemies:[target],masters:b.read(v=>v.get(query(permanentDecks.exports.current,v.get(start).deck)).cards),bottled:[],shuffleRng:b.read(v=>v.get(start).streams.shuffle),cardRng:b.read(v=>v.get(start).streams.cardRandom),drawPerTurn:5}})),
    call(cardPiles.exports.draw,{piles:b.read(v=>v.get(query(battles.exports.current,v.get(battle))).piles),count:10}),b.assign(master,b.read(v=>v.get(query(permanentDecks.exports.current,v.get(start).deck)).cards[1]!)),b.assign(before,query(cardInstances.exports.hasCombatCopies,master)),
    b.assign(card,b.read(v=>{const board=v.get(query(battles.exports.current,v.get(battle))),p=v.get(query(cardPiles.exports.current,board.piles)),card=v.get(query(zones.exports.members,p.hand)).find(id=>v.get(query(cardInstances.exports.metadata,id)).type===0);if(card===undefined)throw Error('Expected a starter attack');return card;})),call(battles.exports.queueFromHand,{battle,card,target}),call(battles.exports.settle,battle),call(battles.exports.close,battle),call(adventures.exports.notifyCombatFinished,{run:b.read(v=>v.get(start).actor),battle,actor:b.read(v=>v.get(start).actor),outcome:1}),
    b.assign(after,query(cardInstances.exports.hasCombatCopies,master)),call(permanentDecks.exports.remove,{deck:b.read(v=>v.get(start).deck),card:master}),b.return(b.read(v=>{const actor=v.get(query(resources.exports.current,v.get(start).actor));return{before:v.get(before),after:v.get(after),hp:actor.hp,maxHp:actor.maxHp,gold:actor.gold,...v.get(query(permanentDecks.exports.view,v.get(start).deck))};})),
  );});return{exports:{entry}};
}});
const definition=linkRules({id:'sts/persistent-battle-exit-1',schemas:{setup:SetupSchema,result:z.unknown(),ports:{}},initialize:()=>({}),entry:fixture.exports.entry,definitions:[fixture.exports.entry],modules:[fixture]});
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
test('battle exit applies persistent Burning Blood once, destroys combat copies and permits later permanent removal without HP/deck copying',async()=>{
  const reference=await ReferenceClient.create();
  try{const expected=await reference.call({op:'battle-exit-case',seed:'130'});for(const controlled of [false,true]){const loaded=unwrap(await createCardLoader({controlled}).load(definition)),instance=unwrap(await loaded.core.start({seed:'130'}));
    try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Battle exit failed');assertSameState({before:true,after:false,...expected},stop.result,`persistent battle exit controlled=${controlled}`);}
    finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
  }}finally{await reference.close();}
});
