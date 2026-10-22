import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import type {Instance,Outcome} from '@bear-forge/contracts/instance';
import {adventureContentDefinition} from './adventure-content-fixture.ts';
import type {Frame,Ports} from '../src/game.schemas.ts';
const unwrap=<T,E>(value:Outcome<T,E>):T=>{if(!value.ok)throw Error(JSON.stringify(value.error));return value.value;};
async function boundary(instance:Instance<Ports,Frame>){
  unwrap(await instance.bind({event:async()=>({kind:'reply',value:null})}));
  for(;;){const stop=unwrap(await instance.inspect());if(stop.kind==='done')return stop.result;if(stop.kind==='fault')throw Error(JSON.stringify(stop));if(stop.call.port==='decision')return stop.call.input;unwrap(await instance.run());}
}
async function act(instance:Instance<Ports,Frame>,bits:number){unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits}})}));unwrap(await instance.run());return boundary(instance);}

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
