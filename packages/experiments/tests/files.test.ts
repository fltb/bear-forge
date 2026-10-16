import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentFiles } from '../src/files.ts';
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
  assert.deepEqual(await resumed.summaries(), [{ id: 'task', doubled: 14 }]);
  await resumed.commit(row.id, { id: row.id, amount: 99 });
  assert.deepEqual(await resumed.results(), [row]);
  assert.deepEqual(await resumed.summaries(), [{ id: 'task', doubled: 14 }]);
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
