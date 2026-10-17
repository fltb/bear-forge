import test from 'node:test';
import assert from 'node:assert/strict';
import { sameData } from '@bear-forge/boundary';
import { createCardLoader, replayCard, fileSnapshotStore } from '@bear-forge/runtime-card';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyProcessRestore } from '../../../packages/runtime-card/tests/process-support.ts';
import { createGameBinder } from '@bear-forge/game-host';
import { cardDefinition } from '../src/card.ts';
import { game } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };

for (const controlled of [false, true]) for (const scenario of ['initial', 'clock', 'timeout', 'exact-limit'] as const) {
  test(`DDZ preserves validation failure before event IO at extreme time: ${scenario}, controlled ${controlled}`, async () => {
    const setup = { game: { profile: 'competitive-2016-bear-1' as const, firstBidder: '0' as const, initialGameTime: scenario === 'initial' ? Number.MAX_SAFE_INTEGER : scenario === 'exact-limit' ? Number.MAX_SAFE_INTEGER - 25000 : 0 }, seed: 31 };
    const tape: any[] = []; let advanced = false, expectedError: any;
    try { await reference.program.run(setup, { async call(call: any) {
      assert.ok(tape.length < 10); let output: any = null;
      if (call.port === 'decision') {
        const state = call.input.state, slot = state.stage.slots[0];
        if (scenario === 'clock' && !advanced) { advanced = true; output = { kind: 'clock', at: Number.MAX_SAFE_INTEGER - 1 }; }
        else output = { kind: 'host', boundaryKey: state.stage.boundaryKey, inputType: 'timeout', gameTime: Number.MAX_SAFE_INTEGER, payload: { slotId: slot.slotId } };
      }
      tape.push({ call: structuredClone(call), output }); return output;
    } } as any); } catch (error) { expectedError = error; }
    assert.ok(expectedError instanceof Error);
    const loaded: any = unwrap(await createCardLoader({ controlled, recordCore: true }).load(cardDefinition)), instance = unwrap(await loaded.core.start(setup));
    for (const row of tape) {
      const stop = unwrap(await instance.inspect()); assert.equal(stop.kind, 'call'); assert.deepEqual(stop.call, row.call);
      unwrap(await instance.bind({ [stop.call.port]: async () => ({ kind: 'reply', value: row.output }) })); unwrap(await instance.run());
    }
    const stop = unwrap(await instance.inspect()); assert.equal(stop.kind, 'fault'); assert.equal(stop.error.message, expectedError.message);
    const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 100 })).records;
    assert.deepEqual(records.filter((r: any) => r.kind === 'called').map((r: any) => r.call), tape.map(row => row.call));
    assert.equal((await replayCard(cardDefinition, records, { controlled })).ok, true); await instance.close(); await loaded.capture.release(instance.id);
  });
}

