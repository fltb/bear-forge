import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameData } from '@bear-forge/boundary';
import { cardDefinition } from '../src/card.ts';
import { contract } from '../src/module.ts';
import { StateSchema, ObservationSchema, OptionsSchema } from '../src/forge.schemas.ts';
import { baseDeck, create, observe } from '../src/rules.ts';

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
const alter = (value: any, change: (value: any) => void) => { const copy = structuredClone(value); change(copy); return copy; };

test('fixed Forge validators preserve state/observation values, aliases and original errors', () => {
  const state = create({ profile: 'forge-duel-v1', seed: 87, first: '0', decks: { '0': [...baseDeck], '1': [...baseDeck] } });
  parity(StateSchema, cardDefinition.schemas.result, [state,
    alter(state, v => { v.step = -1; }), alter(state, v => { v.extra = true; }),
    alter(state, v => { v.setup.decks['0'] = Array(12).fill('scout'); }),
    alter(state, v => { v.heroes['0'].hp = Infinity; })]);
  const observation = observe(StateSchema.parse(state), '0');
  parity(ObservationSchema, contract.schemas.observation, [observation,
    alter(observation, v => { v.player = 'wrong'; }), alter(observation, v => { v.heroes['0'].hp = NaN; })]);
  parity(OptionsSchema, contract.inputs.move.options, [
    { kind: 'exact', values: [{ kind: 'end' }] },
    { kind: 'exact', values: [{ kind: 'attack', unitId: 1, target: null }] },
    { kind: 'exact', values: [], extra: 1 },
  ]);
});
