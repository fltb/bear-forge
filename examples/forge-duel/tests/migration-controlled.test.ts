import { game } from '../src/module.ts';
import { createGameBinder } from '@bear-forge/game-host';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createControlledLoader, programDigest } from '@bear-forge/runtime-controlled';
import type { CompiledProgram } from '@bear-forge/contracts/loading';
import type { Setup, State } from '../src/forge.schemas.ts';
import type { Ports } from '../src/game.types.ts';
import { game as reference } from './reference/module.ts';
import { baseDeck, legal } from './reference/rules.ts';

function unwrap<T>(value: { ok: true; value: T } | { ok: false; error: unknown }): T {
  assert.equal(value.ok, true, JSON.stringify(value));
  if (!value.ok) throw Error('operation failed');
  return value.value;
}

test('frozen Forge reference equals compiled candidate across decision restores and fork continuation', async () => {
  const built = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `import {compileEntry} from '@bear-forge/compiler';
     const artifact=await compileEntry(process.argv[1],'program');
     process.stdout.write(Buffer.from(artifact.content).toString('base64'));`,
    new URL('./generic/module.ts', import.meta.url).pathname,
  ], { maxBuffer: 64 * 1024 * 1024 });
  const artifact = { content: new Uint8Array(Buffer.from(built.stdout, 'base64')) } as CompiledProgram<Setup, Ports, State>;
  const loaded = unwrap(await createControlledLoader({
    trustedDigests: new Set([programDigest(artifact.content)]), stepBudget: 100000000,
  }).load(artifact));
  for (const seed of [87, 991]) {
    const setup: Setup = { profile: 'forge-duel-v1', seed, first: '0', decks: { '0': [...baseDeck], '1': [...baseDeck] } };
    const tape: Array<{ call: any; output: any }> = [];
    const expected = await reference.program.run(setup, {
      async call(call: any) {
        assert.ok(tape.length < 600);
        const output = call.port === 'event' ? null : legal(call.input)[0]!;
        tape.push(structuredClone({ call, output }));
        return output;
      },
    } as any);
    let instance = unwrap(await loaded.core.start(setup));
    let forkChecked = false;
    for (const recorded of tape) {
      const current = unwrap(await instance.inspect());
      assert.equal(current.kind, 'call', JSON.stringify(current));
      if (current.kind !== 'call') throw Error('expected waiting call');
      assert.deepEqual(current.call, recorded.call);
      if (current.call.port === 'decision') {
        const snapshot = unwrap(await loaded.persistence!.save(instance));
        unwrap(await instance.close());
        unwrap(await loaded.capture!.release(instance.id));
        instance = unwrap(await loaded.persistence!.restore(snapshot));
        unwrap(await loaded.persistence!.release(snapshot));
        assert.deepEqual(unwrap(await instance.inspect()), current);
        if (!forkChecked) {
          assert.ok(instance.fork);
      const probeInstance = unwrap(await instance.fork());
      const probe: any = unwrap(await createGameBinder().bind({ instance: probeInstance, contract: game.contract }));
      const peer: any = unwrap(await probe.fork());
      const before: any = unwrap(await probe.inspect());
      const peerBefore: any = unwrap(await peer.inspect());
      const request = before.requests[0];
      const reply = { requestId: request.id, type: request.type, action: recorded.output };
      const wrongPlayer = request.player === '0' ? '1' : '0';
      assert.deepEqual(unwrap(await probe.validate({ player: request.player, reply })), { valid: true });
      for (const invalid of [
        { player: wrongPlayer, reply },
        { player: request.player, reply: { ...reply, action: { kind: 'play', cardId: 'absent', target: null } } },
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
          unwrap(await branch.bind({ decision: async () => ({ kind: 'reply', value: structuredClone(recorded.output) }) }));
          const advanced = unwrap(await branch.run());
          assert.equal(advanced.accepted, true);
          // Advancing a child must not consume the parent's pending request.
          assert.deepEqual(unwrap(await instance.inspect()), current);
          unwrap(await instance.bind({ decision: async () => ({ kind: 'reply', value: structuredClone(recorded.output) }) }));
          assert.equal(unwrap(await instance.run()).accepted, true);
          const parentState = unwrap(await instance.inspect());
          const branchState = unwrap(await branch.inspect());
          assert.equal(parentState.kind, 'call');
          assert.equal(branchState.kind, 'call');
          if (parentState.kind === 'call' && branchState.kind === 'call') {
            // New calls have branch-specific credentials; compare the complete
            // semantic payload, never discard business IDs within it.
            assert.deepEqual(parentState.call, branchState.call);
          }
          unwrap(await branch.close());
          unwrap(await loaded.capture!.release(branch.id));
          forkChecked = true;
          continue;
        }
      }
      unwrap(await instance.bind({ [recorded.call.port]: async () => ({ kind: 'reply', value: structuredClone(recorded.output) }) } as any));
      assert.equal(unwrap(await instance.run()).accepted, true);
    }
    const final = unwrap(await instance.inspect());
    assert.equal(final.kind, 'done', JSON.stringify(final));
    if (final.kind === 'done') assert.deepEqual(final.result, expected);
    assert.ok(forkChecked);
    unwrap(await instance.close());
    unwrap(await loaded.capture!.release(instance.id));
  }
});
