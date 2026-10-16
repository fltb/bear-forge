import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileEntry } from '@bear-forge/compiler';
import { createNativeLoader } from '@bear-forge/runtime-native';
import { createControlledLoader, programDigest, fileSnapshotStore } from '../src/index.ts';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import { program, modes } from './benchmarks.ts';
const sizes = process.env.BEAR_BENCHMARK_EXTENDED === '1' ? [4, 8, 32] : [4, 8];
const unwrap = <T,>(x: {
  ok: true;
  value: T;
} | {
  ok: false;
  error: unknown;
}): T => {
  assert.equal(x.ok, true, inspect(x));
  return (x as {
    ok: true;
    value: T;
  }).value;
};
type Ports = {
  step: {
    input: unknown;
    output: number;
  };
};
type Setup = Parameters<typeof program.run>[0];
let artifact: CompiledProgram<Setup, Ports, unknown>;
before(async () => {
  artifact = await compileEntry<Setup, Ports, unknown>(new URL('./benchmarks.ts', import.meta.url).pathname);
});
async function native(setup: any, replies: number[] = []) {
  const calls: any[] = [];
  let i = 0;
  const value = await program.run(setup, {
    async call(call: any) {
      calls.push(structuredClone(call));
      return replies[i++] ?? 7 + i - 1;
    }
  });
  return {
    calls,
    value
  };
}
async function controlled(setup: any, restore = false) {
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)]),
    stepBudget: 100000000
  }).load(artifact));
  let instance = unwrap(await loaded.core.start(setup));
  const calls: any[] = [];
  let ordinal = 0;
  while (true) {
    const state = unwrap(await instance.inspect());
    if (state.kind === 'done') {
      unwrap(await instance.close());
      unwrap(await loaded.capture!.release(instance.id));
      return { calls, value: state.result };
    }
    assert.equal(state.kind, 'call', inspect(state));
    if (restore) {
      const saved = unwrap(await loaded.persistence!.save(instance));
      unwrap(await instance.close());
      unwrap(await loaded.capture!.release(instance.id));
      instance = unwrap(await loaded.persistence!.restore(saved));
      unwrap(await loaded.persistence!.release(saved));
      assert.equal((unwrap(await instance.inspect()) as any).callId, (state as any).callId);
    }
    unwrap(await instance.bind({
      step: async (request: any) => {
        calls.push({
          port: 'step',
          input: request.input
        });
        return {
          kind: 'reply',
          value: 7 + ordinal++
        };
      }
    } as never));
    const step = unwrap(await instance.run());
    assert.equal(step.accepted, true);
    assert.equal(step.pause, null);
  }
}
for (const mode of modes) test('native/compiled ' + mode + ' complete trace and final result', async () => {
  for (const size of sizes) for (const seed of [1, 17]) {
    const setup = {
      mode,
      seed,
      size
    };
    assert.deepEqual(await controlled(setup), await native(setup));
  }
});
for (const mode of modes) test('every stable point restores ' + mode, async () => {
  for (const size of sizes) {
  const setup = {
    mode,
    seed: 31,
    size
  };
  assert.deepEqual(await controlled(setup, true), await native(setup));
  }
});
test('cross-process restore loads only artifact/runtime and consumes only suffix', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-restore-'));
  const file = join(directory, 'program.bin');
  await writeFile(file, artifact.content);
  const savedChild = await promisify(execFile)(process.execPath, ['--experimental-strip-types', new URL('./save-child.ts', import.meta.url).pathname, file, directory], {
    maxBuffer: 1024 * 1024
  });
  const saved = {
    snapshotId: savedChild.stdout
  };
  const child = await promisify(execFile)(process.execPath, ['--experimental-strip-types', new URL('./restore-child.ts', import.meta.url).pathname, file, directory, saved.snapshotId], {
    maxBuffer: 1024 * 1024
  });
  const actual = JSON.parse(child.stdout),
    expected = await native({
      mode: 'closure',
      seed: 1,
      size: 4
    });
  assert.deepEqual(actual.calls, expected.calls.map(x => x.input));
  assert.deepEqual(actual.result, expected.value);
});
test('fork has new identity, retained call id, independent memory and bindings', async () => {
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)]),
    stepBudget: 100000000
  }).load(artifact));
  const parent = unwrap(await loaded.core.start({
    mode: 'closure',
    seed: 1,
    size: 4
  }));
  const state = unwrap(await parent.inspect());
  const a = unwrap(await parent.fork!()),
    b = unwrap(await parent.fork!());
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, parent.id);
  assert.deepEqual(unwrap(await a.inspect()), state);
  assert.equal(unwrap(await a.run()).pause, 'unbound');
  async function finish(x: any, value: number) {
    await x.bind({
      step: async () => ({
        kind: 'reply',
        value
      })
    });
    while (true) {
      const r = unwrap<any>(await x.run());
      if (r.state.kind === 'done') return r.state.result;
      assert.equal(r.state.kind, 'call', JSON.stringify(r));
    }
  }
  const av = await finish(a, 3),
    bv = await finish(b, 9);
  assert.deepEqual(av, (await native({
    mode: 'closure',
    seed: 1,
    size: 4
  }, [3, 3])).value);
  assert.deepEqual(bv, (await native({
    mode: 'closure',
    seed: 1,
    size: 4
  }, [9, 9])).value);
  assert.deepEqual(unwrap(await parent.inspect()), state);
  assert.notDeepEqual(av, bv);
});

test('IO-free native and compiled benchmark variants reach the same complete result without emitting a port',async()=>{for(const mode of modes)for(const size of sizes){const setup={mode,seed:31,size,pause:false};const actual=await controlled(setup),expected=await native(setup);assert.deepEqual(actual,expected,mode);assert.equal(actual.calls.length,0);}});
