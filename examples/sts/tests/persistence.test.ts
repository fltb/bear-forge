import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import type {Instance,Outcome} from '@bear-forge/contracts/instance';
import {cardDefinition} from '../src/card.ts';
import type {Ports,Frame} from '../src/game.schemas.ts';
import {ReferenceClient,type ReferenceState} from './reference/client.ts';
import {assertSameState} from './reference/compare.ts';
import type {Trace} from './reference/play.ts';
import {publishReference} from './reference/publication.ts';
import {deserialize} from 'node:v8';
import {oracleView,battleView} from './state-inspection.ts';
const exec=promisify(execFile);
const unwrap=<T,E>(r:Outcome<T,E>):T=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
async function decision(instance:Instance<Ports,Frame>):Promise<Frame> {
  for(;;){const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'call',JSON.stringify(stop));if(stop.kind!=='call')throw Error('Expected decision');
    if(stop.call.port==='decision')return stop.call.input;
    unwrap(await instance.bind({event:async()=>({kind:'reply',value:null})}));unwrap(await instance.run());}
}
async function step(instance:Instance<Ports,Frame>,bits:number):Promise<Frame> {
  unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits}})}));unwrap(await instance.run());return decision(instance);
}
function compare(expected:ReferenceState,actual:Frame,label:string):void {
  assert.deepEqual(actual,publishReference(expected,actual.history),label+' publication');
  assert.deepEqual(actual.actions.map(a=>a.bits),expected.actions.map(a=>a.bits),label+' actions');
}

test('pending Warcry queue forks, survives parent close and restores across processes without initialization',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-card-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const trace=JSON.parse(await readFile(new URL('./reference/fixtures/ironclad-a20-heart-130.json',import.meta.url),'utf8')) as Trace;
  let initializations=0;
  const loaded=unwrap(await createCardLoader({controlled:true,stepBudget:100_000_000,snapshots:fileSnapshotStore(directory)}).load({...cardDefinition,
    initialize(setup){initializations++;return cardDefinition.initialize(setup);}}));
  const parent=unwrap(await loaded.core.start({seed:trace.seed})),ref=await ReferenceClient.create();
  let child:Instance<Ports,Frame>|undefined,restored:Instance<Ports,Frame>|undefined;
  let snapshot:Awaited<ReturnType<NonNullable<typeof loaded.persistence>['save']>>|undefined;
  try {
    const prefix=trace.actions.slice(0,5).map(a=>a.bits);
    let s=await ref.call({op:'start',seed:trace.seed});await decision(parent);
    for(const bits of prefix){s=await ref.call({op:'advance',bits});compare(s,await step(parent,bits),'prefix');}
    const demon=s.actions.find(a=>a.description.includes('Demon Form'));assert.ok(demon);
    for(const bits of [demon.bits,2147483648]){prefix.push(bits);s=await ref.call({op:'advance',bits});compare(s,await step(parent,bits),'reach Warcry');}
    const warcry=s.actions.find(a=>a.description.includes('Warcry'));assert.ok(warcry);prefix.push(warcry.bits);
    s=await ref.call({op:'advance',bits:warcry.bits});const before=await step(parent,warcry.bits);compare(s,before,'waiting choice');
    assert.equal(before.battle?.select?.task,'WARCRY');
    assert.ok(parent.fork);assert.ok(loaded.persistence);
    snapshot=await loaded.persistence.save(parent);const saved=unwrap(snapshot);
    const stored=await fileSnapshotStore(directory).get(saved.snapshotId);assert.ok(stored);
    const privateState=deserialize(stored).root.state;assert.equal(battleView(privateState)!.actionQueueSize,s.battle!.actionQueueSize,'cleanup must remain queued across IO');
    assertSameState(s.game,oracleView(privateState,before).game,'saved private game');assertSameState(s.battle,oracleView(privateState,before).battle,'saved private battle');
    child=unwrap(await parent.fork());restored=unwrap(await loaded.persistence.restore(saved));
    assert.deepEqual(await decision(parent),before);assert.deepEqual(await decision(child),before);assert.deepEqual(await decision(restored),before);
    assert.equal(initializations,1,'fork and restore must not initialize or replay');
    const zero=s.actions[0]!.bits,one=s.actions[1]!.bits;
    const expectedZero=await ref.call({op:'advance',bits:zero});
    await ref.call({op:'start',seed:trace.seed});for(const bits of prefix)await ref.call({op:'advance',bits});
    const expectedOne=await ref.call({op:'advance',bits:one});
    const script=`
      import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
      import {cardDefinition} from ${JSON.stringify(new URL('../src/card.ts',import.meta.url).href)};
      import {oracleView,battleView} from ${JSON.stringify(new URL('./state-inspection.ts',import.meta.url).href)};
      import {deserialize} from 'node:v8';
      const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value;};
      const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({
        ...cardDefinition,initialize(){throw Error('Cold restore must not initialize');}
      }));
      const i=unwrap(await loaded.persistence.restore(${JSON.stringify(saved)}));
      unwrap(await i.bind({decision:async()=>({kind:'reply',value:{bits:${zero}}}),event:async()=>({kind:'reply',value:null})}));
      unwrap(await i.run());
      let stop=unwrap(await i.inspect());
      while(stop.kind==='call'&&stop.call.port==='event'){unwrap(await i.run());stop=unwrap(await i.inspect());}
      if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));
      const saved=unwrap(await loaded.persistence.save(i)),store=fileSnapshotStore(${JSON.stringify(directory)});
      const oracle=oracleView(deserialize(await store.get(saved.snapshotId)).root.state,stop.call.input);
      process.stdout.write(JSON.stringify({frame:stop.call.input,oracle}));await loaded.persistence.release(saved);await i.close();
    `;
    const result=await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{maxBuffer:1024*1024});
    const cold=JSON.parse(result.stdout);compare(expectedZero,cold.frame,'new process');
    assertSameState(expectedZero.game,cold.oracle.game,'cold private game');assertSameState(expectedZero.battle,cold.oracle.battle,'cold private battle');
    await parent.close();
    compare(expectedZero,await step(child,zero),'child after parent close');
    compare(expectedOne,await step(restored,one),'restored alternate choice');
    assert.equal(initializations,1);
    assert.notDeepEqual(await decision(child),await decision(restored),'branches must retain different draw order');
  }finally{
    await parent.close();if(child){await child.close();await loaded.capture?.release(child.id);}if(restored){await restored.close();await loaded.capture?.release(restored.id);}
    await loaded.capture?.release(parent.id);if(snapshot?.ok)await loaded.persistence?.release(snapshot.value);await ref.close();
  }
});
