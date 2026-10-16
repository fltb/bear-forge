import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createControlledLoader, fileSnapshotStore, programDigest } from '@bear-forge/runtime-controlled';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import type { ProgramSetup, DouDizhuPorts, Frame } from '../src/index.ts';

function unwrap<T>(value: { ok: true; value: T } | { ok: false; error: unknown }): T {
  assert.equal(value.ok, true, JSON.stringify(value));
  if (!value.ok) throw Error('operation failed');
  return value.value;
}
const directory = process.argv[2]!;
const content = new Uint8Array(await readFile(join(directory, 'artifact')));
const saved = JSON.parse(await readFile(join(directory, 'continuation.json'), 'utf8'));
const loaded = unwrap(await createControlledLoader({
  snapshots: fileSnapshotStore(join(directory, 'snapshots')),
  trustedDigests: new Set([programDigest(content)]), stepBudget: 100000000,
}).load({ content } as CompiledProgram<ProgramSetup, DouDizhuPorts, Frame>));
const instance = unwrap(await loaded.persistence!.restore(saved.checkpoint));
assert.deepEqual(unwrap(await instance.inspect()), saved.state);
for (const recorded of saved.tape) {
  const current = unwrap(await instance.inspect());
  assert.equal(current.kind, 'call');
  if (current.kind !== 'call') throw Error('expected call');
  assert.deepEqual(current.call, recorded.call);
  unwrap(await instance.bind({ [recorded.call.port]: async () => ({ kind: 'reply', value: recorded.output }) } as any));
  assert.equal(unwrap(await instance.run()).accepted, true);
}
const final = unwrap(await instance.inspect());
assert.equal(final.kind, 'done');
if (final.kind === 'done') assert.deepEqual(final.result, saved.result);
unwrap(await instance.close());
unwrap(await loaded.capture!.release(instance.id));
