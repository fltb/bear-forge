import {requireDifftest} from './reference/client.ts';
requireDifftest();
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import {ReferenceClient} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import {relicId} from '../src/identifiers.ts';
import {fixture,initializations,type RelicName,type Step} from './permanent-deck-fixture.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
test('owned permanent card identities, counters, eggs, Omamori, Fish, Parasite, bottles and repeated upgrades match pinned Deck at each step',async()=>{
  const cases:{relics:RelicName[];steps:Step[]}[]=[
    {relics:[],steps:[{kind:'obtain',id:'SEARING_BLOW'},{kind:'upgrade',index:11},{kind:'upgrade',index:11},{kind:'bottle',index:1,type:0},{kind:'remove',index:0},{kind:'remove',index:0},{kind:'obtain',id:'PARASITE'},{kind:'remove',index:10},{kind:'upgrade-random',count:3}]},
    {relics:['OMAMORI','CERAMIC_FISH','MOLTEN_EGG','TOXIC_EGG','FROZEN_EGG'],steps:[{kind:'obtain',id:'REGRET',count:3},{kind:'obtain',id:'ASCENDERS_BANE'},{kind:'obtain',id:'SEARING_BLOW',misc:2,upgraded:true,count:2},{kind:'obtain',id:'SHRUG_IT_OFF'},{kind:'obtain',id:'BARRICADE'},{kind:'upgrade-random',count:4}]},
    {relics:['ECTOPLASM','CERAMIC_FISH'],steps:[{kind:'obtain',id:'BASH',count:2},{kind:'upgrade-random',count:30}]},
    {relics:['CERAMIC_FISH','BLOODY_IDOL'],steps:[{kind:'obtain',id:'PARASITE',count:2},{kind:'remove',index:11},{kind:'upgrade',index:0},{kind:'upgrade',index:0},{kind:'obtain',id:'NECRONOMICURSE'},{kind:'obtain',id:'CURSE_OF_THE_BELL'}]},
    {relics:['OMAMORI','CERAMIC_FISH'],steps:[{kind:'obtain',id:'STRIKE_RED',count:85},{kind:'obtain',id:'REGRET'},{kind:'upgrade-random',count:0}]},
  ],reference=await ReferenceClient.create();
  try{for(const seed of ['0','130','18446744073709551615'])for(const [index,c] of cases.entries()){
    const expected=await reference.call({op:'deck-case',seed,relics:c.relics.map(id=>({id:relicId[id],data:id==='OMAMORI'?2:0})),steps:c.steps,captureSteps:true});
    for(const controlled of [true]){const definition=fixture(c.steps,c.relics,seed),loaded=unwrap(await createCardLoader({recordCore:false,controlled}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
      try{const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Permanent deck did not finish');assertSameState(expected,stop.result,`permanent deck seed=${seed} case=${index} controlled=${controlled}`);}
      finally{await instance.close();if(loaded.capture)await loaded.capture?.release(instance.id);}
    }
  }}finally{await reference.close();}
});

test('an obtain reservation pauses after Fish, nests a second batch and cold-restores without duplicating cards, counters or gold',async()=>{
  const steps:Step[]=[{kind:'obtain',id:'BASH',count:2}],owned:RelicName[]=['CERAMIC_FISH'],directory=await mkdtemp(join(tmpdir(),'sts-permanent-')),reference=await ReferenceClient.create();
  try{const expectedA=await reference.call<unknown[]>({op:'deck-case',seed:'130',relics:[{id:relicId.CERAMIC_FISH,data:0}],steps,captureSteps:true}),expectedB=await reference.call<unknown[]>({op:'deck-case',seed:'130',relics:[{id:relicId.CERAMIC_FISH,data:0}],steps:[{kind:'obtain',id:'REGRET'},...steps],captureSteps:true});
    const definition=fixture(steps,owned,'130',true),loaded=unwrap(await createCardLoader({recordCore:false,snapshots:fileSnapshotStore(directory)}).load(definition)),parent=unwrap(await loaded.core.start(undefined)),count=initializations,before=unwrap(await parent.inspect());assert.equal(before.kind,'call',JSON.stringify(before));if(before.kind!=='call')throw Error('Expected reserved batch wait');
    const partial=before.call.input as {deck:unknown[];pending:{remaining:number}[];gold:number;deckCounts:number[]};assert.equal(partial.deck.length,11);assert.equal(partial.gold,117);assert.deepEqual(partial.deckCounts,[8,4,0,0]);assert.equal(partial.pending.length,1);assert.equal(partial.pending[0]!.remaining,2);
    unwrap(await parent.bind({probe:async()=>({kind:'reply',value:2})}));const bad=unwrap(await parent.run());assert.equal(bad.accepted,false);assert.equal(bad.pause,'invalid_reply');assert.deepEqual(unwrap(await parent.inspect()),before);
    const snapshot=unwrap(await loaded.persistence!.save(parent)),child=unwrap(await parent.fork!()),restored=unwrap(await loaded.persistence!.restore(snapshot));await parent.close();await loaded.capture?.release(parent.id);assert.equal(initializations,count);
    for(const [instance,index,expected] of [[child,0,expectedA],[restored,1,expectedB]] as const){unwrap(await instance.bind({probe:async()=>({kind:'reply',value:index})}));unwrap(await instance.run());const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done',JSON.stringify(stop));if(stop.kind!=='done')throw Error('Reserved batch failed');assertSameState(expected.at(-1),stop.result.at(-1),'reserved obtain branch');await instance.close();await loaded.capture?.release(instance.id);}
    assert.equal(initializations,count);assert.notDeepEqual(expectedA.at(-1),expectedB.at(-1));
    const code=`
      import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
      import {fixture,initializations} from ${JSON.stringify(new URL('./permanent-deck-fixture.ts',import.meta.url).href)};
      const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
      const definition=fixture(${JSON.stringify(steps)},${JSON.stringify(owned)},'130',true);
      const loaded=unwrap(await createCardLoader({recordCore:false,snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('Reinitialized a reserved obtain');}}));
      const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));unwrap(await instance.bind({probe:async()=>({kind:'reply',value:1})}));unwrap(await instance.run());const stop=unwrap(await instance.inspect());if(stop.kind!=='done'||initializations!==0)throw Error(JSON.stringify({stop,initializations}));process.stdout.write(JSON.stringify(stop.result.at(-1)));await instance.close();await loaded.capture?.release(instance.id);
    `;
    const cold=await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{maxBuffer:1024*1024});assertSameState(expectedB.at(-1),JSON.parse(cold.stdout),'cold nested obtain');await loaded.persistence!.release(snapshot);
  }finally{await reference.close();await rm(directory,{recursive:true,force:true});}
});
