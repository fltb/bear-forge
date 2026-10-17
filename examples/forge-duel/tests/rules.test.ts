import { runCard } from '../../../packages/runtime-card/tests/run-support.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create, apply, legal, baseDeck, observe, cards, game } from '../src/index.ts';
import { deaths, draw, settle } from '../src/rules.ts';
import type { State, Action, Unit } from '../src/index.ts';
const setup = {
  profile: 'forge-duel-v1' as const,
  seed: 9,
  first: '0' as const,
  decks: {
    '0': baseDeck,
    '1': baseDeck
  }
};
function state(): State {
  const s = create(setup);
  s.pending = [];
  s.heroes['0'].mana = 6;
  s.heroes['0'].maxMana = 6;
  s.heroes['0'].hand = [];
  s.heroes['1'].board = [];
  return s;
}
const unit = (id: string, definition: Unit['card']['definition'], hp = cards[definition].hp, ready = true): Unit => ({
  id,
  card: {
    id: 'card:' + id,
    definition
  },
  attack: cards[definition].attack,
  hp,
  ready
});
test('guard restricts attacks but not spells; readiness, mana and capacity are enforced', () => {
  const s = state();
  s.heroes['0'].board = [unit('scout', 'scout')];
  s.heroes['1'].board = [unit('guard', 'guard'), unit('beast', 'beast')];
  s.heroes['0'].hand = [{
    id: 'spark',
    definition: 'spark'
  }];
  const options = legal(s);
  assert.deepEqual(options.filter(a => a.kind === 'attack'), [{
    kind: 'attack',
    unitId: 'scout',
    target: 'guard'
  }]);
  assert.ok(options.some(a => a.kind === 'play' && a.target === 'hero:1'));
  apply(s, {
    kind: 'play',
    cardId: 'spark',
    target: 'guard'
  });
  assert.equal(s.heroes['1'].board[0]!.hp, 2);
  apply(s, {
    kind: 'attack',
    unitId: 'scout',
    target: 'guard'
  });
  assert.equal(s.heroes['0'].board.length, 0);
  assert.equal(s.heroes['1'].board.length, 1);
  assert.equal(s.heroes['1'].board[0]!.id, 'beast');
});
test('surviving witnesses heal once per other friendly death; dying witnesses do not', () => {
  const s = state();
  s.heroes['0'].hp = 10;
  s.heroes['0'].board = [unit('w', 'witness'), unit('a', 'scout', 0), unit('b', 'guard', 0), unit('w2', 'witness', 0)];
  deaths(s);
  assert.equal(s.heroes['0'].hp, 13);
  assert.deepEqual(s.heroes['0'].board.map(u => u.id), ['w']);
});
test('draw overflow is public and supply stops after lethal fatigue', () => {
  const s = state();
  s.heroes['0'].hand = Array.from({
    length: 8
  }, (_, i) => ({
    id: 'h' + i,
    definition: 'scout' as const
  }));
  const first = s.heroes['0'].deck[0]!;
  draw(s, '0');
  assert.equal(s.heroes['0'].hand.length, 8);
  assert.deepEqual(s.heroes['0'].discard.at(-1), first);
  assert.equal(s.history.at(-1)!.kind, 'burn');
  s.heroes['0'].deck = [];
  s.heroes['0'].hand = [{
    id: 'supply',
    definition: 'supply'
  }];
  s.heroes['0'].hp = 1;
  apply(s, {
    kind: 'play',
    cardId: 'supply',
    target: null
  });
  assert.equal(s.heroes['0'].fatigue, 1);
  assert.equal(s.result!.winner, '1');
});
test('illegal input leaves the complete world untouched; private observations do not depend on opponent hidden identities', () => {
  const s = state(),
    before = structuredClone(s);
  assert.throws(() => apply(s, {
    kind: 'play',
    cardId: 'missing',
    target: null
  }));
  assert.deepEqual(s, before);
  const a = observe(s, '0');
  s.heroes['1'].hand = s.heroes['1'].hand.map((c, i) => ({
    id: 'secret' + i,
    definition: 'repair'
  }));
  s.heroes['1'].deck = s.heroes['1'].deck.map((c, i) => ({
    id: 'hidden' + i,
    definition: 'blast'
  }));
  assert.deepEqual(observe(s, '0'), a);
});
test('legal action identity is independent of object property order', () => {
  const s = state();
  s.heroes['0'].hand = [{ id: 'spark', definition: 'spark' }];
  const action = { target: 'hero:1', cardId: 'spark', kind: 'play' } as const;
  const port = game.contract.ports.decision as any;
  const request = port.receive(s).requests[0];
  assert.equal(port.respond(s, request, action).valid, true);
  apply(s, action);
  assert.equal(s.heroes['1'].hp, 18);
  const malformed = state();
  malformed.heroes['0'].hand = [{ id: 'spark', definition: 'spark' }];
  assert.throws(() => apply(malformed, { ...action, extra: true } as any), /Illegal action/);
  assert.equal(malformed.heroes['0'].hand.length, 1);
});
test('turn-limit and simultaneous lethal results are normal rules outcomes', () => {
  const s = state();
  s.heroes['0'].turns = 30;
  apply(s, {
    kind: 'end'
  });
  assert.deepEqual(s.result, {
    winner: null,
    reason: 'turn-limit',
    scores: {
      '0': 0.5,
      '1': 0.5
    }
  });
  const t = state();
  t.heroes['0'].hp = 0;
  t.heroes['1'].hp = 0;
  settle(t);
  assert.equal(t.result!.winner, null);
  assert.equal(t.result!.reason, 'lethal');
});
test('an independent brute-force candidate oracle agrees with full legal enumeration', () => {
  for (let seed = 0; seed < 12; seed++) {
    const s = create({
        ...setup,
        seed
      }),
      h = s.heroes[s.active];
    h.mana = seed % 7;
    h.board = [unit('own', 'guard', 4, seed % 2 === 0)];
    s.heroes['1'].board = [unit('enemy', 'guard', 4, seed % 3 === 0)];
    const candidates: Action[] = [{
      kind: 'end'
    }];
    const targets = ['hero:1', 'enemy'];
    for (const c of h.hand) for (const target of [null, ...targets]) candidates.push({
      kind: 'play',
      cardId: c.id,
      target
    });
    for (const target of targets) candidates.push({
      kind: 'attack',
      unitId: 'own',
      target
    });
    const accepted = candidates.filter(a => {
      if (a.kind === 'end') return true;
      if (a.kind === 'attack') return h.board[0]!.ready && a.target === 'enemy';
      const c = h.hand.find(c => c.id === a.cardId)!;
      const r = cards[c.definition];
      if (r.cost > h.mana) return false;
      return r.attack ? a.target === null : h.board.length <= 4 && (c.definition === 'spark' || c.definition === 'blast' ? a.target !== null : a.target === null);
    });
    assert.deepEqual(new Set(legal(s).map(a => JSON.stringify(a))), new Set(accepted.map(a => JSON.stringify(a))));
  }
});
test('the real author loop terminates and emits stable carrying, draw, availability, use and result facts', async () => {
  let calls = 0;
  const end = await runCard(game.definition, setup, {
    async call(call: any) {
      assert.ok(++calls < 400);
      if (call.port === 'event') return null;
      return legal(call.input)[0]!;
    }
  } as any);
  assert.ok(end.result);
  for (const kind of ['carry', 'draw', 'available', 'play', 'result']) assert.ok(end.history.some(e => e.kind === kind), kind);
  assert.equal(new Set(end.history.map(e => e.key)).size, end.history.length);
});
