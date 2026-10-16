import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import { createControlledLoader, programDigest } from '@bear-forge/runtime-controlled';
import { game, program } from '../src/index.ts';
import type { ProgramSetup, DouDizhuPorts, Frame } from '../src/index.ts';
const unwrap = <T,>(x: {
  ok: true;
  value: T;
} | {
  ok: false;
  error: unknown;
}): T => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return (x as {
    ok: true;
    value: T;
  }).value;
};
function answer(call: any, strategy: 'small' | 'large') {
  const port = game.contract.ports[call.port as keyof DouDizhuPorts];
  if (port.kind === 'event') return port.receive(call.input).output;
  const received = port.receive(call.input),
    request = received.requests[0]!;
  const options = game.contract.inputs.action.describe(received.view, request);
  if (options.kind !== 'exact') throw Error('Expected exact legal choices');
  const selected = strategy === 'small' ? options.values.find(action => action.kind === 'play') ?? options.values.at(-1)! : options.values.at(-1)!;
  const prepared = port.respond(received.view, request, selected);
  if (!prepared.valid) throw Error(prepared.reason);
  return prepared.output;
}
test('full game native and compiled calls, replies, facts and final frame agree through real restore', async () => {
  // Production compiles before execution. Keep compiler heaps out of the
  // repeated restore run rather than raising its memory limit.
  const built = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `import {compileEntry} from '@bear-forge/compiler';
     const artifact=await compileEntry(process.argv[1]);
     process.stdout.write(Buffer.from(artifact.content).toString('base64'));`,
    new URL('../src/controlled-entry.ts', import.meta.url).pathname
  ], { maxBuffer: 64 * 1024 * 1024 });
  const artifact = { content: new Uint8Array(Buffer.from(built.stdout, 'base64')) } as CompiledProgram<ProgramSetup, DouDizhuPorts, Frame>;
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)]),
    stepBudget: 100000000
  }).load(artifact));
  for (const seed of [11, 31]) for (const strategy of ['small', 'large'] as const) {
  const setup: ProgramSetup = {
    game: {
      profile: 'competitive-2016-bear-1',
      firstBidder: '0',
      initialGameTime: 0
    },
    seed
  };
  const expected: any[] = [];
  const result = await program(setup, {
    async call(call: any) {
      const output = answer(call, strategy);
      expected.push({
        call: structuredClone(call),
        output: structuredClone(output)
      });
      return output;
    }
  } as any);
  let instance = unwrap(await loaded.core.start(setup));
  const actual: any[] = [];
  while (true) {
    const state = unwrap(await instance.inspect());
    assert.notEqual(state.kind, 'fault', JSON.stringify(state));
    if (state.kind === 'done') {
      assert.deepEqual(state.result, result);
      break;
    }
    if (state.kind !== 'call') throw Error('Expected call');
    if (game.contract.ports[state.call.port].kind !== 'event') {
      const snapshot = unwrap(await loaded.persistence!.save(instance));
      unwrap(await instance.close());
      unwrap(await loaded.capture!.release(instance.id));
      instance = unwrap(await loaded.persistence!.restore(snapshot));
      unwrap(await loaded.persistence!.release(snapshot));
      assert.deepEqual(unwrap(await instance.inspect()), state);
    }
    const recorded = expected[actual.length];
    assert.ok(recorded, 'controlled execution emitted an extra call');
    assert.deepEqual(state.call, recorded.call, `seed ${seed}, strategy ${strategy}, call ${actual.length}`);
    const output = structuredClone(recorded.output);
    actual.push({
      call: structuredClone(state.call),
      output: structuredClone(output)
    });
    unwrap(await instance.bind({
      [state.call.port]: async () => ({
        kind: 'reply',
        value: output
      })
    } as any));
    const step = unwrap(await instance.run());
    assert.equal(step.accepted, true);
    assert.equal(step.pause, null);
    assert.ok(actual.length < 600);
  }
  assert.deepEqual(actual, expected);
  unwrap(await instance.close());
  unwrap(await loaded.capture!.release(instance.id));
  }
});
