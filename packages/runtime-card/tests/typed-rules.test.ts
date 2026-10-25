import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCardLoader, fileSnapshotStore } from '../src/index.ts';
import { definition, initializations } from './fixtures/typed-rules.ts';
const unwrap=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const exec=promisify(execFile);

test('typed rules run through real native/controlled Instance with original requests, results and single initialization',async()=>{
  const startCount=initializations;
  for(const controlled of [false,true]){
    const loaded=unwrap(await createCardLoader({controlled,recordCore:true}).load(definition));
    const instance=unwrap(await loaded.core.start(7));
    const first=unwrap(await instance.inspect());assert.equal(first.kind,'call');if(first.kind!=='call')throw Error('Expected wait');
    assert.deepEqual(first.call,{port:'choose',input:9});
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());
    const second=unwrap(await instance.inspect());assert.equal(second.kind,'call');if(second.kind!=='call')throw Error('Expected second wait');
    assert.deepEqual(second.call,{port:'choose',input:15});
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:11})}));unwrap(await instance.run());
    const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('Expected done');assert.equal(done.result,14);
    const records=unwrap(await loaded.capture!.read(instance.id,{after:null,limit:100})).records;
    assert.deepEqual(records.filter(row=>row.kind==='returned').map(row=>row.reply.output),[3,11]);
  assert.equal(records.at(-1)?.kind,'completed');
    await instance.close();await loaded.capture!.release(instance.id);
  }
  // One actual start per execution mode, never a restart from captured inputs.
  assert.equal(initializations-startCount,2);
});

test('typed caller locals, module data and outbox fork independently after an actual commit',async()=>{
  const loaded=unwrap(await createCardLoader().load(definition));
  const parent=unwrap(await loaded.core.start(7));
  unwrap(await parent.bind({choose:async()=>({kind:'reply',value:3})}));unwrap(await parent.run());
  const count=initializations;
  const snapshot=unwrap(await loaded.persistence!.save(parent));
  const child=unwrap(await parent.fork!()),restored=unwrap(await loaded.persistence!.restore(snapshot));
  await parent.close();
  for(const [instance,reply,expected] of [[child,4,7],[restored,20,23]] as const){
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:reply})}));unwrap(await instance.run());
    const done=unwrap(await instance.inspect());assert.equal(done.kind,'done');if(done.kind!=='done')throw Error('Expected done');assert.equal(done.result,expected);
    await instance.close();await loaded.capture!.release(instance.id);
  }
  assert.equal(initializations,count);
  await loaded.capture!.release(parent.id);await loaded.persistence!.release(snapshot);
});

test('a new process restores typed code and committed module state without invoking initialize',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'typed-rules-'));
  try{
    const store=fileSnapshotStore(directory),loaded=unwrap(await createCardLoader({snapshots:store}).load(definition));
    const instance=unwrap(await loaded.core.start(7));
    unwrap(await instance.bind({choose:async()=>({kind:'reply',value:3})}));unwrap(await instance.run());
    const snapshot=unwrap(await loaded.persistence!.save(instance));await instance.close();await loaded.capture!.release(instance.id);
    const code=`
      import {createCardLoader,fileSnapshotStore} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};
      import {definition,initializations} from ${JSON.stringify(new URL('./fixtures/typed-rules.ts',import.meta.url).href)};
      const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
      const loaded=unwrap(await createCardLoader({snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...definition,initialize(){throw Error('restore initialized');}}));
      const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(snapshot)}));
      unwrap(await instance.bind({choose:async()=>({kind:'reply',value:8})}));unwrap(await instance.run());
      const done=unwrap(await instance.inspect());if(done.kind!=='done'||done.result!==11||initializations!==0)throw Error(JSON.stringify(done));
      await instance.close();await loaded.capture.release(instance.id);console.log('restored');
    `;
    const child=await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',code]);
    assert.equal(child.stdout.trim(),'restored');await loaded.persistence!.release(snapshot);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('snapshots reject another typed layout even when the supplied implementation label is identical',async()=>{
  const {rules,linkRules}=await import('@bear-forge/card-engine');
  const {portEffect}=await import('../../card-engine/src/rules-internal.ts');
  const {z}=await import('zod');
  const schemas={setup:z.number(),result:z.number(),ports:{choose:{input:z.number(),output:z.number()}}};
  const choose=portEffect<number,number>('choose');
  const build=(literal:number)=>{
    const entry=rules.defineEffect<number,number>(b=>rules.sequence(rules.call(choose,literal),b.return(0)));
    return linkRules({id:'same-external-label',schemas,initialize:()=>({}),entry,definitions:[entry,choose]});
  };
  const store=(await import('../src/index.ts')).memorySnapshotStore();
  const first=unwrap(await createCardLoader({snapshots:store}).load(build(3))),instance=unwrap(await first.core.start(0));
  const snapshot=unwrap(await first.persistence!.save(instance));
  const second=unwrap(await createCardLoader({snapshots:store}).load(build(4)));
  assert.equal((await second.persistence!.restore(snapshot)).ok,false);
  await instance.close();await first.capture!.release(instance.id);await first.persistence!.release(snapshot);
});
