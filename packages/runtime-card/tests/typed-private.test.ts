import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardLoader} from '../src/index.ts';
import {definition} from './fixtures/typed-private.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
for(const controlled of [false,true])test(`third-layer private counters survive two source-scoped waits; controlled=${controlled}`,async()=>{
  const loaded=unwrap(await createCardLoader({controlled,recordCore:true}).load(definition)),instance=unwrap(await loaded.core.start(0));
  for(const source of [1,2]){
    const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'call');if(stop.kind!=='call')throw Error('wait missing');assert.equal(stop.call.input,source);
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:source})}));unwrap(await instance.run());
  }
  const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('done missing');assert.equal(done.result,102);
  const records=unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})).records;assert.deepEqual(records.filter(row=>row.kind==='returned').map(row=>row.reply.output),[1,2]);
  assert.equal(records.at(-1)?.kind,'completed');
  await instance.close();await loaded.capture!.release(instance.id);
});
test('source capability stacks and private counters restore and fork while a hook is paused',async()=>{
  const loaded=unwrap(await createCardLoader().load(definition)),parent=unwrap(await loaded.core.start(0));
  const child=unwrap(await parent.fork!()),snapshot=unwrap(await loaded.persistence!.save(parent)),restored=unwrap(await loaded.persistence!.restore(snapshot));await parent.close();
  for(const [instance,replies,expected]of[[child,[8,9],809],[restored,[3,4],304]]as const){
    for(const reply of replies){unwrap(await instance.bind({choose:async()=>({kind:'reply',value:reply})}));unwrap(await instance.run());}
    const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('done missing');assert.equal(done.result,expected);
    await instance.close();await loaded.capture!.release(instance.id);
  }
  await loaded.capture!.release(parent.id);await loaded.persistence!.release(snapshot);
});
