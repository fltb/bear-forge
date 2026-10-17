import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ProcessClient } from '@bear-forge/training';
import { runExperiment,ExperimentFiles,RegistrationSchema } from '../src/experiment/execution.ts';
import { analyze } from '../src/experiment/analysis.ts';
import { trajectories } from '../src/experiment/trajectory.ts';

test('frozen model experiment survives real process death, feeds relation evidence, and rejects changed weights', {timeout:180000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'forge-model-experiment-')),client=new ProcessClient();
  try{
    const model=join(directory,'model.pt');await client.request({command:'save',path:model,metadata:{game:'forge-duel',encoder:'card-features-v1'}});
    const config=RegistrationSchema.parse({version:1,game:'forge-duel-v1',id:'model-test',blocks:1,seed:7200000,models:{'model-own':model},
      policies:['model-own'],opponents:['first'],engine:'controlled',checkpointEvery:10,maxSteps:1000,maxAttempts:2,minimumBlocks:64,margin:.05,bootstrap:2000,analysisSeed:9});
    const configPath=join(directory,'config.json'),output=join(directory,'experiment');await writeFile(configPath,JSON.stringify(config));
    await assert.rejects(promisify(execFile)(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./model-experiment-child.ts',import.meta.url)),output,configPath]),(e:any)=>e.signal==='SIGKILL');
    const recovered=await runExperiment(output);
    assert.equal(recovered.results.length,16);assert.ok(recovered.results.every(r=>r.status==='ended'));
    const files=new ExperimentFiles(output),first:any=await files.read('task-discovery-0-model-own-first-0-0-0');
    assert.equal(first.attempt,2);
    const modelDecisions=first.decisions.filter((d:any)=>d.accepted.player==='0');
    assert.ok(modelDecisions.length>0&&modelDecisions.every((d:any)=>d.proposal.policyVersion.startsWith('ppo:')));
    const trajectory=trajectories(first)['0']!;assert.equal(trajectory.transitions.length,modelDecisions.length);
    assert.equal(new Set(first.decisions.map((d:any)=>d.step)).size,first.decisions.length);
    const analysis=analyze(config,recovered.results);assert.equal(analysis.cost.tasks,16);
    assert.ok(analysis.relations.some(r=>r.policy==='model-own'&&r.evidence.length>0));
    const resumed=await runExperiment(output);assert.deepEqual(resumed.results,recovered.results);
    // Same UUID and weights, changed file metadata: the frozen file identity still rejects it.
    await client.request({command:'save',path:model,metadata:{game:'forge-duel',encoder:'card-features-v1',changed:true}});
    await assert.rejects(runExperiment(output),/changed/);
  }finally{await client.close();await rm(directory,{recursive:true,force:true});}
});
