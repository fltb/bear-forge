import { createGameBinder } from '@bear-forge/game-host';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import { createControlledLoader, programDigest, fileSnapshotStore } from '@bear-forge/runtime-controlled';
import { game } from '../src/index.ts';
import { game as reference } from './reference/module.ts';
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
  const port = reference.contract.ports[call.port as keyof DouDizhuPorts];
  if (port.kind === 'event') return port.receive(call.input).output;
  const received = port.receive(call.input),
    request = received.requests[0]!;
  const options = reference.contract.inputs.action.describe(received.view, request);
  if (options.kind !== 'exact') throw Error('Expected exact legal choices');
  const selected = strategy === 'small' ? options.values.find(action => action.kind === 'play') ?? options.values.at(-1)! : options.values.at(-1)!;
  const prepared = port.respond(received.view, request, selected);
  if (!prepared.valid) throw Error(prepared.reason);
  return prepared.output;
}
test('frozen old game and compiled candidate calls, replies, facts and final frame agree through real restore', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-ddz-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Production compiles before execution. Keep compiler heaps out of the
  // repeated restore run rather than raising its memory limit.
  const built = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `import {compileEntry} from '@bear-forge/compiler';
     const artifact=await compileEntry(process.argv[1]);
     process.stdout.write(Buffer.from(artifact.content).toString('base64'));`,
    new URL('../src/controlled-entry.ts', import.meta.url).pathname
  ], { maxBuffer: 64 * 1024 * 1024 });
  const artifact = { content: new Uint8Array(Buffer.from(built.stdout, 'base64')) } as CompiledProgram<ProgramSetup, DouDizhuPorts, Frame>;
  await writeFile(join(directory, 'artifact'), artifact.content);
  const loaded = unwrap(await createControlledLoader({
    snapshots: fileSnapshotStore(join(directory, 'snapshots')),
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
  const result = await reference.program.run(setup, {
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
  let partialDoubleForkChecked = false;
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
    let forkNext: any;
    if (!partialDoubleForkChecked && state.call.port === 'decision'
      && state.call.input.state.phase === 'doubling' && state.call.input.state.stage?.slots.length === 1) {
      assert.ok(instance.fork);
      const checkpoint = unwrap(await loaded.persistence!.save(instance));
      await writeFile(join(directory, 'continuation.json'), JSON.stringify({
        checkpoint, state, tape: expected.slice(actual.length), result,
      }));
      await promisify(execFile)(process.execPath, ['--experimental-strip-types',
        new URL('./restore-migration-child.ts', import.meta.url).pathname, directory]);
      unwrap(await loaded.persistence!.release(checkpoint));
      const probeInstance = unwrap(await instance.fork());
      const probe: any = unwrap(await createGameBinder().bind({ instance: probeInstance, contract: game.contract }));
      const peer: any = unwrap(await probe.fork());
      const before: any = unwrap(await probe.inspect());
      const peerBefore: any = unwrap(await peer.inspect());
      const request = before.requests[0];
      const reply = { requestId: request.id, type: request.type, action: output.action };
      const wrongPlayer = request.player === '0' ? '1' : '0';
      assert.deepEqual(unwrap(await probe.validate({ player: request.player, reply })), { valid: true });
      for (const invalid of [
        { player: wrongPlayer, reply },
        { player: request.player, reply: { ...reply, action: { kind: 'pass' } } },
      ]) assert.equal((unwrap(await probe.validate(invalid)) as any).valid, false);
      const malformed = await probe.validate({ player: request.player, reply: { ...reply, type: 'unknown-type' } });
      assert.equal(malformed.ok, false);
      assert.equal(malformed.error.code, 'invalid_input');
      assert.equal((unwrap(await peer.validate({ player: request.player, reply })) as any).valid, false);
      assert.deepEqual(unwrap(await probe.inspect()), before);
      assert.deepEqual(unwrap(await peer.inspect()), peerBefore);
      unwrap(await probe.bind({ player: request.player, async onRequest() { return { kind: 'reply', value: reply.action }; } }));
      assert.equal((unwrap(await probe.run()) as any).accepted.kind, 'action');
      const after = unwrap(await probe.inspect());
      assert.equal((unwrap(await probe.validate({ player: request.player, reply })) as any).valid, false);
      assert.deepEqual(unwrap(await probe.inspect()), after);
      assert.deepEqual(unwrap(await peer.inspect()), peerBefore);
      unwrap(await peer.close()); unwrap(await probe.close());
      unwrap(await loaded.capture!.release(peerBefore.requests[0].id.instanceId));
      unwrap(await loaded.capture!.release(probeInstance.id));
      const branch = unwrap(await instance.fork());
      assert.notEqual(branch.id, instance.id);
      unwrap(await branch.bind({ decision: async () => ({ kind: 'reply', value: structuredClone(output) }) }));
      assert.equal(unwrap(await branch.run()).accepted, true);
      assert.deepEqual(unwrap(await instance.inspect()), state, 'child cannot consume the remaining parent farmer slot');
      forkNext = unwrap(await branch.inspect());
      unwrap(await branch.close());
      unwrap(await loaded.capture!.release(branch.id));
      partialDoubleForkChecked = true;
    }
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
    if (forkNext) {
      const parentNext = unwrap(await instance.inspect());
      assert.equal(parentNext.kind, forkNext.kind);
      assert.equal(parentNext.kind, 'call');
      if (parentNext.kind === 'call') assert.deepEqual(parentNext.call, forkNext.call);
    }
    assert.ok(actual.length < 600);
  }
  assert.deepEqual(actual, expected);
  assert.ok(partialDoubleForkChecked, 'fork must cover a partially submitted private choice');
  unwrap(await instance.close());
  unwrap(await loaded.capture!.release(instance.id));
  }
});
