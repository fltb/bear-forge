import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCardLoader,fileSnapshotStore} from '../src/index.ts';
import {definition,initializations,componentInitializations} from './fixtures/typed-entities.ts';
const unwrap=<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};

test('data definition references and setup create independent entities after a real Instance fork',async()=>{
  const loaded=unwrap(await createCardLoader().load(definition)),parent=unwrap(await loaded.core.start({which:1,initial:10})),count=initializations;
  const child=unwrap(await parent.fork!());await parent.close();
  unwrap(await child.bind({wait:async()=>({kind:'reply',value:3})}));unwrap(await child.run());
  const second=unwrap(await child.inspect());assert.deepEqual(second.kind==='call'?second.call:null,{port:'wait',input:25});
  const factoryCount=componentInitializations,sibling=unwrap(await child.fork!());
  for(const [instance,reply,expected] of [[child,2,35],[sibling,7,60]] as const){
    unwrap(await instance.bind({wait:async()=>({kind:'reply',value:reply})}));unwrap(await instance.run());
    const stop=unwrap(await instance.inspect());assert.deepEqual(stop.kind==='done'?stop.result:stop,expected);
    await instance.close();await loaded.capture!.release(instance.id);
  }
  assert.equal(initializations,count);assert.equal(componentInitializations,factoryCount);await loaded.capture!.release(parent.id);
});

test('cold restore resolves saved definition references before and after dynamic spawn without reinitializing prior entities',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'typed-entities-'));
  try{
    const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(directory)}).load(definition));
    for(const stage of [0,1]){
      const instance=unwrap(await loaded.core.start({which:1,initial:10}));
      if(stage===1){unwrap(await instance.bind({wait:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());}
      const snapshot=unwrap(await loaded.persistence!.save(instance));await instance.close();await loaded.capture!.release(instance.id);
      const code=`
        import {createCardLoader,fileSnapshotStore} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};
        import {definition,initializations,componentInitializations} from ${JSON.stringify(new URL('./fixtures/typed-entities.ts',import.meta.url).href)};
        const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
        const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('restore initialized');}}));
        const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
        if(${stage}===0){unwrap(await instance.bind({wait:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());}
        const waiting=unwrap(await instance.inspect());if(waiting.kind!=='call'||waiting.call.input!==25)throw Error(JSON.stringify(waiting));
        unwrap(await instance.bind({wait:async()=>({kind:'reply',value:2})}));unwrap(await instance.run());
        const stop=unwrap(await instance.inspect());if(stop.kind!=='done'||stop.result!==35||initializations!==0||componentInitializations!==${stage===0?1:0})throw Error(JSON.stringify({stop,initializations,componentInitializations}));
        await instance.close();await loaded.capture.release(instance.id);console.log('restored');
      `;
      const child=await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',code]);assert.equal(child.stdout.trim(),'restored');
      await loaded.persistence!.release(snapshot);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
