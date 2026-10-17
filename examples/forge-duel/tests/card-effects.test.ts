import test from 'node:test';
import assert from 'node:assert/strict';
import { CardProgram, CardMachine, plainCardStorage } from '@bear-forge/card-engine';
import { CardGraph } from '../../../packages/runtime-card/src/graph.ts';
import { cardDefinition } from '../src/card.ts';
import { create, apply, legal, baseDeck, cards } from './reference/rules.ts';
import type { State, Definition, Unit } from '../src/forge.schemas.ts';
const setup = { profile: 'forge-duel-v1' as const, seed: 87, first: '0' as const, decks: { '0': [...baseDeck], '1': [...baseDeck] } };
const unit = (id: string, definition: Definition, hp = cards[definition].hp): Unit => ({ id, card: { id: 'card:' + id, definition }, hp, attack: cards[definition].attack, ready: true });
function scene(): State {
  const s = create(setup); s.pending = []; s.heroes['0'].mana = s.heroes['0'].maxMana = 6; s.heroes['0'].hp = 10;
  s.heroes['0'].board = [unit('attacker', 'beast', 1), unit('witness', 'witness')]; s.heroes['1'].board = [unit('guard', 'guard', 1), unit('enemyWitness', 'witness')]; return s;
}
function execute(base: State, action: any, controlled: boolean) {
  const program = new CardProgram({ ...cardDefinition, entry: 'action', initialize: () => structuredClone(base) });
  const root = program.initial(setup); root.frames[0]!.input = action;
  const storage = controlled ? new CardGraph(root) : plainCardStorage(root, structuredClone), machine = new CardMachine(program, storage);
  const stop = machine.advance(); const state = storage.export(machine.root.state); if (storage instanceof CardGraph) storage.close(); return { stop, state };
}
for (const controlled of [false, true]) for (const definition of Object.keys(cards) as Definition[]) {
  test(`dedicated core ${definition}, every legal action/target, controlled ${controlled}`, () => {
    const base = scene(); base.heroes['0'].hand = [{ id: 'played', definition }];
    for (const action of legal(base)) { const expected = structuredClone(base); apply(expected, action); const actual = execute(base, action, controlled); assert.equal(actual.stop.kind, 'done'); assert.deepEqual(actual.state, expected, JSON.stringify(action)); }
  });
}
for (const controlled of [false, true]) for (const variant of ['fatigue', 'overflow', 'turn-limit', 'both-lethal'] as const) {
  test(`dedicated core checkpoint ${variant}, controlled ${controlled}`, () => {
    const base = scene(); base.heroes['0'].hand = [{ id: 'supply', definition: 'supply' }];
    if (variant === 'fatigue') { base.heroes['0'].deck = []; base.heroes['0'].hp = 1; }
    if (variant === 'overflow') base.heroes['0'].hand.push(...Array.from({ length: 7 }, (_, i) => ({ id: 'h' + i, definition: 'scout' as const })));
    if (variant === 'turn-limit') base.heroes['0'].turns = 30;
    if (variant === 'both-lethal') base.heroes['0'].hp = base.heroes['1'].hp = 0;
    const action = variant === 'turn-limit' ? { kind: 'end' as const } : { kind: 'play' as const, cardId: 'supply', target: null };
    const expected = structuredClone(base); apply(expected, action); assert.deepEqual(execute(base, action, controlled).state, expected);
  });
}
test('dedicated rule validation faults before payment/cause/mutation', () => {
  const base = scene(); for (const controlled of [false, true]) { const actual = execute(base, { kind: 'play', cardId: 'absent', target: null }, controlled); assert.equal(actual.stop.kind, 'fault'); assert.deepEqual(actual.state, base); }
});
