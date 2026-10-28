import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {serialize,deserialize} from 'node:v8';
import {createCardLoader,memorySnapshotStore,fileSnapshotStore} from '../src/index.ts';
import {privateCardGraph} from '../src/graph.ts';
import {insertIndex,removeIndex,indexIds,type RuleIndex} from '../../card-engine/src/rules-indexes.ts';
import {definition,expected,initializations,componentInitializations,highIdDefinition,largeSourceA,largeSourceB} from './fixtures/index-lifecycle.ts';
import type {Ports,Result} from './fixtures/index-lifecycle.ts';
import type {Instance} from '@bear-forge/contracts/instance';
const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
async function finish(instance:Instance<Ports,Result>,size:number){
  unwrap(await instance.bind({wait:async()=>({kind:'reply',value:null})}));
  for(let i=0;i<=size;i++){
    const stop=unwrap(await instance.inspect());
    if(stop.kind==='done'){assert.deepEqual(stop.result,expected(size));return;}
    assert.equal(stop.kind,'call');unwrap(await instance.run());
  }
  assert.deepEqual(unwrap(await instance.inspect()),{kind:'done',result:expected(size)});
}

test('singleton indexes grow, shrink and ignore absent IDs independently after fork',()=>{
  const parent=privateCardGraph({buckets:{} as Record<number,RuleIndex>});
  insertIndex(parent.root.buckets,5,63);insertIndex(parent.root.buckets,5,63);
  removeIndex(parent.root.buckets,5,64);
  assert.deepEqual(parent.export(parent.root.buckets[5]),{first:63,last:63,size:1,previous:null,next:null});
  const child=parent.fork();
  try{
    insertIndex(parent.root.buckets,5,64);insertIndex(child.root.buckets,5,62);
    assert.deepEqual(indexIds(parent.root.buckets,5),[63,64]);assert.equal(parent.root.buckets[5]!.size,2);
    assert.deepEqual(indexIds(child.root.buckets,5),[62,63]);assert.equal(child.root.buckets[5]!.size,2);
    removeIndex(parent.root.buckets,5,63);removeIndex(parent.root.buckets,5,63);
    assert.deepEqual(indexIds(parent.root.buckets,5),[64]);assert.equal(parent.root.buckets[5]!.size,1);
    assert.equal(parent.root.buckets[5]!.previous,null);assert.equal(parent.root.buckets[5]!.next,null);
    assert.deepEqual(indexIds(child.root.buckets,5),[62,63]);
    removeIndex(child.root.buckets,5,63);removeIndex(child.root.buckets,5,64);
    assert.deepEqual(indexIds(child.root.buckets,5),[62]);assert.equal(child.root.buckets[5]!.size,1);
    assert.equal(child.root.buckets[5]!.previous,null);assert.equal(child.root.buckets[5]!.next,null);
    removeIndex(parent.root.buckets,5,64);assert.equal(Object.hasOwn(parent.root.buckets,5),false);
    assert.deepEqual(indexIds(child.root.buckets,5),[62]);
    removeIndex(child.root.buckets,5,62);assert.equal(Object.hasOwn(child.root.buckets,5),false);
    insertIndex(parent.root.buckets,5,65);assert.deepEqual(indexIds(parent.root.buckets,5),[65]);
    assert.equal(Object.hasOwn(child.root.buckets,5),false);
  }finally{child.close();parent.close();}
});

test('FIFO task indexes and scope membership remain independent across fork and V8 snapshot restore',async()=>{
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({recordCore:false,snapshots:store}).load(definition));
  const parent=unwrap(await loaded.core.start(8)),snapshot=unwrap(await loaded.persistence!.save(parent));
  const child=unwrap(await parent.fork!()),restored=unwrap(await loaded.persistence!.restore(snapshot));
  const started=initializations,factories=componentInitializations,original=unwrap(await parent.inspect());
  try{
    await finish(child,8);assert.deepEqual(unwrap(await parent.inspect()),original);
    await finish(restored,8);assert.deepEqual(unwrap(await parent.inspect()),original);
    await finish(parent,8);assert.equal(initializations,started);assert.equal(componentInitializations,factories);
  }finally{await parent.close();await child.close();await restored.close();await loaded.persistence!.release(snapshot);}
});

