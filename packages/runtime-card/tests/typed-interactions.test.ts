import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCardLoader,fileSnapshotStore } from '../src/index.ts';
import { definition,initializations,componentInitializations } from './fixtures/typed-interactions.ts';
const unwrap=<T>(x:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!x.ok)throw Error(JSON.stringify(x.error));return x.value;};
const exec=promisify(execFile);

for(const controlled of [false,true])test(`replacement and immediate dispatch use real Instance continuations; controlled=${controlled}`,async()=>{
  const loaded=unwrap(await createCardLoader({controlled,recordCore:true}).load(definition)),instance=unwrap(await loaded.core.start(3));
  let stop=unwrap(await instance.inspect());assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error('replacement wait missing');assert.equal(stop.call.input,3);
  unwrap(await instance.bind({choose:async()=>({kind:'reply',value:7})}));unwrap(await instance.run());
  stop=unwrap(await instance.inspect());assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error('reaction wait missing');assert.equal(stop.call.input,70);
  unwrap(await instance.bind({choose:async()=>({kind:'reply',value:5})}));unwrap(await instance.run());
  stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('done missing');assert.equal(stop.result,12);
  const records=unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})).records;
  assert.deepEqual(records.filter(row=>row.kind==='returned').map(row=>row.reply.output),[7,5]);
  assert.equal(records.at(-1)?.kind,'completed');
  await instance.close();await loaded.capture!.release(instance.id);
});

test('fork at replacement and reaction waits preserves applied set, pending event and results',async()=>{
  const loaded=unwrap(await createCardLoader().load(definition)),parent=unwrap(await loaded.core.start(3));
  const count=initializations,components=componentInitializations;
  const sibling=unwrap(await parent.fork!());await parent.close();
  unwrap(await sibling.bind({choose:async()=>({kind:'reply',value:9})}));unwrap(await sibling.run());
  const atEvent=unwrap(await sibling.fork!()),restored=unwrap(await loaded.persistence!.restore(unwrap(await loaded.persistence!.save(sibling))));
  await sibling.close();
  for(const [instance,reply,expected]of[[atEvent,4,13],[restored,11,20]]as const){
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:reply})}));unwrap(await instance.run());
    const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'done');if(stop.kind!=='done')throw Error('done missing');assert.equal(stop.result,expected);
    await instance.close();await loaded.capture!.release(instance.id);
  }
  assert.equal(initializations,count);assert.equal(componentInitializations,components);
  await loaded.capture!.release(parent.id);await loaded.capture!.release(sibling.id);
});

for(const stage of ['replacement','reaction']as const)test(`cold restore at ${stage} wait does not reinstall rules or rerun component factories`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'rule-interactions-'));
  try{
    const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(directory)}).load(definition));
    const instance=unwrap(await loaded.core.start(3));
    if(stage==='reaction'){unwrap(await instance.bind({choose:async()=>({kind:'reply',value:7})}));unwrap(await instance.run());}
    const snapshot=unwrap(await loaded.persistence!.save(instance));await instance.close();await loaded.capture!.release(instance.id);
    const code=`
      import {createCardLoader,fileSnapshotStore} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};
      import {definition,initializations,componentInitializations} from ${JSON.stringify(new URL('./fixtures/typed-interactions.ts',import.meta.url).href)};
      const unwrap=x=>{if(!x.ok)throw Error(JSON.stringify(x.error));return x.value;};
      const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('reinitialized');}}));
      const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
      for(const reply of ${JSON.stringify(stage==='replacement'?[7,5]:[5])}){unwrap(await instance.bind({choose:async()=>({kind:'reply',value:reply})}));unwrap(await instance.run());}
      const stop=unwrap(await instance.inspect());if(stop.kind!=='done'||stop.result!==12||initializations!==0||componentInitializations!==0)throw Error(JSON.stringify({stop,initializations,componentInitializations}));
      await instance.close();await loaded.capture.release(instance.id);console.log('restored');
    `;
    assert.equal((await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',code])).stdout.trim(),'restored');
    await loaded.persistence!.release(snapshot);
  }finally{await rm(directory,{recursive:true,force:true});}
});
