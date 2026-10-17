import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolution, invoke } from '@bear-forge/card-engine';
import { actionEffect } from './generic/effects.ts';
import type { State, Definition, Unit } from '../src/forge.schemas.ts';
import type { Ports } from '../src/game.types.ts';
import { create, apply, legal, baseDeck, cards } from './reference/rules.ts';
const unit = (id: string, definition: Definition, hp = cards[definition].hp): Unit => ({
  id, card: { id: 'card:' + id, definition }, hp, attack: cards[definition].attack, ready: true,
});
function scene(): State {
  const state = create({ profile: 'forge-duel-v1', seed: 87, first: '0', decks: { '0': [...baseDeck], '1': [...baseDeck] } });
  state.pending = [];
  state.heroes['0'].mana = 6;
  state.heroes['0'].maxMana = 6;
  state.heroes['0'].hp = 10;
  state.heroes['0'].board = [unit('attacker', 'beast', 1), unit('witness', 'witness')];
  state.heroes['1'].board = [unit('guard', 'guard', 1), unit('enemyWitness', 'witness')];
  return state;
}
for (const definition of Object.keys(cards) as Definition[]) {
  test(`composed ${definition} matches independent old action for every legal target`, async () => {
    const base = scene();
    base.heroes['0'].hand = [{ id: 'played', definition }];
    for (const action of legal(base)) {
      const expected = structuredClone(base), actual = structuredClone(base);
      apply(expected, action);
      const context = createResolution<State, Ports>(actual, { async call() { throw Error('action introduced IO'); } });
      await invoke(context, actionEffect, action);
      assert.deepEqual(actual, expected, JSON.stringify(action));
      assert.deepEqual(context.frames, []);
    }
  });
}
for (const variant of ['fatigue', 'overflow', 'turn-limit', 'both-lethal'] as const) {
  test(`composed action preserves ${variant} checkpoint order`, async () => {
    const base = scene();
    base.heroes['0'].hand = [{ id: 'supply', definition: 'supply' }];
    if (variant === 'fatigue') { base.heroes['0'].deck = []; base.heroes['0'].hp = 1; }
    if (variant === 'overflow') base.heroes['0'].hand.push(...Array.from({ length: 7 }, (_, i) => ({ id: 'h' + i, definition: 'scout' as const })));
    if (variant === 'turn-limit') base.heroes['0'].turns = 30;
    if (variant === 'both-lethal') { base.heroes['0'].hp = 0; base.heroes['1'].hp = 0; }
    const action = variant === 'turn-limit' ? { kind: 'end' as const } : { kind: 'play' as const, cardId: 'supply', target: null };
    const expected = structuredClone(base);
    apply(expected, action);
    const context = createResolution<State, Ports>(base, { async call() { throw Error('unexpected IO'); } });
    await invoke(context, actionEffect, action);
    assert.deepEqual(base, expected);
  });
}
test('composed validation rejects before cause, payment or any other state mutation', async () => {
  const state = scene(), before = structuredClone(state);
  const context = createResolution<State, Ports>(state, { async call() { throw Error('unexpected IO'); } });
  await assert.rejects(invoke(context, actionEffect, { kind: 'play', cardId: 'absent', target: null }), /Illegal action/);
  assert.deepEqual(state, before);
  assert.deepEqual(context.frames, []);
});
