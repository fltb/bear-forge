import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import {definition,initializations} from './card-lifecycle-fixture.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
const expected=(cost:number)=>({mode:0,master:null,uniqueId:-1,specialData:105,cost,costForTurn:4,upgraded:true,freeToPlayOnce:false,retain:false});

test('card creation and dynamic disposal keep their query policies and committed prefix after independent forks',async()=>{
  const loaded=unwrap(await createCardLoader().load(definition)),parent=unwrap(await loaded.core.start(undefined)),count=initializations;
  const child=unwrap(await parent.fork!());await parent.close();
  unwrap(await child.bind({choose:async()=>({kind:'reply',value:3})}));unwrap(await child.run());
  const stop=unwrap(await child.inspect());assert.deepEqual(stop.kind==='call'?stop.call:null,{port:'choose',input:3});
  const sibling=unwrap(await child.fork!());
  for(const [instance,reply,cost] of [[child,2,5],[sibling,6,9]] as const){
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:reply})}));unwrap(await instance.run());
    const done=unwrap(await instance.inspect());assert.deepEqual(done.kind==='done'?done.result:done,{...expected(cost),costForTurn:reply+2});
    await instance.close();await loaded.capture!.release(instance.id);
  }
  assert.equal(initializations,count);await loaded.capture!.release(parent.id);
});

test('cold restore during real card initialization and disposal never reruns setup, upgrade or an already committed hook',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sts-card-life-'));
  try{
    const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(directory)}).load(definition));
    for(const stage of [0,1]){
      const instance=unwrap(await loaded.core.start(undefined));
      if(stage===1){unwrap(await instance.bind({choose:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());}
      const snapshot=unwrap(await loaded.persistence!.save(instance));await instance.close();await loaded.capture!.release(instance.id);
      const code=`
        import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
        import {definition,initializations} from ${JSON.stringify(new URL('./card-lifecycle-fixture.ts',import.meta.url).href)};
        const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
        const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('restore initialized');}}));
        const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
        if(${stage}===0){unwrap(await instance.bind({choose:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());}
        const waiting=unwrap(await instance.inspect());if(waiting.kind!=='call'||waiting.call.input!==3)throw Error(JSON.stringify(waiting));
        unwrap(await instance.bind({choose:async()=>({kind:'reply',value:2})}));unwrap(await instance.run());
        const done=unwrap(await instance.inspect());if(done.kind!=='done'||JSON.stringify(done.result)!==${JSON.stringify(JSON.stringify(expected(5)))}||initializations!==0)throw Error(JSON.stringify({done,initializations}));
        await instance.close();await loaded.capture.release(instance.id);console.log('restored');
      `;
      const child=await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',code]);assert.equal(child.stdout.trim(),'restored');await loaded.persistence!.release(snapshot);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
