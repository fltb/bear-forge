import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

/** Parameterized test support; no dependency on a specific game. */
export async function verifyProcessRestore(directory: string, definition: URL, snapshot: unknown, tape: readonly unknown[], expected: unknown): Promise<void> {
  const payload = join(directory, 'continuation.json'); await writeFile(payload, JSON.stringify({ snapshot, tape, expected }));
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
    import {createCardLoader,fileSnapshotStore} from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
    import {cardDefinition} from ${JSON.stringify(definition.href)};
    const u=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value};
    const payload=JSON.parse(await readFile(process.argv[2],'utf8'));
    const def={...cardDefinition,initialize(){throw Error('restore called initialization')}};
    const loaded=u(await createCardLoader({snapshots:fileSnapshotStore(process.argv[1])}).load(def));
    const instance=u(await loaded.persistence.restore(payload.snapshot));
    for(const row of payload.tape){const stop=u(await instance.inspect());assert.equal(stop.kind,'call');assert.deepEqual(stop.call,row.call);
      u(await instance.bind({[stop.call.port]:async()=>({kind:'reply',value:row.output})}));assert.equal(u(await instance.run()).accepted,true);}
    const end=u(await instance.inspect());assert.equal(end.kind,'done');assert.deepEqual(end.result,payload.expected);await instance.close();
  `, directory, payload], { maxBuffer: 1024 * 1024 });
  assert.ok(true);
}
