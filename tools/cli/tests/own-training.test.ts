import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm,access,copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
const entry=fileURLToPath(new URL('../src/training.ts',import.meta.url));
const events=(s:string)=>s.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));

test('own CLI stops on a completed game, restores its on-policy tail and evaluates without updates', {timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'own-cli-')),config=join(directory,'config.json'),output=join(directory,'model');
  const common={game:'forge-duel',output,seed:90000,samples:100000,minutes:1,teacher:true,checkpointEvery:10,learner:{rolloutSamples:1000,epochs:1}};
  try{
    await writeFile(config,JSON.stringify(common));
    const stopped=await new Promise<any>((resolve,reject)=>{
      const child=spawn(process.execPath,['--experimental-strip-types',entry,'train',config]);let stdout='',stderr='',sent=false;
      const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
      child.stdout.on('data',chunk=>{stdout+=String(chunk);if(!sent&&stdout.includes('own-training-progress')){sent=true;child.kill('SIGINT');}});
      child.stderr.on('data',chunk=>stderr+=String(chunk));
      child.once('error',reject);child.once('close',code=>{clearTimeout(timer);if(code!==0)reject(Error(stderr));else resolve(events(stdout).at(-1));});
    });
    assert.equal(stopped.stopped,true);assert.ok(stopped.pendingSamples>0);
    assert.equal(stopped.samples,stopped.consumed+stopped.pendingSamples);
    await assert.rejects(access(join(output,'.writer.lock')),{code:'ENOENT'});
    await copyFile(join(output,'model.pt'),join(directory,'frozen.pt'));
    await writeFile(config,JSON.stringify({...common,samples:1000,checkpoint:join(output,'model.pt')}));
    const resumed=events((await promisify(execFile)(process.execPath,['--experimental-strip-types',entry,'resume',config])).stdout).at(-1);
    assert.equal(resumed.initialOptimizerSteps,stopped.optimizerSteps);assert.ok(resumed.optimizerSteps>stopped.optimizerSteps);
    assert.ok(resumed.samples>=stopped.samples+1000);assert.equal(resumed.samples,resumed.consumed+resumed.pendingSamples);
    await writeFile(config,JSON.stringify({...common,checkpoint:join(output,'model.pt'),seed:2000000,evaluationSeeds:1,
      previousCheckpoint:join(directory,'frozen.pt')}));
    const evaluated=events((await promisify(execFile)(process.execPath,['--experimental-strip-types',entry,'eval',config])).stdout).at(-1);
    assert.equal(evaluated.ended,10);assert.equal(evaluated.fault,0);assert.equal(evaluated.learner.updateMilliseconds,0);
    await assert.rejects(access(join(output,'.writer.lock')),{code:'ENOENT'});
  }finally{await rm(directory,{recursive:true,force:true});}
});