for (const reverse of [false, true]) for (const controlled of [false, true]) {
  test(`dedicated DDZ core matches redeal, clock, timeout, slots and projections; controlled ${controlled}, reverse ${reverse}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'ddz-card-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const setup = { game: { profile: 'competitive-2016-bear-1' as const, firstBidder: '0' as const, initialGameTime: 0 }, seed: 31 };
    const tape: any[] = []; let clock = false, timeout = false;
    const expected = await reference.program.run(setup, { async call(call: any) {
      assert.ok(tape.length < 600); const saved = structuredClone(call); let output = null;
      if (call.port === 'decision') {
        const port = reference.contract.ports.decision, { view, requests } = port.receive(call.input), req = reverse ? requests.at(-1)! : requests[0]!; let reply: any;
        if (view.state.deal > 1 && !clock) { clock = true; reply = port.session!.respond(view, { kind: 'clock', at: view.state.now + 1 }); }
        else if (view.state.deal > 1 && !timeout) { timeout = true; const slot = view.state.stage!.slots[0]!; reply = port.session!.respond(view, { kind: 'timeout', slotId: slot.slotId, at: slot.deadline.atGameTime }); }
        else { const opts: any = reference.contract.inputs.action.describe(view, req); const action = view.state.deal === 1 ? opts.values[0] : reverse ? opts.values.at(-1) : opts.values.find((a: any) => a.kind === 'play') ?? opts.values.at(-1); reply = port.respond(view, req, action); }
        assert.equal(reply.valid, true); output = reply.output;
      }
      tape.push({ call: saved, output: structuredClone(output) }); return output;
    } } as any);
    assert.ok(clock && timeout);
    const loaded: any = unwrap(await createCardLoader({ controlled, recordCore: true, snapshots: fileSnapshotStore(directory) }).load(cardDefinition)); let instance = unwrap(await loaded.core.start(setup));
    for (let i = 0; i < tape.length; i++) {
      const stop = unwrap(await instance.inspect()); assert.equal(stop.kind, 'call'); assert.deepEqual(stop.call, tape[i].call, 'call ' + i);
      if (stop.call.port === 'decision') {
        for (const player of ['0', '1', '2'] as const) {
          const actualObservation = game.contract.observe(stop.call.input, player);
          const expectedObservation = reference.contract.observe(tape[i].call.input, player);
          assert.deepEqual(actualObservation, expectedObservation);
          assert.equal(sameData(actualObservation, expectedObservation), true, 'observation aliases must match the independent reference');
        }
        const a = game.contract.ports.decision.receive(stop.call.input), b = reference.contract.ports.decision.receive(tape[i].call.input);
        for (let j = 0; j < a.requests.length; j++) assert.deepEqual(game.contract.inputs.action.describe(a.view, a.requests[j]!), reference.contract.inputs.action.describe(b.view, b.requests[j]!));
      }
      if (controlled && i % 17 === 0) {
        const saved = unwrap(await loaded.persistence.save(instance)), parent = instance; const fork = unwrap(await parent.fork());
        if (i === 17 && !reverse) await verifyProcessRestore(directory, new URL('../src/card.ts', import.meta.url), saved, tape.slice(i), expected);
        unwrap(await fork.bind({ [stop.call.port]: async () => ({ kind: 'reply', value: tape[i].output }) })); unwrap(await fork.run()); assert.deepEqual(unwrap(await parent.inspect()), stop);
        await fork.close(); await loaded.capture.release(fork.id); instance = unwrap(await loaded.persistence.restore(saved)); await parent.close(); await loaded.capture.release(parent.id); await loaded.persistence.release(saved);
      }
      unwrap(await instance.bind({ [stop.call.port]: async () => ({ kind: 'reply', value: tape[i].output }) })); assert.equal(unwrap(await instance.run()).accepted, true);
    }
    const done = unwrap(await instance.inspect()); assert.equal(done.kind, 'done'); assert.deepEqual(done.result, expected);
    const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 10000 })).records; assert.equal((await replayCard(cardDefinition, records, { controlled })).ok, true);
    await instance.close(); await loaded.capture.release(instance.id);
  });
}

test('dedicated DDZ BaseGame rejects wrong players, foreign and stale credentials without advancing', async () => {
  const loaded: any = unwrap(await createCardLoader().load(cardDefinition));
  const instance = unwrap(await loaded.core.start({ game: { profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0 }, seed: 31 }));
  const handle = unwrap(await createGameBinder().bind({ instance, contract: game.contract, persistence: loaded.persistence }));
  unwrap(await handle.run()); const before = unwrap(await handle.inspect()), peer = unwrap(await handle.fork()), peerBefore = unwrap(await peer.inspect());
  const request = before.requests[0], options = unwrap(await handle.describe({ requestId: request.id, type: request.type }));
  const reply = { requestId: request.id, type: request.type, action: options.values.at(-1) };
  assert.equal(unwrap(await handle.validate({ player: request.player, reply })).valid, true);
  assert.equal(unwrap(await handle.validate({ player: '1', reply })).valid, false);
  assert.equal(unwrap(await peer.validate({ player: request.player, reply })).valid, false);
  assert.deepEqual(unwrap(await handle.inspect()), before); assert.deepEqual(unwrap(await peer.inspect()), peerBefore);
  unwrap(await handle.bind({ player: request.player, async onRequest() { return { kind: 'reply', value: reply.action }; } }));
  assert.equal(unwrap(await handle.run()).accepted.kind, 'action');
  const after = unwrap(await handle.inspect()); assert.equal(unwrap(await handle.validate({ player: request.player, reply })).valid, false); assert.deepEqual(unwrap(await handle.inspect()), after);
  assert.deepEqual(unwrap(await peer.inspect()), peerBefore); await peer.close(); await handle.close();
});
