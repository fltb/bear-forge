import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEntry } from '@bear-forge/compiler';
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
function answer(call: any) {
  const port = game.contract.ports[call.port as keyof DouDizhuPorts];
  if (port.kind === 'event') return port.receive(call.input).output;
  const received = port.receive(call.input),
    request = received.requests[0]!;
  const options = game.contract.inputs.action.describe(received.view, request);
  if (options.kind !== 'exact') throw Error('Expected exact legal choices');
  const prepared = port.respond(received.view, request, options.values.at(-1)!);
  if (!prepared.valid) throw Error(prepared.reason);
  return prepared.output;
}
test('full game native and compiled calls, replies, facts and final frame agree through real restore', async () => {
  const artifact = await compileEntry<ProgramSetup, DouDizhuPorts, Frame>(new URL('../src/controlled-entry.ts', import.meta.url).pathname);
  const setup: ProgramSetup = {
    game: {
      profile: 'competitive-2016-bear-1',
      firstBidder: '0',
      initialGameTime: 0
    },
    seed: 11
  };
  const expected: any[] = [];
  const result = await program(setup, {
    async call(call: any) {
      const output = answer(call);
      expected.push({
        call: structuredClone(call),
        output: structuredClone(output)
      });
      return output;
    }
  } as any);
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)]),
    stepBudget: 100000000
  }).load(artifact));
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
    if (actual.length === 1 || actual.length === 5 || actual.length === 15) {
      const snapshot = unwrap(await loaded.persistence!.save(instance));
      unwrap(await instance.close());
      instance = unwrap(await loaded.persistence!.restore(snapshot));
      unwrap(await loaded.persistence!.release(snapshot));
      assert.deepEqual(unwrap(await instance.inspect()), state);
    }
    const output = answer(state.call);
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
});
