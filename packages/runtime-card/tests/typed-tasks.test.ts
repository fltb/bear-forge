import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCardLoader,fileSnapshotStore} from '../src/index.ts';
import {definition,initializations} from './fixtures/typed-tasks.ts';
const exec=promisify(execFile);
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
for(const controlled of [false,true])test(`first queued and event-activated tasks retain exact counts and order; controlled=${controlled}`,async()=>{
  const loaded=unwrap(await createCardLoader({controlled,recordCore:true}).load(definition)),instance=unwrap(await loaded.core.start(undefined));
  try{
    const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error('Missing queued wait');assert.equal(stop.call.input,7);
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:4})}));unwrap(await instance.run());
    const end=unwrap(await instance.inspect());assert.deepEqual(end.kind==='done'?end.result:end,[0,2,1,4,9,0]);
    const records=unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})).records;assert.deepEqual(records.filter(row=>row.kind==='returned').map(row=>row.reply.output),[4]);
  assert.equal(records.at(-1)?.kind,'completed');
  }finally{await instance.close();await loaded.capture!.release(instance.id);}
});
test('a running queued task cold-restores and forks without losing its remaining queue or repeating its prefix',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'typed-tasks-'));
  try{
    const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(directory)}).load(definition)),parent=unwrap(await loaded.core.start(undefined)),count=initializations;
    const snapshot=unwrap(await loaded.persistence!.save(parent)),child=unwrap(await parent.fork!());await parent.close();await loaded.capture!.release(parent.id);
    unwrap(await child.bind({choose:async()=>({kind:'reply',value:8})}));unwrap(await child.run());const end=unwrap(await child.inspect());assert.deepEqual(end.kind==='done'?end.result:end,[0,2,1,8,9,0]);
    assert.equal(initializations,count);await child.close();await loaded.capture!.release(child.id);
    const code=`
      import {createCardLoader,fileSnapshotStore} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};
      import {definition,initializations} from ${JSON.stringify(new URL('./fixtures/typed-tasks.ts',import.meta.url).href)};
      const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
      const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('Reinitialized queued run');}}));
      const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
      unwrap(await instance.bind({choose:async()=>({kind:'reply',value:4})}));unwrap(await instance.run());
      const stop=unwrap(await instance.inspect());if(stop.kind!=='done'||JSON.stringify(stop.result)!=='[0,2,1,4,9,0]'||initializations!==0)throw Error(JSON.stringify({stop,initializations}));
      await instance.close();await loaded.capture.release(instance.id);process.stdout.write('restored');
    `;
    assert.equal((await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',code])).stdout,'restored');await loaded.persistence!.release(snapshot);
  }finally{await rm(directory,{recursive:true,force:true});}
});
