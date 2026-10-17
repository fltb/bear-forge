import test from 'node:test';
import assert from 'node:assert/strict';
import { sameData } from '@bear-forge/boundary';
import { createCardLoader, replayCard, fileSnapshotStore } from '@bear-forge/runtime-card';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyProcessRestore } from '../../../packages/runtime-card/tests/process-support.ts';
import { cardDefinition } from '../src/card.ts';
import { game } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
import { baseDeck } from './reference/rules.ts';
import { createGameBinder } from '@bear-forge/game-host';
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };

for (const seed of [87, 991]) for (const controlled of [false, true]) {
  test(`dedicated Forge core matches independent reference including projections, controlled ${controlled}, seed ${seed}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'forge-card-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const setup = { profile: 'forge-duel-v1' as const, seed, first: '0' as const, decks: { '0': [...baseDeck], '1': [...baseDeck] } };
    const tape: any[] = [];
    const expected = await reference.program.run(setup, { async call(call: any) {
      const saved = structuredClone(call); let output = null;
      if (call.port === 'decision') { const received = reference.contract.ports.decision.receive(call.input); const req = received.requests[0]!; const opts: any = reference.contract.inputs.move.describe(received.view, req); const r: any = reference.contract.ports.decision.respond(received.view, req, opts.values[0]); assert.equal(r.valid, true); output = r.output; }
      tape.push({ call: saved, output: structuredClone(output) }); return output;
    } } as any);
    const loaded: any = unwrap(await createCardLoader({ controlled, recordCore: true, snapshots: fileSnapshotStore(directory) }).load(cardDefinition)); let instance = unwrap(await loaded.core.start(setup));
    for (let i = 0; i < tape.length; i++) {
      const stop = unwrap(await instance.inspect()); assert.equal(stop.kind, 'call'); assert.deepEqual(stop.call, tape[i].call);
      if (stop.call.port === 'decision') for (const player of ['0', '1'] as const) {
        const actualObservation = game.contract.observe(stop.call.input, player);
        const expectedObservation = reference.contract.observe(tape[i].call.input, player);
        assert.deepEqual(actualObservation, expectedObservation);
        assert.equal(sameData(actualObservation, expectedObservation), true, 'observation aliases must match the independent reference');
      }
      if (controlled && i % 13 === 0) {
        const snapshot = unwrap(await loaded.persistence.save(instance)); const original = instance; const branch = unwrap(await original.fork());
        if (i === 13 && seed === 87) await verifyProcessRestore(directory, new URL('../src/card.ts', import.meta.url), snapshot, tape.slice(i), expected);
        unwrap(await branch.bind({ [stop.call.port]: async () => ({ kind: 'reply', value: tape[i].output }) })); unwrap(await branch.run());
        assert.deepEqual(unwrap(await original.inspect()), stop); await branch.close(); await loaded.capture.release(branch.id);
        instance = unwrap(await loaded.persistence.restore(snapshot)); await original.close(); await loaded.capture.release(original.id); await loaded.persistence.release(snapshot);
      }
      unwrap(await instance.bind({ [stop.call.port]: async () => ({ kind: 'reply', value: tape[i].output }) })); assert.equal(unwrap(await instance.run()).accepted, true);
    }
    const done = unwrap(await instance.inspect()); assert.equal(done.kind, 'done'); assert.deepEqual(done.result, expected);
    const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 10000 })).records; assert.equal((await replayCard(cardDefinition, records, { controlled })).ok, true);
    await instance.close(); await loaded.capture.release(instance.id);
  });
}

test('Forge card Instance uses the unchanged BaseGame contract and rejects foreign replies', async () => {
  const loaded: any = unwrap(await createCardLoader().load(cardDefinition)); const instance = unwrap(await loaded.core.start({ profile: 'forge-duel-v1', seed: 87, first: '0', decks: { '0': [...baseDeck], '1': [...baseDeck] } }));
  const handle = unwrap(await createGameBinder().bind({ instance, contract: game.contract, persistence: loaded.persistence }));
  unwrap(await handle.run());
  const peer = unwrap(await handle.fork());
  const before = unwrap(await handle.inspect()), peerBefore = unwrap(await peer.inspect());
  const request = before.requests[0];
  // The caller's pre-transfer Instance is revoked; use the public game view.
  assert.equal((await instance.inspect()).ok, false);
  const options = unwrap(await handle.describe({ requestId: request.id, type: request.type }));
  const reply = { requestId: request.id, type: request.type, action: options.values[0] };
  assert.equal(unwrap(await handle.validate({ player: request.player, reply })).valid, true);
  assert.equal(unwrap(await peer.validate({ player: request.player, reply })).valid, false);
  assert.equal(unwrap(await handle.validate({ player: request.player === '0' ? '1' : '0', reply })).valid, false);
  assert.deepEqual(unwrap(await handle.inspect()), before); assert.deepEqual(unwrap(await peer.inspect()), peerBefore);
  await peer.close(); await handle.close();
});
