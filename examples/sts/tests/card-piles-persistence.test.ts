import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCardLoader,fileSnapshotStore,replayCard} from '@bear-forge/runtime-card';
import type {Instance} from '@bear-forge/contracts/instance';
import {definition,initializations} from './card-piles-persistence-fixture.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
async function reply(i:Instance<{choose:{input:unknown;output:number}},unknown>,value:number){unwrap(await i.bind({choose:async()=>({kind:'reply',value})}));unwrap(await i.run());return unwrap(await i.inspect());}
function checkDone(stop:Awaited<ReturnType<typeof reply>>,costs:number[]){assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('Expected completed draw');const result=stop.result as any;
  assert.deepEqual(result.events,[1,0,2]);assert.deepEqual(result.hand.map((c:any)=>c.uniqueId),[1,0,2]);assert.deepEqual(result.hand.map((c:any)=>c.costForTurn),costs);assert.deepEqual([result.draw,result.discard,result.exhaust],[[],[],[]]);assert.equal(result.drawn,3);assert.equal(result.queueSize,0);assert.equal(result.shuffle.counter,1);
}
for(const controlled of [false,true])test(`a draw hook resumes its detached card and pending reshuffle exactly once; controlled=${controlled}`,async()=>{
  const loaded=unwrap(await createCardLoader({controlled,recordCore:true}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
  try{
    const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error('Missing draw wait');const input=stop.call.input as any;
    assert.equal(input.card,1);assert.equal(input.queueSize,2);assert.equal(input.drawn,2);assert.deepEqual(input.hand,[]);assert.deepEqual(input.events,[1]);assert.deepEqual(input.draw.map((c:any)=>c.uniqueId),[0]);
    await reply(instance,1);await reply(instance,2);checkDone(await reply(instance,3),[1,2,3]);
    const records=unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})).records;assert.equal((await replayCard(definition,records,{controlled})).ok,true);
  }finally{await instance.close();await loaded.capture!.release(instance.id);}
});
test('draw-batch and dequeued-draw waits cold-restore without rerolling, repopping or reinitializing',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-draw-'));
  try{
    const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(directory)}).load(definition));
    for(const stage of [0,2]){
      const parent=unwrap(await loaded.core.start(undefined)),count=initializations;
      if(stage===2){await reply(parent,1);await reply(parent,2);}
      const snapshot=unwrap(await loaded.persistence!.save(parent)),child=unwrap(await parent.fork!());await parent.close();await loaded.capture!.release(parent.id);
      if(stage===0){await reply(child,4);await reply(child,5);checkDone(await reply(child,6),[4,5,6]);}else checkDone(await reply(child,6),[1,2,6]);
      assert.equal(initializations,count);await child.close();await loaded.capture!.release(child.id);
      const code=`
        import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
        import {definition,initializations} from ${JSON.stringify(new URL('./card-piles-persistence-fixture.ts',import.meta.url).href)};
        const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
        const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('Reinitialized drawing');}}));
        const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
        for(const value of ${JSON.stringify(stage===0?[1,2,3]:[3])}){unwrap(await instance.bind({choose:async()=>({kind:'reply',value})}));unwrap(await instance.run());}
        const stop=unwrap(await instance.inspect()),r=stop.result;
        if(stop.kind!=='done'||JSON.stringify(r.events)!=='[1,0,2]'||JSON.stringify(r.hand.map(c=>c.uniqueId))!=='[1,0,2]'||JSON.stringify(r.hand.map(c=>c.costForTurn))!=='[1,2,3]'||r.shuffle.counter!==1||r.drawn!==3||r.queueSize!==0||initializations!==0)throw Error(JSON.stringify({stop,initializations}));
        await instance.close();await loaded.capture.release(instance.id);process.stdout.write('restored');
      `;
      assert.equal((await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',code])).stdout,'restored');await loaded.persistence!.release(snapshot);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
