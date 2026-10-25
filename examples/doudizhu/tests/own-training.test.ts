import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessClient,transformerPolicy } from '@bear-forge/training';
import { ExperimentFiles } from '@bear-forge/experiments';
import { PolicyRouter } from '@bear-forge/policies';
import { createGameBinder } from '@bear-forge/game-host';
import { createCardLoader } from '@bear-forge/runtime-card';
import { createOwnDoudizhu,encodeDoudizhu } from '../src/training/own.ts';
import { game } from '../src/module.ts';

const unwrap=(result:any):any=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
test('own Transformer learns every DDZ phase from accepted visible requests and reproduces controlled execution', {timeout:120000}, async()=>{
  const client=new ProcessClient(),directory=await mkdtemp(join(tmpdir(),'own-ddz-'));
  try{
    const status=await client.request({command:'status'}),adapter=createOwnDoudizhu(client),phases=new Set<string>();
    for(let seed=30000;seed<30005;seed++){
      const row=await adapter.run(seed,status.version,['0','1','2'],true,'first',1000);
      assert.equal(row.status,'ended',row.error??'Expected completed game');
      const samples=adapter.samples(row,['0','1','2'],status.version,'score');
      assert.equal(samples.length,row.decisions.length);
      samples.forEach(r=>phases.add(r.phase));
      assert.deepEqual(adapter.samples({...row,status:'truncated'},['0','1','2'],status.version,'score'),[]);
      if(seed===30000){
        const controlled=await adapter.run(seed,status.version,['0','1','2'],true,'first',1000,'controlled',new ExperimentFiles(directory,(r:any)=>({id:r.id})));
        assert.equal(controlled.status,'ended',controlled.error??'Expected controlled game');assert.deepEqual(controlled.result,row.result);
        const semantic=(rows:any[])=>rows.map(({requestId,...r})=>r);
        assert.deepEqual(semantic(adapter.samples(controlled,['0','1','2'],status.version,'score')),semantic(samples));
        const request=row.packets.find(p=>p.kind==='request')!.value;
        const original=encodeDoudizhu(request);
        assert.ok(original.tokens.every(t=>t.length===64&&t.every(Number.isFinite)));
        assert.equal(original.actions.length,request.options.values.length);
        assert.throws(()=>encodeDoudizhu({...request,observation:{...request.observation,state:{hands:'private'}}}),/unrecognized/i);
      }
    }
    assert.deepEqual(phases,new Set(['bidding','doubling','redoubling','playing']));
  }finally{await client.close();await rm(directory,{recursive:true,force:true});}
});

test('actual own-policy controlled Core records retain the original completed execution', {timeout:120000}, async()=>{
  const client=new ProcessClient();
  try{
    const status=await client.request({command:'status'});
    const loaded=unwrap(await createCardLoader({controlled:true,recordCore:true}).load(game.definition));
    const instance=unwrap(await loaded.core.start({seed:30000,game:{profile:'competitive-2016-bear-1',firstBidder:'0',initialGameTime:0}}));
    const host=unwrap(await createGameBinder().bind({instance,contract:game.contract}));
    const router=new PolicyRouter(Object.fromEntries(['0','1','2'].map(p=>[p,transformerPolicy(client,status.version,encodeDoudizhu,true)])),30000);
    for(const p of ['0','1','2'])unwrap(await host.bind(router.binding(p)));
    let ended=false;
    for(let i=0;i<1000;i++){
      router.begin();const step=unwrap(await host.run());
      const staged=router.prepare(step.accepted);router.commit('own:'+i,staged.state);
      assert.notEqual(step.state.kind,'fault');if(step.state.kind==='ended'){ended=true;break;}
    }
    assert.equal(ended,true);
    const records:any[]=[];let after:any=null;
    do{const page=unwrap(await loaded.capture.read(instance.id,{after,limit:1000}));records.push(...page.records);after=page.next;}while(after!==null);
    await client.close();
    assert.equal(records.at(-1)?.kind,'completed');
    assert.equal(new Set(records.filter(row=>row.kind==='called').map(row=>row.callId)).size,records.filter(row=>row.kind==='called').length);
    unwrap(await host.close());unwrap(await loaded.capture.release(instance.id));
  }finally{await client.close();}
});
