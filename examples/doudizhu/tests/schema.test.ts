import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameData } from '@bear-forge/boundary';
import { createCardLoader } from '@bear-forge/runtime-card';
import { cardDefinition } from '../src/card.ts';
import { contract } from '../src/module.ts';
import { observe } from '../src/contract.ts';
import { FrameSchema, ObservedSchema, LegalActionsSchema } from '../src/schemas.ts';
const unwrap = (result: any): any => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const alter = (value: any, change: (value: any) => void) => { const copy = structuredClone(value); change(copy); return copy; };
function parity(original: any, optimized: any, values: unknown[]) {
  for (const value of values) {
    const before = structuredClone(value), expected = original.safeParse(value), actual = optimized.safeParse(value);
    assert.equal(actual.success, expected.success);
    if (expected.success) {
      assert.equal(sameData(actual.data, expected.data), true);
      assert.deepEqual(Object.keys(actual.data), Object.keys(expected.data));
    } else assert.equal(actual.error.message, expected.error.message);
    let direct;
    try { direct = { success: true, data: optimized.parse(value) }; }
    catch (error: any) { direct = { success: false, error }; }
    assert.equal(direct.success, expected.success);
    if (expected.success) assert.equal(sameData(direct.data, expected.data), true);
    else assert.equal(direct.error.message, expected.error.message);
    assert.equal(sameData(value, before), true, 'fixed validation must not mutate its input');
  }
}

test('fixed DDZ validators retain Frame consistency, alias normalization, numeric edges and original errors', async () => {
  const loaded = unwrap(await createCardLoader({ controlled: false }).load(cardDefinition));
  const instance = unwrap(await loaded.core.start({ game: { profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0 }, seed: 31 }));
  try {
    let stop = unwrap(await instance.inspect());
    while (stop.kind === 'call' && stop.call.port === 'event') {
      unwrap(await instance.bind({ event: async () => ({ kind: 'reply', value: null }) })); stop = unwrap(await instance.run()).state;
    }
    assert.equal(stop.kind, 'call'); assert.equal(stop.call.port, 'decision');
    const frame = stop.call.input;
    const aliased = alter(frame, v => {
      const play = { kind: 'play', cards: [3], pattern: { kind: 'single', high: 3, length: 1 } };
      v.state.last = { actor: '0', play };
      v.state.events.push({ audience: 'public', event: { type: 'play', actor: '0', play } });
    });
    parity(FrameSchema, cardDefinition.schemas.result, [frame, aliased,
      alter(frame, v => { v.state.now = -0; v.state.setup.initialGameTime = -0; }),
      alter(frame, v => { v.state.stage.slots.push(structuredClone(v.state.stage.slots[0])); }),
      alter(frame, v => { v.state.stage.slots[0].deadline.atGameTime = Number.MAX_SAFE_INTEGER + 1; }),
      alter(frame, v => { v.state.phase = 'ended'; }),
      alter(frame, v => { v.events = [{ audience: 'public', event: { type: 'redeal' } }]; }),
    ]);
    const observation = observe(frame, '0');
    parity(ObservedSchema, contract.schemas.observation, [observation,
      alter(observation, v => { v.observation.actor = 'wrong'; }), alter(observation, v => { v.extra = true; })]);
    parity(LegalActionsSchema, contract.inputs.action.options, [
      { kind: 'exact', values: [{ kind: 'bid', value: 1 }] },
      { kind: 'exact', values: [{ kind: 'play', cards: [4, 3], pattern: { kind: 'pair', high: 4, length: 2 } }] },
      { kind: 'exact', values: [{ kind: 'bid', value: 4 }] },
    ]);
  } finally { await instance.close(); await loaded.capture?.release(instance.id); }
});
