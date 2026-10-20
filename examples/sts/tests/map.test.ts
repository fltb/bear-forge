import test from 'node:test';
import assert from 'node:assert/strict';
import {generateMap} from '../src/map.ts';
import {productionDriver} from './production-driver.ts';
import {adventureView} from './state-inspection.ts';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';

test('map topology, rooms, parent ordering and burning elite match every source act',async()=>{
  const ref=await ReferenceClient.create();
  try {
    for(const seed of ['0','1','130','409','9223372036854775808','18446744073709551615'])
      for(const act of [1,2,3,4])for(const burning of [false,true]){
        const expected=await ref.call({op:'map',seed,act,burning});
        assertSameState(expected,generateMap(BigInt(seed),20,act,burning),`seed=${seed} act=${act} burning=${burning}`);
      }
  }finally{await ref.close();}
});

test('Neow offers and random progress match actual normal game initialization',async()=>{
  const ref=await ReferenceClient.create();
  try {
    for(const seed of ['0','1','65','130','9223372036854775808','18446744073709551615']) {
      const expected=await ref.call({op:'start',seed}),driver=productionDriver(seed);
      try{const frame=driver.frame();assert.deepEqual(frame.game.neow,expected.game.neow);assert.deepEqual(adventureView(driver.machine.root.state).rng.neow,expected.game.rng.neow);}finally{driver.close();}
    }
  }finally{await ref.close();}
});
