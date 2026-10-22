import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardLoader} from '@bear-forge/runtime-card';
import {cardId} from '../src/identifiers.ts';
import type {PlayOptions} from '../src/rules/battles.types.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import {fixture,type Setup,type Step,type Name} from './battle-card-fixture.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const queue=(id:Name,options?:Partial<PlayOptions>):Step=>({kind:'queue',id,...(options?{options}:{})});
const settle:Step={kind:'settle'},play:Step={kind:'play'},action:Step={kind:'oneAction'};

test('real typed card programs preserve queued snapshots, payment, leave-hand, effects, cleanup and victory cancellation against C++',async()=>{
  const cases:{setup:Setup;steps:Step[]}[]=[
    {setup:{deck:[{id:'BASH'},{id:'STRIKE_RED'},{id:'DEFEND_RED'},{id:'SENTINEL'},{id:'SEEING_RED'},{id:'INFLAME'}],draw:6},steps:[queue('BASH'),play,action,action,action,queue('STRIKE_RED'),settle,queue('DEFEND_RED'),settle,queue('INFLAME'),play,settle,queue('SENTINEL'),settle,queue('SEEING_RED'),settle]},
    {setup:{deck:[{id:'SENTINEL',upgraded:true},{id:'BATTLE_TRANCE'},{id:'POMMEL_STRIKE',upgraded:true},{id:'SHRUG_IT_OFF'},{id:'FINESSE'},{id:'FLASH_OF_STEEL'}],draw:6},steps:[queue('SENTINEL'),settle,queue('BATTLE_TRANCE'),play,settle,queue('POMMEL_STRIKE'),settle,queue('SHRUG_IT_OFF'),settle,queue('FINESSE'),settle,queue('FLASH_OF_STEEL'),settle]},
    {setup:{deck:[{id:'BASH'},{id:'STRIKE_RED'}],draw:2,enemyHp:1},steps:[queue('BASH'),queue('STRIKE_RED'),play,action,action,settle]},
    {setup:{deck:[{id:'BASH'},{id:'DEFEND_RED'},{id:'IRON_WAVE'}],draw:3,energy:0},steps:[queue('BASH',{autoplay:true}),play,settle,queue('DEFEND_RED',{purgeOnUse:true}),settle,queue('IRON_WAVE',{purgeOnUse:true}),settle]},
    {setup:{deck:[{id:'BASH'},{id:'STRIKE_RED'}],draw:2},steps:[queue('BASH'),{kind:'cost',id:'BASH',amount:0},play,settle,queue('STRIKE_RED',{randomTarget:true}),settle]},
    {setup:{deck:[{id:'SEEING_RED',upgraded:true},{id:'DEFEND_RED',upgraded:true},{id:'IRON_WAVE',upgraded:true}],draw:3},steps:[queue('SEEING_RED'),settle,queue('DEFEND_RED',{exhaustOnUse:true}),settle,queue('IRON_WAVE'),settle]},
    {setup:{deck:[{id:'IRON_WAVE'},{id:'SENTINEL'},{id:'DEFEND_RED'}],draw:3,dexterity:3},steps:[queue('IRON_WAVE'),play,action,action,action,queue('SENTINEL'),settle,queue('DEFEND_RED'),settle]},
    {setup:{deck:[{id:'IRON_WAVE',upgraded:true},{id:'SENTINEL',upgraded:true},{id:'DEFEND_RED',upgraded:true}],draw:3,dexterity:5,frail:1},steps:[queue('IRON_WAVE'),settle,queue('SENTINEL'),settle,queue('DEFEND_RED'),settle]},
  ];
  const reference=await ReferenceClient.create();
  try{for(const seed of ['0','130'])for(const [index,c] of cases.entries()){
    const expected=await reference.call({op:'play-case',...c.setup,deck:c.setup.deck.map(c=>({...c,id:cardId[c.id]})),steps:c.steps.map(s=>'id'in s?{...s,id:cardId[s.id]}:s),seed}),definition=fixture(c.setup,c.steps,seed);
    for(const controlled of [true]){const loaded=unwrap(await createCardLoader({recordCore:false,controlled}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
      try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Expected card flow completion');assertSameState(expected,stop.result,`play seed=${seed} case=${index} controlled=${controlled}`);}
      finally{await instance.close();if(loaded.capture)await loaded.capture?.release(instance.id);}
    }
  }}finally{await reference.close();}
});
