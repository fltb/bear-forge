import { SetupSchema } from './forge.schemas.ts';
import type { Setup, State, Seat, Definition, Action, Event, Observation } from './forge.schemas.ts';
export const cards: Record<Definition, {
  cost: number;
  attack: number;
  hp: number;
}> = {
  scout: {
    cost: 1,
    attack: 2,
    hp: 1
  },
  guard: {
    cost: 2,
    attack: 1,
    hp: 4
  },
  beast: {
    cost: 3,
    attack: 4,
    hp: 3
  },
  witness: {
    cost: 3,
    attack: 2,
    hp: 3
  },
  spark: {
    cost: 1,
    attack: 0,
    hp: 0
  },
  blast: {
    cost: 3,
    attack: 0,
    hp: 0
  },
  supply: {
    cost: 2,
    attack: 0,
    hp: 0
  },
  repair: {
    cost: 1,
    attack: 0,
    hp: 0
  }
};
export const baseDeck: Definition[] = ['scout', 'scout', 'guard', 'guard', 'beast', 'beast', 'witness', 'witness', 'spark', 'spark', 'supply', 'supply'];
export const other = (seat: Seat): Seat => seat === '0' ? '1' : '0';
export const decisionKey = (s: {
  step: number;
}) => 'decision:' + s.step;
export function emit(s: State, kind: Event['kind'], actor: Seat, extra: Partial<Event> = {}) {
  const visibility = extra.visibility ?? 'public';
  const namespace = visibility === 'public' ? 'public' : visibility + ':' + actor;
  const ordinal = s.history.filter(e => e.visibility === visibility && (visibility === 'public' || e.actor === actor)).length;
  const event: Event = {
    key: 'forge-duel-v1:' + namespace + ':' + ordinal,
    kind,
    actor,
    decision: decisionKey(s),
    cause: s.cause,
    definition: null,
    cardId: null,
    target: null,
    amount: null,
    visibility: 'public',
    ...extra
  };
  s.sequence++;
  s.history.push(event);
  s.pending.push(event);
}
export function settle(s: State) {
  if (s.result) return;
  const a = s.heroes['0'].hp <= 0,
    b = s.heroes['1'].hp <= 0;
  if (!a && !b) return;
  finish(s, a && b ? null : a ? '1' : '0', 'lethal');
}
function finish(s: State, winner: Seat | null, reason: 'lethal' | 'turn-limit') {
  s.result = {
    winner,
    reason,
    scores: {
      '0': winner === null ? 0.5 : winner === '0' ? 1 : 0,
      '1': winner === null ? 0.5 : winner === '1' ? 1 : 0
    }
  };
  emit(s, 'result', s.active, {
    amount: s.result.scores[s.active]
  });
}
function heal(s: State, seat: Seat, amount: number) {
  const hero = s.heroes[seat],
    before = hero.hp;
  hero.hp = Math.min(20, hero.hp + amount);
  emit(s, 'heal', seat, {
    target: 'hero:' + seat,
    amount: hero.hp - before
  });
}
export function deaths(s: State) {
  for (const seat of ['0', '1'] as const) {
    const hero = s.heroes[seat],
      dead = hero.board.filter(u => u.hp <= 0);
    hero.board = hero.board.filter(u => u.hp > 0);
    for (const unit of dead) {
      hero.discard.push(unit.card);
      emit(s, 'death', seat, {
        definition: unit.card.definition,
        cardId: unit.card.id,
        target: unit.id
      });
    }
    for (const witness of hero.board.filter(u => u.card.definition === 'witness')) for (const deadUnit of dead) if (witness.id !== deadUnit.id) heal(s, seat, 1);
  }
  settle(s);
}
export function draw(s: State, seat: Seat) {
  if (s.result) return;
  const hero = s.heroes[seat],
    card = hero.deck.shift();
  if (!card) {
    const amount = ++hero.fatigue;
    hero.hp -= amount;
    emit(s, 'damage', seat, {
      target: 'hero:' + seat,
      amount
    });
    settle(s);
    return;
  }
  if (hero.hand.length === 8) {
    hero.discard.push(card);
    emit(s, 'burn', seat, {
      definition: card.definition,
      cardId: card.id
    });
    return;
  }
  hero.hand.push(card);
  emit(s, 'draw', seat, {
    definition: card.definition,
    cardId: card.id,
    visibility: 'owner'
  });
}
export function begin(s: State, seat: Seat) {
  s.active = seat;
  const hero = s.heroes[seat];
  hero.turns++;
  hero.maxMana = Math.min(6, hero.maxMana + 1);
  hero.mana = hero.maxMana;
  for (const unit of hero.board) unit.ready = true;
  emit(s, 'turn', seat, {
    amount: hero.turns
  });
  draw(s, seat);
}
export function create(setup: Setup): State {
  setup = SetupSchema.parse(setup);
  const hero = () => ({
    hp: 20,
    mana: 0,
    maxMana: 0,
    turns: 0,
    fatigue: 0,
    deck: [],
    hand: [],
    board: [],
    discard: []
  });
  const s: State = {
    setup,
    heroes: {
      '0': hero(),
      '1': hero()
    },
    active: setup.first,
    random: setup.seed >>> 0,
    entity: 0,
    step: 0,
    sequence: 0,
    cause: null,
    result: null,
    history: [],
    pending: []
  };
  for (const seat of ['0', '1'] as const) {
    const deck = setup.decks[seat].map((definition, index) => ({
      id: 'card:' + seat + ':' + index,
      definition
    }));
    for (const card of deck) emit(s, 'carry', seat, {
      definition: card.definition,
      cardId: card.id,
      visibility: 'audit'
    });
    for (let i = deck.length - 1; i > 0; i--) {
      s.random = Math.imul(s.random, 1664525) + 1013904223 >>> 0;
      const j = s.random % (i + 1),
        card = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = card;
    }
    s.heroes[seat].deck = deck;
    for (let i = 0; i < 3; i++) draw(s, seat);
  }
  begin(s, setup.first);
  return s;
}
const enemyTargets = (s: State, seat: Seat) => ['hero:' + other(seat), ...s.heroes[other(seat)].board.map(u => u.id)];
export function legal(s: State, seat = s.active): Action[] {
  if (s.result || seat !== s.active) return [];
  const hero = s.heroes[seat],
    actions: Action[] = [];
  for (const card of hero.hand) {
    const rule = cards[card.definition];
    if (rule.cost > hero.mana) continue;
    if (rule.attack) {
      if (hero.board.length < 4) actions.push({
        kind: 'play',
        cardId: card.id,
        target: null
      });
    } else if (card.definition === 'spark' || card.definition === 'blast') {
      for (const target of enemyTargets(s, seat)) actions.push({
        kind: 'play',
        cardId: card.id,
        target
      });
    } else actions.push({
      kind: 'play',
      cardId: card.id,
      target: null
    });
  }
  const guards = s.heroes[other(seat)].board.filter(u => u.card.definition === 'guard');
  const targets = guards.length ? guards.map(u => u.id) : enemyTargets(s, seat);
  for (const unit of hero.board) if (unit.ready) for (const target of targets) actions.push({
    kind: 'attack',
    unitId: unit.id,
    target
  });
  actions.push({
    kind: 'end'
  });
  return actions;
}
export function available(s: State) {
  const used = new Set<string>();
  for (const action of legal(s)) {
    if (action.kind !== 'play' || used.has(action.cardId)) continue;
    used.add(action.cardId);
    const card = s.heroes[s.active].hand.find(c => c.id === action.cardId)!;
    emit(s, 'available', s.active, {
      definition: card.definition,
      cardId: card.id,
      visibility: 'audit'
    });
  }
}
function damage(s: State, target: string, amount: number) {
  for (const seat of ['0', '1'] as const) {
    if (target === 'hero:' + seat) {
      s.heroes[seat].hp -= amount;
      emit(s, 'damage', seat, {
        target,
        amount
      });
      return;
    }
    const unit = s.heroes[seat].board.find(u => u.id === target);
    if (unit) {
      unit.hp -= amount;
      emit(s, 'damage', seat, {
        target,
        amount,
        definition: unit.card.definition,
        cardId: unit.card.id
      });
      return;
    }
  }
  throw Error('Unknown target');
}
export function apply(s: State, action: Action) {
  if (!legal(s).some(a => JSON.stringify(a) === JSON.stringify(action))) throw Error('Illegal action');
  const seat = s.active,
    hero = s.heroes[seat];
  s.cause = 'action:' + s.step;
  if (action.kind === 'end') {
    if (hero.turns >= 30) finish(s, null, 'turn-limit');else begin(s, other(seat));
  } else if (action.kind === 'play') {
    const index = hero.hand.findIndex(c => c.id === action.cardId),
      card = hero.hand.splice(index, 1)[0]!,
      rule = cards[card.definition];
    hero.mana -= rule.cost;
    emit(s, 'play', seat, {
      definition: card.definition,
      cardId: card.id,
      target: action.target
    });
    if (rule.attack) hero.board.push({
      id: 'unit:' + s.entity++,
      card,
      attack: rule.attack,
      hp: rule.hp,
      ready: false
    });else {
      hero.discard.push(card);
      if (card.definition === 'spark' || card.definition === 'blast') {
        damage(s, action.target!, card.definition === 'spark' ? 2 : 4);
        deaths(s);
      } else if (card.definition === 'supply') {
        draw(s, seat);
        draw(s, seat);
      } else heal(s, seat, 3);
    }
  } else {
    const unit = hero.board.find(u => u.id === action.unitId)!;
    unit.ready = false;
    emit(s, 'attack', seat, {
      cardId: unit.card.id,
      definition: unit.card.definition,
      target: action.target
    });
    const enemy = s.heroes[other(seat)].board.find(u => u.id === action.target);
    damage(s, action.target, unit.attack);
    if (enemy) damage(s, unit.id, enemy.attack);
    deaths(s);
  }
  settle(s);
  s.step++;
  s.cause = null;
}
export function project(event: Event, player: Seat): {
  event: Event;
} | null {
  if (event.visibility === 'audit') return null;
  if (event.visibility === 'owner' && event.actor !== player) return {
    event: {
      ...event,
      definition: null,
      cardId: null
    }
  };
  return {
    event: {
      ...event
    }
  };
}
export function observe(s: State, player: Seat): Observation {
  const publicHero = (seat: Seat) => {
    const h = s.heroes[seat];
    return {
      hp: h.hp,
      mana: h.mana,
      maxMana: h.maxMana,
      turns: h.turns,
      fatigue: h.fatigue,
      deckCount: h.deck.length,
      handCount: h.hand.length,
      board: h.board,
      discard: h.discard
    };
  };
  return {
    player,
    active: s.active,
    hand: s.heroes[player].hand,
    heroes: {
      '0': publicHero('0'),
      '1': publicHero('1')
    },
    history: s.history.flatMap(e => {
      const p = project(e, player);
      return p ? [p.event] : [];
    }),
    result: s.result
  };
}
