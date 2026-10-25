import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createControlledLoader, fileSnapshotStore, programDigest } from '@bear-forge/runtime-controlled';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import { game, type ProgramSetup, type DouDizhuPorts, type Frame } from '../src/index.ts';
import { currentReply } from './current-reply.ts';

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
const current=unwrap(await instance.inspect());
assert.equal(current.kind,'call');if(current.kind!=='call')throw Error('Expected pending current');
const output=currentReply(game.contract,current.call,saved.strategy);
unwrap(await instance.bind({[current.call.port]:async()=>({kind:'reply',value:output})} as any));
assert.equal(unwrap(await instance.run()).accepted,true);
const snapshot=unwrap(await loaded.persistence!.save(instance)),state=unwrap(await instance.inspect());
await writeFile(join(directory,'continued.json'),JSON.stringify({snapshot,state,output}));
unwrap(await instance.close());unwrap(await loaded.capture!.release(instance.id));
