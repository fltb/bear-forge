import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCardLoader,replayCard,readCardTrace,fileSnapshotStore} from '../src/index.ts';
import {definition} from './fixtures/typed-choices.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const exec=promisify(execFile);

for(const controlled of [false,true])test(`invalid choice replies keep the same call, records and rule context; controlled=${controlled}`,async()=>{
  const d=definition(),loaded=unwrap(await createCardLoader({controlled,recordCore:true}).load(d)),instance=unwrap(await loaded.core.start(0));
  const before=unwrap(await instance.inspect()),records=unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100}));
  const trace=unwrap(readCardTrace(loaded,instance.id));
  for(const indices of [[-1],[3],[0,0],[0,1,2],[]]){
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:{indices}})}));const step=unwrap(await instance.run());
    assert.equal(step.accepted,false);assert.equal(step.pause,'invalid_reply');assert.deepEqual(unwrap(await instance.inspect()),before);
    assert.deepEqual(unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})),records);assert.deepEqual(unwrap(readCardTrace(loaded,instance.id)),trace);
  }
  unwrap(await instance.bind({choose:async()=>({kind:'reply',value:{indices:[2,0]}})}));assert.equal(unwrap(await instance.run()).accepted,true);
  const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('done missing');assert.deepEqual(done.result,[10,30]);
  assert.equal((await replayCard(d,unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})).records,{controlled})).ok,true);
  await instance.close();await loaded.capture!.release(instance.id);
});

test('all subsets are accepted exactly when their independently computed cardinality is legal',async()=>{
  const loaded=unwrap(await createCardLoader({controlled:false}).load(definition()));
  for(let mask=0;mask<8;mask++){
    const indices=[0,1,2].filter(i=>mask&(1<<i)),count=indices.length,instance=unwrap(await loaded.core.start(0));
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:{indices}})}));const step=unwrap(await instance.run());assert.equal(step.accepted,count>=1&&count<=2);
    if(step.accepted){const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('done missing');assert.deepEqual(done.result,indices.map(i=>[10,20,30][i]));}
    await instance.close();
  }
});

test('single selection, skipping, empty-subset requests and full ordering retain their different legal domains',async()=>{
  for(const [mode,bad,good,expected]of[
    ['one',{indices:[]},{indices:[],skip:true},[]],['order',{indices:[1,0]},{indices:[2,0,1]},[30,10,20]],['empty',{indices:[0]},{indices:[]},[]],
  ]as const){
    const loaded=unwrap(await createCardLoader().load(definition(mode))),instance=unwrap(await loaded.core.start(0));
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:bad as any})}));assert.equal(unwrap(await instance.run()).pause,'invalid_reply');
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:good as any})}));assert.equal(unwrap(await instance.run()).accepted,true);
    const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('done missing');assert.deepEqual(done.result,expected);
    await instance.close();await loaded.capture!.release(instance.id);
  }
});

test('a new process recreates static choice guards and validates the saved pending candidates without initialization',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'typed-choices-'));
  try{
    const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(directory)}).load(definition())),instance=unwrap(await loaded.core.start(0));
    const snapshot=unwrap(await loaded.persistence!.save(instance));await instance.close();await loaded.capture!.release(instance.id);
    const code=`
      import{createCardLoader,fileSnapshotStore}from${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};
      import{definition}from${JSON.stringify(new URL('./fixtures/typed-choices.ts',import.meta.url).href)};
      const unwrap=x=>{if(!x.ok)throw Error(JSON.stringify(x.error));return x.value;};
      const d=definition(),loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...d,initialize(){throw Error('initialized');}}));
      const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)})),before=unwrap(await instance.inspect());
      unwrap(await instance.bind({choose:async()=>({kind:'reply',value:{indices:[8]}})}));const rejected=unwrap(await instance.run());
      if(rejected.accepted||rejected.pause!=='invalid_reply'||JSON.stringify(unwrap(await instance.inspect()))!==JSON.stringify(before))throw Error('invalid choice advanced');
      unwrap(await instance.bind({choose:async()=>({kind:'reply',value:{indices:[1]}})}));unwrap(await instance.run());
      const done=unwrap(await instance.inspect());if(done.kind!=='done'||done.result[0]!==20)throw Error(JSON.stringify(done));
      await instance.close();await loaded.capture.release(instance.id);console.log('restored');
    `;
    assert.equal((await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',code])).stdout.trim(),'restored');await loaded.persistence!.release(snapshot);
  }finally{await rm(directory,{recursive:true,force:true});}
});
