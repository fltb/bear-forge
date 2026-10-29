import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {serialize,deserialize} from 'node:v8';
import {migrateSimulatorSave} from '../src/simulator-save.ts';
import {listSimulatorSaves,simulatorSaveDirectory} from '../src/simulator-library.ts';
import type {SimulatorSave,LegacySimulatorSave} from '../src/simulator.types.ts';

const run=promisify(execFile),fixture=fileURLToPath(new URL('./simulator-process-fixture.ts',import.meta.url));
const processFixture=(mode:string,path:string)=>run(process.execPath,['--experimental-strip-types',fixture,mode,path],{maxBuffer:8*1024*1024});

test('new source identity resumes the exact mid-card Context and commits latest identity without initialization',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-upgrade-'));
  try{
    const first=JSON.parse((await processFixture('middle-create',dir)).stdout);
    const old=deserialize(await readFile(join(dir,'current.sts'))) as SimulatorSave;
    const next=JSON.parse((await processFixture('middle-updated-resume',dir)).stdout);
    assert.deepEqual(next.before.state.observation,first.before.state.observation);
    assert.equal(next.before.revision,first.before.revision);assert.equal(next.after.revision,first.before.revision+1);
    assert.equal(next.before.state.observation.battle.select.task,'SECRET_TECHNIQUE');
    assert.equal(next.after.state.observation.battle.select,undefined);
    const saved=deserialize(await readFile(join(dir,'current.sts'))) as SimulatorSave;
    assert.equal(saved.program,'original-combat-fixture/2');assert.equal(saved.format,2);assert.equal(saved.createdAt,old.createdAt);
    assert.equal(saved.contextVersion,old.contextVersion);assert.equal(saved.revision,next.after.revision);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('exact-source legacy envelope migrates on disk; unknown Context versions refuse without overwriting',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sts-envelope-'));
  try{
    await processFixture('middle-create',dir);
    const path=join(dir,'current.sts'),saved=deserialize(await readFile(path)) as SimulatorSave;
    const {contextVersion:_version,createdAt:_created,savedAt:_saved,...legacy}=saved;
    await writeFile(path,serialize({...legacy,format:1}));
    await processFixture('middle-resume',dir);
    const migrated=deserialize(await readFile(path)) as SimulatorSave;
    assert.equal(migrated.format,2);assert.equal(migrated.revision,saved.revision+1);
    const incompatible=serialize({...migrated,contextVersion:999});await writeFile(path,incompatible);
    await assert.rejects(processFixture('middle-resume',dir),/无法迁移/);
    assert.deepEqual(await readFile(path),incompatible);
    const unrelated={...legacy,format:1,program:'retired-program'} as LegacySimulatorSave;
    assert.throws(()=>migrateSimulatorSave(unrelated,'current-program'),/已作废/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('save discovery reports compatible, interrupted, incompatible, damaged and busy without altering files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sts-library-'));
  try{
    const good=join(root,'good');await mkdir(good);await processFixture('middle-create',good);
    const bytes=await readFile(join(good,'current.sts')),save=deserialize(bytes) as SimulatorSave;
    for(const name of ['interrupted','old','damaged','busy'])await mkdir(join(root,name));
    await writeFile(join(root,'interrupted/current.sts'),bytes);
    await writeFile(join(root,'interrupted/pending.json'),JSON.stringify({sessionId:save.sessionId,revision:save.revision+1}));
    await writeFile(join(root,'old/current.sts'),serialize({...save,contextVersion:0}));
    await writeFile(join(root,'damaged/current.sts'),'broken');
    await writeFile(join(root,'busy/current.sts'),bytes);
    await writeFile(join(root,'busy/owner.lock'),JSON.stringify({pid:process.pid,nonce:'fixture'}));
    const entries=await listSimulatorSaves(root),by=Object.fromEntries(entries.map(e=>[e.directory.split('/').at(-1)!,e]));
    assert.equal(by.good!.available,true);assert.equal(by.interrupted!.status,'interrupted');assert.equal(by.old!.status,'incompatible');
    assert.equal(by.damaged!.status,'damaged');assert.equal(by.busy!.status,'busy');assert.equal(entries.filter(e=>e.available).length,1);
    assert.deepEqual(await readFile(join(good,'current.sts')),bytes);
    const original=process.cwd(),directory=simulatorSaveDirectory();try{process.chdir(tmpdir());assert.equal(simulatorSaveDirectory(),directory);assert.ok(directory.startsWith('/'));}finally{process.chdir(original);}
  }finally{await rm(root,{recursive:true,force:true});}
});
