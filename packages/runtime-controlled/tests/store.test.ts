import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileSnapshotStore} from '../src/store.ts';

test('a stale temporary snapshot does not prevent a durable retry for the same reference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-store-retry-'));
  try {
    const id = randomUUID();
    const previous = new Uint8Array([1, 2]);
    const replacement = new Uint8Array([3, 4]);
    const store = fileSnapshotStore(directory);
    await store.put(id, previous);
    await writeFile(join(directory, `${id}.snapshot.tmp`), new Uint8Array([99]));
    await store.put(id, replacement);
    assert.deepEqual(await store.get(id), replacement);
    await store.remove(id);
    assert.equal(await store.known(id), true);
    assert.equal(await store.get(id), null);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
