import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionDriver} from './production-driver.ts';
import {adventureView} from './state-inspection.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import {createCardLoader} from '@bear-forge/runtime-card';
import {cardDefinition} from '../src/card.ts';
import {bossRelicPool} from '../src/pools.ts';

test('all four actual Neow choices preserve source screens, rewards, deck, pools and random streams',async()=>{
  const reference=await ReferenceClient.create();
  try{
    const bonuses=new Set<number>(),bosses=new Set<string>();
    for(const seed of [...Array.from({length:128},(_,i)=>i),130])for(let choice=0;choice<4;choice++){
      const driver=productionDriver(String(seed));
      try{
        const opening=driver.frame();bonuses.add(opening.game.neow![choice]!.bonus);
        await reference.call({op:'start',seed:String(seed)});
        let expected=await reference.call({op:'advance',bits:choice}),actual=driver.advance(choice);
        assertSameState(expected.game,adventureView(driver.machine.root.state),`Neow seed=${seed} choice=${choice}`);
        if(choice===3)actual.game.relics.forEach(relic=>bosses.add(relic.id));
        while(actual.game.screen==='CARD_SELECT'){
          expected=await reference.call({op:'advance',bits:0});actual=driver.advance(0);
          assertSameState(expected.game,adventureView(driver.machine.root.state),`Neow selection seed=${seed} choice=${choice}`);
        }
      }finally{driver.close();}
    }
    assert.equal(bonuses.size,19,'Every implemented Neow bonus must actually execute');
    assert.deepEqual(bossRelicPool.filter(id=>!bosses.has(id)),['BLACK_BLOOD'],'All 21 eligible opening boss relics must execute');
  }finally{await reference.close();}
});

const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
test('an out of range opening choice cannot advance or change the production Context',async()=>{
  for(const controlled of [true]){
    const loaded=unwrap(await createCardLoader({recordCore:false,controlled}).load(cardDefinition)),instance=unwrap(await loaded.core.start({seed:'130'}));
    try{const before=unwrap(await instance.inspect());unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits:4}})}));const result=unwrap(await instance.run());assert.equal(result.accepted,false);assert.equal(result.pause,'invalid_reply');assert.deepEqual(unwrap(await instance.inspect()),before);}
    finally{await instance.close();await loaded.capture?.release(instance.id);}
  }
});
