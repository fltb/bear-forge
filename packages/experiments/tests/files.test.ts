import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentFiles } from '../src/files.ts';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('record writes capture aliases and values before yielding without cloning the live history', async () => {
  const directory=await mkdtemp(join(tmpdir(),'bear-record-write-'));
  const files=new ExperimentFiles(directory,(value:any)=>value),shared={value:7};
  const record={id:'test',first:shared,second:shared};
  const pending=files.write('record',record);shared.value=99;
  await pending;
  const saved=await files.read<typeof record>('record');
  assert.equal(saved!.first.value,7);assert.equal(saved!.first,saved!.second);
  const child=spawnSync(process.execPath,['--max-old-space-size=64','--input-type=module','-e',`
    import {ExperimentFiles} from ${JSON.stringify(new URL('../src/files.ts',import.meta.url).href)};
    const records=Array.from({length:250000},(_,i)=>({a:i,b:i,c:i,d:i,e:i,f:i}));
    await new ExperimentFiles(${JSON.stringify(directory)},x=>x).write('large',{records});
  `],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  const large=await files.read<{records:{a:number}[]}>('large');
  assert.equal(large!.records.length,250000);assert.equal(large!.records[249999]!.a,249999);
});
test('a durable task survives summary failure and is never replaced by a retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-summary-recovery-'));
  type Row = { id: string; amount: number };
  type Summary = { id: string; doubled: number };
  const interrupted = new ExperimentFiles<Row, Summary>(directory, () => {
    throw Error('summary interrupted');
  });
  const row = { id: 'task', amount: 7 };
  await assert.rejects(interrupted.commit(row.id, row), /summary interrupted/);
  const resumed = new ExperimentFiles<Row, Summary>(directory, value => ({
    id: value.id, doubled: value.amount * 2
  }));
  assert.deepEqual(await resumed.results(), [row]);
  await resumed.commit(row.id, { id: row.id, amount: 99 });
  assert.deepEqual(await resumed.read('summary-task'),{id:'task',doubled:14});
  assert.deepEqual(await resumed.results(), [row]);
  assert.deepEqual(await resumed.summaries(), [{ id: 'task', doubled: 14 }]);
});

test('a failed atomic replacement removes its temporary file without deleting the original target',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-write-cleanup-'));
  try{
    await mkdir(join(directory,'blocked.bin'));
    const files=new ExperimentFiles(directory,(row:{id:string})=>row);
    await assert.rejects(files.write('blocked',{id:'blocked'}));
    assert.deepEqual(await readdir(directory),['blocked.bin']);
    assert.deepEqual(await readdir(join(directory,'blocked.bin')),[]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('frozen registration compares boundary data rather than serialization order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-registration-'));
  const files = new ExperimentFiles<{ id: string }>(directory, value => value);
  await files.register({ id: 'sample', budget: -0, options: { a: 1, b: 2 } }, [{ id: 'one' }]);
  await files.register({ options: { b: 2, a: 1 }, budget: -0, id: 'sample' }, [{ id: 'one' }]);
  await assert.rejects(() => files.register({ options: { b: 2, a: 1 }, budget: 0, id: 'sample' }, [{ id: 'one' }]), /Frozen registration mismatch/);
});
test('exclusive writer snapshot collection retains referenced checkpoints and removes abandoned snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-snapshot-gc-')),
    files = new ExperimentFiles<{ id: string }>(directory, value => value),
    kept = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    orphan = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await mkdir(join(directory, 'snapshots'));
  await writeFile(join(directory, 'snapshots', kept + '.snapshot'), 'keep');
  await writeFile(join(directory, 'snapshots', orphan + '.snapshot'), 'orphan');
  await files.write('checkpoint-task', {
    snapshot: {
      snapshotId: kept
    }
  });
  await files.collectSnapshots();
  assert.equal(await readFile(join(directory, 'snapshots', kept + '.snapshot'), 'utf8'), 'keep');
  await assert.rejects(() => readFile(join(directory, 'snapshots', orphan + '.snapshot')));
  await files.remove('checkpoint-task');
  await files.collectSnapshots();
  await assert.rejects(() => readFile(join(directory, 'snapshots', kept + '.snapshot')));
});
