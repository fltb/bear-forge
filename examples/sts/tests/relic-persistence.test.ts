import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import type {Instance,Outcome} from '@bear-forge/contracts/instance';
import {adventureContentDefinition} from './adventure-content-fixture.ts';
import type {Frame,Ports} from '../src/game.schemas.ts';
import {potionId} from '../src/identifiers.ts';
const unwrap=<T,E>(value:Outcome<T,E>):T=>{if(!value.ok)throw Error(JSON.stringify(value.error));return value.value;};
async function boundary(instance:Instance<Ports,Frame>){
  unwrap(await instance.bind({event:async()=>({kind:'reply',value:null})}));
  for(;;){const stop=unwrap(await instance.inspect());if(stop.kind==='done')return stop.result;if(stop.kind==='fault')throw Error(JSON.stringify(stop));if(stop.call.port==='decision')return stop.call.input;unwrap(await instance.run());}
}
async function act(instance:Instance<Ports,Frame>,bits:number){unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits}})}));unwrap(await instance.run());return boundary(instance);}

for(const relic of ['BOTTLED_FLAME','BOTTLED_LIGHTNING','BOTTLED_TORNADO'] as const)test(`${relic}: restore the selection, retain unclaimed loot, then enter combat with the bottled card`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-bottle-'));
  let starts=0;
  const loaded=unwrap(await createCardLoader({recordCore:false,controlled:true,stepBudget:100_000_000,snapshots:fileSnapshotStore(directory)}).load({...adventureContentDefinition,initialize(setup){starts++;return adventureContentDefinition.initialize(setup);}}));
  let instance=unwrap(await loaded.core.start({seed:'130',event:null,relic,rewardRelic:true,fightAfterReward:true}));
  try{
    assert.equal((await boundary(instance)).game.screen,'REWARDS');
    const selection=await act(instance,4<<27);
    assert.equal(selection.game.screen,'CARD_SELECT');
    const selected=selection.game.select!.cards[0]!.card.id;
    const saved=unwrap(await loaded.persistence!.save(instance));
    await instance.close();instance=unwrap(await loaded.persistence!.restore(saved));
    assert.deepEqual(await boundary(instance),selection);assert.equal(starts,1);
    const reward=await act(instance,0);
    assert.equal(reward.game.screen,'REWARDS');
    assert.deepEqual(reward.game.rewards!.gold,[17]);
    assert.equal(reward.game.rewards!.cards.length,1);
    assert.deepEqual(reward.game.rewards!.potions,[potionId.DEXTERITY_POTION]);
    assert.equal(reward.game.rewards!.relics.length,0);
    assert.equal(reward.game.rewards!.sapphireKey,false);
    await act(instance,1<<27);await act(instance,3<<27);await act(instance,5<<8);
    const combat=await act(instance,6<<27);
    assert.ok(combat.battle);assert.ok(combat.battle.hand.some(card=>card.id===selected));
    assert.ok(combat.game.relics.some(item=>item.id===relic));assert.equal(starts,1);
    assert.ok((await act(instance,(4<<29)>>>0)).battle);
    unwrap(await loaded.persistence!.release(saved));
  }finally{await instance.close();await rm(directory,{recursive:true,force:true});}
});

test('six relic gaps: Orrery and Mirror manual windows fork and restore without sharing choices or reinitializing the program',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-relic-persistence-'));
  try{for(const relic of ['ORRERY','DOLLYS_MIRROR'] as const){
    let starts=0;
    const loaded=unwrap(await createCardLoader({recordCore:false,controlled:true,stepBudget:100_000_000,snapshots:fileSnapshotStore(directory)}).load({...adventureContentDefinition,initialize(setup){starts++;return adventureContentDefinition.initialize(setup);}}));
    const parent=unwrap(await loaded.core.start({seed:'130',event:null,relic,copyCard:relic==='DOLLYS_MIRROR'})),original=await boundary(parent),saved=unwrap(await loaded.persistence!.save(parent)),fork=unwrap(await parent.fork!()),restored=unwrap(await loaded.persistence!.restore(saved));
    try{
      assert.equal(starts,1);assert.deepEqual(await boundary(restored),original);await parent.close();
      const a=await act(fork,relic==='ORRERY'?0:13),b=await act(restored,relic==='ORRERY'?5<<8:0);
      if(relic==='ORRERY'){
        assert.equal(a.game.deck.length,14);assert.equal(b.game.deck.length,13);assert.equal(a.game.rewards!.cards.length,4);assert.equal(b.game.rewards!.cards.length,4);
        for(const instance of [fork,restored]){for(let i=0;i<4;i++)await act(instance,5<<8);assert.equal((await act(instance,6<<27)).game.screen,'MAP_SCREEN');}
      }else{
        assert.deepEqual(a.game.deck.at(-1),{id:'SEARING_BLOW',upgraded:true,misc:3});assert.equal(b.game.deck.at(-1)!.id,'ASCENDERS_BANE');assert.equal(a.game.deck.length,15);assert.equal(b.game.deck.length,15);assert.equal(a.game.screen,'MAP_SCREEN');assert.equal(b.game.screen,'MAP_SCREEN');
      }
      assert.equal(starts,1);
    }finally{for(const instance of [parent,fork,restored]){await instance.close();await loaded.capture?.release(instance.id);}unwrap(await loaded.persistence!.release(saved));}
  }}finally{await rm(directory,{recursive:true,force:true});}
});
