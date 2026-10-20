import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {rules,linkRules} from '@bear-forge/card-engine';
import {createCardLoader} from '@bear-forge/runtime-card';
import {ironcladStart} from '../src/content/ironclad-start.ts';
import {resources} from '../src/rules/resources.ts';
import {random} from '../src/rules/random.ts';
import {permanentDecks} from '../src/rules/permanent-decks.ts';
import {relics} from '../src/rules/relics.ts';
import {SetupSchema,type Setup} from '../src/game.schemas.ts';
import type {IroncladStart,StartStream,RelicTier} from '../src/content/ironclad-start.types.ts';
import {relicId} from '../src/identifiers.ts';
import {neowDescriptions} from '../src/pools.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
const {defineRules,defineQuery,defineEffect,sequence,call,query}=rules;
const views=defineRules({requires:[ironcladStart],build(){return{exports:{view:defineQuery({input:z.custom<IroncladStart>(),output:z.unknown(),dependencies:[resources.exports.current,permanentDecks.exports.view,relics.exports.owned,relics.exports.view,random.exports.current],base(r,s){const player=r.query(resources.exports.current,s.actor);return{
  seed:s.seed.toString(),hp:player.hp,maxHp:player.maxHp,gold:player.gold,...r.query(permanentDecks.exports.view,s.deck),relics:r.query(relics.exports.owned,s.actor).map(id=>r.query(relics.exports.view,id)),map:s.map,monsterList:s.monsterList,eliteList:s.eliteList,boss:s.boss,secondBoss:s.secondBoss,
  rng:Object.fromEntries((Object.keys(s.streams) as StartStream[]).map(key=>[key,r.query(random.exports.current,s.streams[key])])),neow:s.neow.map(o=>({...o,description:neowDescriptions[o.bonus]!})),relicPools:Object.fromEntries((Object.keys(s.relicPools) as RelicTier[]).map(key=>[key,s.relicPools[key].map(id=>{assert.ok(Object.hasOwn(relicId,id),'Source fixture pool must use a known reference identifier');return relicId[id as keyof typeof relicId];})])),
};}})}};}});
const entry=defineEffect<Setup,unknown>(b=>{const started=b.local<IroncladStart>();return sequence(b.assign(started,call(ironcladStart.exports.initialize,b.input)),b.return(query(views.exports.view,started)));});
const definition=linkRules({id:'sts/normal-owner-start-1',schemas:{setup:SetupSchema,result:z.unknown(),ports:{}},initialize:()=>({}),entry,definitions:[entry],modules:[views]});
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
test('one shared Program constructs normal Ironclad owners, initial deck/relic, map, encounter pools, offers and all RNG streams against C++',async()=>{
  const reference=await ReferenceClient.create();
  try{for(const controlled of [false,true]){const loaded=unwrap(await createCardLoader({controlled}).load(definition));for(const seed of ['0','1','2','7','42','130','507','9223372036854775808','18446744073709551615']){
    const source=(await reference.call({op:'start',seed})).game,expected=Object.fromEntries(['seed','hp','maxHp','gold','deck','bottles','deckCounts','upgradeableCount','transformableCount','relics','map','monsterList','eliteList','boss','secondBoss','rng','neow','relicPools'].map(key=>[key,source[key]])),instance=unwrap(await loaded.core.start({seed}));
    try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Normal owner start failed');assertSameState(expected,stop.result,`normal owner start seed=${seed} controlled=${controlled}`);}
    finally{await instance.close();if(loaded.capture)await loaded.capture.release(instance.id);}
  }}}finally{await reference.close();}
});
