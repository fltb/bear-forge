import test from 'node:test';
import assert from 'node:assert/strict';
import { game } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
import type { ProgramSetup, Seat } from '../src/schemas.ts';

// Test-local erasure lets the same recorder inspect both independent contracts.
function projection(module: any, call: any) {
  const contract = module.contract;
  const port = contract.ports[call.port];
  const received = port.receive(structuredClone(call.input));
  if (port.kind === 'event') return {
    received,
    players: ['0', '1', '2'].map(p => received.events.map((e: any) => contract.projectEvent(e, p))),
  };
  return {
    received,
    players: ['0', '1', '2'].map(p => contract.observe(received.view, p)),
    options: received.requests.map((r: any) => contract.inputs.action.describe(received.view, r)),
    session: port.session.request(received.view),
  };
}

for (const firstBidder of ['0', '1', '2'] as Seat[]) for (const reverse of [false, true]) {
  test(`frozen reference: full DDZ tape, first ${firstBidder}, reverse slots ${reverse}`, async () => {
    const setup: ProgramSetup = {
      game: { profile: 'competitive-2016-bear-1', firstBidder, initialGameTime: 0 }, seed: 31,
    };
    const tape: Array<{ call: any; output: any; projection: any }> = [];
    let clockSent = false;
    let timeoutSent = false;
    const expected = await reference.program.run(setup, {
      async call(call: any) {
        assert.ok(tape.length < 600, 'reference must terminate');
        const snapshot = structuredClone(call);
        const projected = projection(reference, snapshot);
        let output: any = null;
        if (call.port === 'decision') {
          const port = reference.contract.ports.decision;
          const { view, requests } = port.receive(call.input);
          const request = reverse ? requests.at(-1)! : requests[0]!;
          // Force a redeal; then exercise both control paths before normal play.
          if (view.state.deal > 1 && !clockSent) {
            const prepared = port.session!.respond(view, { kind: 'clock', at: view.state.now + 1 });
            assert.equal(prepared.valid, true);
            output = prepared.output; clockSent = true;
          } else if (view.state.deal > 1 && !timeoutSent) {
            const slot = view.state.stage!.slots[0]!;
            const prepared = port.session!.respond(view, { kind: 'timeout', slotId: slot.slotId, at: slot.deadline.atGameTime });
            assert.equal(prepared.valid, true);
            output = prepared.output; timeoutSent = true;
          } else {
            const options = reference.contract.inputs.action.describe(view, request);
            assert.equal(options.kind, 'exact');
            if (options.kind !== 'exact') throw Error('exact options required');
            const action = view.state.deal === 1 ? options.values[0]! :
              reverse ? options.values.at(-1)! : options.values.find(a => a.kind === 'play') ?? options.values.at(-1)!;
            const prepared = port.respond(view, request, action);
            assert.equal(prepared.valid, true);
            output = prepared.output;
          }
        }
        tape.push({ call: snapshot, output: structuredClone(output), projection: projected });
        return output;
      },
    } as any);
    assert.ok(clockSent && timeoutSent);
    assert.ok(expected.state.deal >= 2);
    let cursor = 0;
    const actual = await game.program.run(structuredClone(setup), {
      async call(call: any) {
        const recorded = tape[cursor++];
        assert.ok(recorded, 'candidate emitted extra call');
        assert.deepEqual(call, recorded.call, `call ${cursor}`);
        assert.deepEqual(projection(game, call), recorded.projection, `projection ${cursor}`);
        if (call.port === 'decision' && recorded.output.kind === 'action') {
          const port = game.contract.ports.decision;
          const { view, requests } = port.receive(call.input);
          const request = requests.find(r => r.key === recorded.output.slotId)!;
          assert.ok(request);
          const accepted = port.respond(view, request, recorded.output.action);
          assert.equal(accepted.valid, true);
          if (accepted.valid) assert.deepEqual(accepted.output, recorded.output);
        } else if (call.port === 'decision') {
          const port = game.contract.ports.decision;
          const { view } = port.receive(call.input);
          const input = recorded.output;
          const control = input.kind === 'clock' ? input : {
            kind: 'timeout' as const, slotId: input.payload.slotId, at: input.gameTime,
          };
          const accepted = port.session!.respond(view, control);
          assert.equal(accepted.valid, true);
          if (accepted.valid) assert.deepEqual(accepted.output, input);
        }
        return structuredClone(recorded.output);
      },
    } as any);
    assert.equal(cursor, tape.length);
    assert.deepEqual(actual, expected);
    assert.deepEqual(game.contract.finish(actual), reference.contract.finish(expected));
  });
}
