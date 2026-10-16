import test from 'node:test';
import assert from 'node:assert/strict';
import { game } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
import { baseDeck } from './reference/rules.ts';

function projection(module: any, call: any) {
  const contract = module.contract;
  const port = contract.ports[call.port];
  const received = port.receive(structuredClone(call.input));
  if (port.kind === 'event') return {
    received,
    players: ['0', '1'].map(p => received.events.map((e: any) => contract.projectEvent(e, p))),
  };
  return {
    received,
    players: ['0', '1'].map(p => contract.observe(received.view, p)),
    options: received.requests.map((r: any) => contract.inputs.move.describe(received.view, r)),
  };
}

for (const seed of [87, 991]) for (const first of ['0', '1'] as const) {
  test(`frozen reference: full Forge tape, seed ${seed}, first ${first}`, async () => {
    const setup = { profile: 'forge-duel-v1' as const, seed, first, decks: { '0': [...baseDeck], '1': [...baseDeck] } };
    const tape: Array<{ call: any; output: any; projection: any }> = [];
    const expected = await reference.program.run(setup, {
      async call(call: any) {
        assert.ok(tape.length < 600, 'reference must terminate');
        const snapshot = structuredClone(call);
        const projected = projection(reference, snapshot);
        let output: any = null;
        if (call.port === 'decision') {
          const port = reference.contract.ports.decision;
          const { view, requests } = port.receive(call.input);
          const request = requests[0]!;
          const options = reference.contract.inputs.move.describe(view, request);
          assert.equal(options.kind, 'exact');
          if (options.kind !== 'exact') throw Error('exact options required');
          // Reference alone chooses; the candidate receives the identical tape.
          const prepared = port.respond(view, request, options.values[0]!);
          assert.equal(prepared.valid, true);
          output = prepared.output;
        }
        tape.push({ call: snapshot, output: structuredClone(output), projection: projected });
        return output;
      },
    } as any);
    let cursor = 0;
    const actual = await game.program.run(structuredClone(setup), {
      async call(call: any) {
        const recorded = tape[cursor++];
        assert.ok(recorded, 'candidate emitted extra call');
        assert.deepEqual(call, recorded.call, `call ${cursor}`);
        assert.deepEqual(projection(game, call), recorded.projection, `projection ${cursor}`);
        if (call.port === 'decision') {
          const port = game.contract.ports.decision;
          const { view, requests } = port.receive(call.input);
          const accepted = port.respond(view, requests[0]!, recorded.output);
          assert.equal(accepted.valid, true);
          if (accepted.valid) assert.deepEqual(accepted.output, recorded.output);
        }
        return structuredClone(recorded.output);
      },
    } as any);
    assert.equal(cursor, tape.length);
    assert.deepEqual(actual, expected);
    assert.deepEqual(game.contract.finish(actual), reference.contract.finish(expected));
  });
}
