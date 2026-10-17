import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessClient } from '@bear-forge/training';
import { ExperimentFiles } from '@bear-forge/experiments';
import { createOwnForge,encodeForge } from '../src/training/own.ts';

test('same own learner runs Forge with visible encoding and identical native/controlled decisions', {timeout:120000},async()=>{
  const client=new ProcessClient(),directory=await mkdtemp(join(tmpdir(),'own-forge-'));
  try{
    const status=await client.request({command:'status'}),adapter=createOwnForge(client);
    const row=await adapter.run(40000,status.version,['0','1'],true,'first',1000);
    assert.equal(row.status,'ended',row.error??'Expected completed game');
    const samples=adapter.samples(row,['0','1'],status.version,'win');
    assert.equal(samples.length,row.decisions.length);assert.deepEqual(new Set(samples.map(r=>r.player)),new Set(['0','1']));
    const request=row.packets.find(p=>p.kind==='request')!.value,features=encodeForge(request);
    assert.equal(features.actions.length,request.options.values.length);assert.ok(features.tokens.every(t=>t.length===64&&t.every(Number.isFinite)));
    assert.throws(()=>encodeForge({...request,observation:{...request.observation,state:{hands:'hidden'}}}),/unrecognized/i);
    const controlled=await adapter.run(40000,status.version,['0','1'],true,'first',1000,'controlled',new ExperimentFiles(directory,(r:any)=>({id:r.id})));
    assert.equal(controlled.status,'ended',controlled.error??'Expected controlled game');assert.deepEqual(controlled.result,row.result);
    const semantic=(rows:any[])=>rows.map(({requestId,...r})=>r);
    assert.deepEqual(semantic(adapter.samples(controlled,['0','1'],status.version,'win')),semantic(samples));
  }finally{await client.close();await rm(directory,{recursive:true,force:true});}
});