test('cold restore during indexed entity disposal preserves visible deletion times and cancels remaining scheduled tasks',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'index-lifecycle-'));
  try{
    const loaded=unwrap(await createCardLoader({recordCore:false,snapshots:fileSnapshotStore(directory)}).load(definition)),instance=unwrap(await loaded.core.start(6));
    unwrap(await instance.bind({wait:async()=>({kind:'reply',value:null})}));unwrap(await instance.run());
    const current=unwrap(await instance.inspect());
    assert.equal(current.kind,'call');if(current.kind!=='call')throw Error('Missing dispose boundary');
    assert.deepEqual(current.call.input,{phase:'dispose',entity:1,holders:[1,2,3,4,5,6]});
    const snapshot=unwrap(await loaded.persistence!.save(instance));await instance.close();
    const code=`
      import assert from 'node:assert/strict';
      import {createCardLoader,fileSnapshotStore} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};
      import {definition,expected,initializations,componentInitializations} from ${JSON.stringify(new URL('./fixtures/index-lifecycle.ts',import.meta.url).href)};
      const u=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
      const loaded=u(await createCardLoader({recordCore:false,snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('restore initialized');}}));
      const instance=u(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
      u(await instance.bind({wait:async()=>({kind:'reply',value:null})}));
      for(let i=0;i<6;i++){const stop=u(await instance.inspect());assert.equal(stop.kind,'call');assert.deepEqual(stop.call.input.holders,Array.from({length:6-i},(_,j)=>i+j+1));u(await instance.run());}
      const end=u(await instance.inspect());assert.equal(end.kind,'done');assert.deepEqual(end.result,expected(6));
      assert.equal(initializations,0);assert.equal(componentInitializations,0);await instance.close();process.stdout.write('restored');
    `;
    assert.equal((await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',code])).stdout,'restored');
    await loaded.persistence!.release(snapshot);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('large source bucket order permits current restore, while malformed compact buckets and aliased links do not',async()=>{
  const store=memorySnapshotStore(),loaded=unwrap(await createCardLoader({recordCore:false,snapshots:store}).load(highIdDefinition));
  const parent=unwrap(await loaded.core.start(undefined)),snapshot=unwrap(await loaded.persistence!.save(parent));
  const bytes=(await store.get(snapshot.snapshotId))!,saved=deserialize(bytes),state=saved.root.state.$rules;
  assert.deepEqual(Object.keys(state.indexes.tasksBySource),[String(largeSourceA),String(largeSourceB)]);
  assert.deepEqual(Object.keys(state.tasks),['2','3']);
  const started=initializations,restored=unwrap(await loaded.persistence!.restore(snapshot));
  try{
    unwrap(await restored.bind({wait:async()=>({kind:'reply',value:null})}));unwrap(await restored.run());
    const end=unwrap(await restored.inspect());assert.equal(end.kind,'done');
    if(end.kind==='done')assert.deepEqual(end.result,{tasks:[1,2,3],disposals:[],scope:[]});
    assert.equal(initializations,started);
    const singleton=state.indexes.tasksBySource[largeSourceB];
    assert.equal(singleton.previous,null);assert.equal(singleton.next,null);
    singleton.previous={};singleton.next={};
    await store.put(snapshot.snapshotId,serialize(saved));
    const invalid=await loaded.persistence!.restore(snapshot);
    assert.equal(invalid.ok,false);if(!invalid.ok)assert.match(invalid.error.message??'',/Invalid saved rule indexes/);
    singleton.previous=null;singleton.next=null;
    const byComponent=Object.values(state.indexes.entitiesByComponent)[0] as RuleIndex,byScope=state.indexes.entitiesByScope[0];
    assert.notEqual(byComponent.next,null);assert.notEqual(byComponent.next,byScope.next);
    assert.deepEqual(byComponent.next,byScope.next);byComponent.next=byScope.next;
    await store.put(snapshot.snapshotId,serialize(saved));
    const aliased=await loaded.persistence!.restore(snapshot);
    assert.equal(aliased.ok,false);if(!aliased.ok)assert.match(aliased.error.message??'',/Invalid saved rule indexes/);
  }finally{await parent.close();await restored.close();await loaded.persistence!.release(snapshot);}
});
