import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {deserialize} from 'node:v8';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Instance,Outcome} from '@bear-forge/contracts/instance';
import type {Ports,Frame} from '../src/game.schemas.ts';
import {ReferenceClient} from './reference/client.ts';
import {publishReference} from './reference/publication.ts';
import {assertSameState} from './reference/compare.ts';
import type {Trace} from './reference/play.ts';
const unwrap=<T,E>(result:Outcome<T,E>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
async function boundary(instance:Instance<Ports,Frame>):Promise<Frame>{
  await instance.bind({event:async()=>({kind:'reply',value:null})});
  for(;;){const stop=unwrap(await instance.inspect());if(stop.kind==='done')return stop.result;if(stop.kind==='fault')throw Error(JSON.stringify(stop.error));if(stop.call.port==='decision')return stop.call.input;unwrap(await instance.run());}
}
async function advance(instance:Instance<Ports,Frame>,bits:number){
  unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits}})}));unwrap(await instance.run());return boundary(instance);
}

test('complete normal A20 run restores and forks every wait; cold restores each encountered interaction without initialization or replay',async()=>{
  const cost={save:0,restore:0,fork:0,records:0},samples={save:[] as number[],restore:[] as number[],fork:[] as number[],records:[] as number[]};
  const timed=async<T>(kind:keyof typeof cost,run:()=>Promise<T>):Promise<T>=>{const at=performance.now();try{return await run();}finally{const ms=performance.now()-at;cost[kind]+=ms;samples[kind].push(ms);}};
  const directory=await mkdtemp(join(tmpdir(),'sts-every-wait-')),artifact=join(directory,'program.mjs');
  // Parent and cold process load the same immutable production artifact, including dependencies.
  // Editing source elsewhere cannot turn a valid saved Context into a different Program.
  await build({stdin:{contents:`export {cardDefinition} from ${JSON.stringify(fileURLToPath(new URL('../src/card.ts',import.meta.url)))};export {oracleView} from ${JSON.stringify(fileURLToPath(new URL('./state-inspection.ts',import.meta.url)))};export {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';`,resolveDir:resolve(fileURLToPath(new URL('../',import.meta.url)))},outfile:artifact,bundle:true,platform:'node',format:'esm',target:'node22'});
  type Artifact=typeof import('../src/card.ts')&typeof import('./state-inspection.ts')&Pick<typeof import('@bear-forge/runtime-card'),'createCardLoader'|'fileSnapshotStore'>;
  const {cardDefinition,oracleView,createCardLoader,fileSnapshotStore}=await import(pathToFileURL(artifact).href) as Artifact;
  const store=fileSnapshotStore(directory),reference=await ReferenceClient.create();
  const trace=JSON.parse(await readFile(new URL('./reference/fixtures/ironclad-a20-heart-130.json',import.meta.url),'utf8')) as Trace;
  let starts=0;
  const loaded=unwrap(await createCardLoader({controlled:true,stepBudget:100_000_000,snapshots:store}).load({...cardDefinition,initialize(setup){starts++;return cardDefinition.initialize(setup);}}));
  const parent=unwrap(await loaded.core.start({seed:trace.seed})),persistence=loaded.persistence!;
  type Saved=Awaited<ReturnType<typeof persistence.save>> extends Outcome<infer T,any>?T:never;
  const cold=new Map<string,{snapshot:Saved;bits:number;frame:Frame;oracle:ReturnType<typeof oracleView>}>();
  try{
    let source=await reference.call({op:'start',seed:trace.seed}),frame=await boundary(parent);
    for(let index=0;index<trace.actions.length;index++){
      const label=`wait=${index}`,saved=unwrap(await timed('save',()=>persistence.save(parent))),bytes=await store.get(saved.snapshotId);assert.ok(bytes);
      const before=oracleView(deserialize(bytes).root.state,frame);assertSameState(source.game,before.game,label+' game');assertSameState(source.battle,before.battle,label+' battle');
      assertSameState(publishReference(source,trace.actions.slice(0,index)),frame,label+' publication');
      if(index===0){
        const code=`import {createCardLoader,fileSnapshotStore,cardDefinition} from ${JSON.stringify(pathToFileURL(artifact).href)};const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};const loaded=unwrap(await createCardLoader({controlled:true,stepBudget:100000000,snapshots:fileSnapshotStore(${JSON.stringify(directory)})}).load({...cardDefinition,initialize(){throw Error('Cold restore must not initialize');}}));const instance=unwrap(await loaded.persistence.restore(${JSON.stringify(saved)}));const stop=unwrap(await instance.inspect());if(stop.kind!=='call'||stop.call.port!=='decision')throw Error(JSON.stringify(stop));process.stdout.write(JSON.stringify(stop.call.input));await instance.close();await loaded.capture?.release(instance.id);`;
        const coldStart=await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{maxBuffer:1024*1024});assert.deepEqual(JSON.parse(coldStart.stdout),frame);
      }
      const restored=unwrap(await timed('restore',()=>persistence.restore(saved))),fork=unwrap(await timed('fork',()=>parent.fork!()));
      const interaction=frame.battle?`battle:${frame.battle.select?.task??'normal'}`:`game:${frame.game.screen}:${frame.game.select?.type??''}`;
      try{
        assert.notEqual(restored.id,parent.id);assert.notEqual(fork.id,parent.id);
        assert.deepEqual(await boundary(restored),frame);assert.deepEqual(await boundary(fork),frame);
        const bits=trace.actions[index]!.bits;
        const next=await advance(parent,bits),fromRestore=await advance(restored,bits),fromFork=await advance(fork,bits);
        assert.deepEqual(fromRestore,next,label+' restore successor');assert.deepEqual(fromFork,next,label+' fork successor');
        const restoredSave=unwrap(await timed('save',()=>persistence.save(restored))),nextBytes=await store.get(restoredSave.snapshotId);assert.ok(nextBytes);
        const after=oracleView(deserialize(nextBytes).root.state,next);
        source=await reference.call({op:'advance',bits});assertSameState(source.game,after.game,label+' successor game');assertSameState(source.battle,after.battle,label+' successor battle');
        if(!cold.has(interaction))cold.set(interaction,{snapshot:saved,bits,frame:next,oracle:after});else unwrap(await persistence.release(saved));
        unwrap(await persistence.release(restoredSave));frame=next;
        assert.equal(starts,1,'fork/restore must not initialize');
      }finally{await restored.close();await fork.close();await loaded.capture?.release(restored.id);await loaded.capture?.release(fork.id);}
      if((index+1)%128===0)console.log(`STS persistence waits ${index+1}/${trace.actions.length}`);
    }
    assert.equal(frame.heartDefeated,true);assert.equal(unwrap(await parent.inspect()).kind,'done');
    if(loaded.capture)unwrap(await timed('records',()=>loaded.capture!.read(parent.id,{after:null,limit:1000})));
    await parent.close();
    // The new process throws on initialize: it can only consume the saved Context.
    const script=`
      import {createCardLoader,fileSnapshotStore,cardDefinition,oracleView} from ${JSON.stringify(pathToFileURL(artifact).href)};
      import {deserialize} from 'node:v8';
      const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
      const store=fileSnapshotStore(${JSON.stringify(directory)});
      const loaded=unwrap(await createCardLoader({controlled:true,stepBudget:100000000,snapshots:store}).load({...cardDefinition,initialize(){throw Error('Cold restore must not initialize or replay');}}));
      const results=[];
      for(const input of ${JSON.stringify([...cold.values()].map(({snapshot,bits})=>({snapshot,bits})))}){
        const instance=unwrap(await loaded.persistence.restore(input.snapshot));
        unwrap(await instance.bind({decision:async()=>({kind:'reply',value:{bits:input.bits}})}));unwrap(await instance.run());
        unwrap(await instance.bind({event:async()=>({kind:'reply',value:null})}));
        let stop=unwrap(await instance.inspect());while(stop.kind==='call'&&stop.call.port==='event'){unwrap(await instance.run());stop=unwrap(await instance.inspect());}
        if(stop.kind==='fault')throw Error(JSON.stringify(stop));const frame=stop.kind==='done'?stop.result:stop.call.input;
        const saved=unwrap(await loaded.persistence.save(instance)),data=deserialize(await store.get(saved.snapshotId));
        results.push({frame,oracle:oracleView(data.root.state,frame)});unwrap(await loaded.persistence.release(saved));await instance.close();await loaded.capture?.release(instance.id);
      }
      process.stdout.write(JSON.stringify(results));
    `;
    const result=await promisify(execFile)(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{maxBuffer:32*1024*1024});
    assert.deepEqual(JSON.parse(result.stdout),[...cold.values()].map(({frame,oracle})=>({frame,oracle})));
    assert.equal(starts,1);
    const medians=Object.fromEntries(Object.entries(samples).map(([kind,values])=>[kind,[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]]));
    assert.ok(medians.fork!<=.05,`fork median ${medians.fork}ms exceeds .05ms`);
    console.log('STS persistence cost '+JSON.stringify({waits:trace.actions.length,coldKinds:cold.size,milliseconds:cost,medianMs:medians,peakRssBytes:process.resourceUsage().maxRSS*1024,rssBytes:process.memoryUsage().rss}));
  }finally{await parent.close();await loaded.capture?.release(parent.id);await reference.close();await rm(directory,{recursive:true,force:true});}
});
