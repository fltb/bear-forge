import { RuleViolation } from './errors.ts';
import { seats, FrameSchema, ActionSchema } from './schemas.ts';
import type { State, Seat, Action, Result, AuditEvent, Frame, Input } from './schemas.ts';
import { beats, classify, contained, key } from './patterns.ts';

export const next = (seat: Seat): Seat => seats[(Number(seat) + 1) % 3]!;
export const event = (s: State, e: AuditEvent['event'], audience: AuditEvent['audience'] = 'public') => s.events.push({ audience, event: e });
export function stage(s: State, actors: Seat[]) {
  s.stageSequence++;
  if (s.phase === 'dealing' || s.phase === 'ended') throw new RuleViolation('nondecision phase');
  const stageId = `deal${s.deal}:stage${s.stageSequence}`;
  s.stage = { stageId, boundaryKey: `boundary${s.boundarySequence}`, hostInputs: ['timeout'], slots: actors.map(actor => ({ slotId: `${stageId}:${actor}`, actor, actionSpec: { phase: s.phase as 'bidding' | 'doubling' | 'redoubling' | 'playing', actor }, onTimeout: { inputType: 'timeout', payload: { slotId: `${stageId}:${actor}` } }, deadline: { atGameTime: s.now + 25000, equality: 'timeoutFirst', timeoutRule: 'competitive-2016-bear-1' } })) };
}
export function revealBottom(s: State) {
  const landlord = s.landlord!;
  s.bottomRevealed = true; s.hands[landlord].push(...s.bottom); s.hands[landlord].sort((a,b) => a-b);
  event(s, { type: 'bottom', cards: [...s.bottom] }); s.phase = 'playing'; s.turn = landlord; stage(s, [landlord]);
}
export function settle(s: State, winner: Seat): Result {
  const landlord = s.landlord!;
  const spring = winner === landlord && seats.filter(a => a !== landlord).every(a => s.playCounts[a] === 0);
  const reverseSpring = winner !== landlord && s.playCounts[landlord] === 1;
  const scores = { '0': 0, '1': 0, '2': 0 };
  for (const farmer of seats.filter(a => a !== landlord)) {
    const exponent = s.bombs + s.rockets + Number(spring || reverseSpring) + (s.doubles[farmer] ? 1 + Number(s.redoubled) : 0);
    scores[farmer] = s.highBid * 2 ** exponent * (winner === landlord ? -1 : 1);
    scores[landlord] -= scores[farmer];
  }
  return { winner, winningSide: winner === landlord ? 'landlord' : 'farmers', landlord, bid: s.highBid, bombs: s.bombs, rockets: s.rockets, spring, reverseSpring, doubles: { ...s.doubles }, redoubled: s.redoubled, scores };
}
export function validAction(s: State, actor: Seat, a: Action): boolean {
  if (!ActionSchema.safeParse(a).success) return false;
  if (s.phase === 'bidding') return actor === s.turn && a.kind === 'bid' && (a.value === 0 || a.value > s.highBid);
  if (s.phase === 'doubling') return actor !== s.landlord && s.doubles[actor] === null && a.kind === 'double';
  if (s.phase === 'redoubling') return actor === s.landlord && a.kind === 'redouble';
  if (s.phase !== 'playing' || actor !== s.turn) return false;
  if (a.kind === 'pass') return s.last !== null && s.last.actor !== actor;
  if (a.kind !== 'play' || !contained(a.cards, s.hands[actor]) || !classify(a.cards).some(p => key(p) === key(a.pattern))) return false;
  return !s.last || beats(a.pattern, s.last.play.pattern);
}
export function validateInput(s: State, input: Input): { actor: Seat; action: Action; at: number; slotId: string } {
  const pending = s.stage;
  if (!pending || s.phase === 'ended') throw new RuleViolation('no decision pending');
  if (input.kind === 'action') {
    const slot = pending.slots.find(x => x.slotId === input.slotId && x.actor === input.actor);
    if (!slot || input.stageId !== pending.stageId || input.receivedAtGameTime < s.now || input.receivedAtGameTime >= slot.deadline!.atGameTime) throw new RuleViolation('stale, unauthorized or expired decision');
    const actor = slot.actor as Seat, action = input.action;
    if (!validAction(s, actor, action)) throw new RuleViolation('illegal action');
    return { actor, action, at: input.receivedAtGameTime, slotId: slot.slotId };
  }
  if (input.inputType !== 'timeout' || input.boundaryKey !== pending.boundaryKey) throw new RuleViolation('invalid host input');
  const timeout = input.payload, slot = pending.slots.find(x => x.slotId === timeout.slotId);
  if (!slot || input.gameTime < s.now || input.gameTime < slot.deadline!.atGameTime) throw new RuleViolation('timeout not due');
  const actor = slot.actor as Seat;
  const action: Action = s.phase === 'bidding' ? { kind: 'bid', value: 0 } : s.phase === 'doubling' ? { kind: 'double', value: false } : s.phase === 'redoubling' ? { kind: 'redouble', value: false } : s.last ? { kind: 'pass' } : { kind: 'play', cards: [Math.min(...s.hands[actor])], pattern: { kind: 'single', high: Math.min(...s.hands[actor]), length: 1 } };
  return { actor, action, at: input.gameTime, slotId: slot.slotId };
}
/** Mutates only this program's owned game state, after complete validation. */
export function apply(s: State, input: Input) {
  const { actor, action: a, at, slotId } = validateInput(s, input);
  s.now = at; s.boundarySequence++; s.delta = { consumed: [slotId], invalidated: [] };
  s.stage!.slots = s.stage!.slots.filter(x => x.slotId !== slotId); s.stage!.boundaryKey = `boundary${s.boundarySequence}`;
  if (a.kind === 'bid') {
    s.bidCount++; event(s, { type: 'bid', actor, value: a.value });
    if (a.value > s.highBid) { s.highBid = a.value; s.landlord = actor; }
    if (a.value === 3 || s.bidCount === 3) {
      if (s.landlord === null) { event(s, { type: 'redeal' }); s.firstBidder = next(s.firstBidder); s.phase = 'dealing'; s.stage = null; }
      else { event(s, { type: 'landlord', actor: s.landlord, bid: s.highBid }); s.phase = 'doubling'; stage(s, seats.filter(x => x !== s.landlord)); }
    } else { s.turn = next(actor); stage(s, [s.turn]); }
  } else if (a.kind === 'double') {
    s.doubles[actor] = a.value; event(s, { type: 'doubleChosen', actor, value: a.value }, actor);
    if (seats.filter(x => x !== s.landlord).every(x => s.doubles[x] !== null)) {
      s.doublesRevealed = true; event(s, { type: 'doublesRevealed', values: { ...s.doubles } });
      if (seats.some(x => s.doubles[x])) { s.phase = 'redoubling'; stage(s, [s.landlord!]); } else revealBottom(s);
    }
  } else if (a.kind === 'redouble') { s.redoubled = a.value; event(s, { type: 'redouble', actor, value: a.value }); revealBottom(s); }
  else if (a.kind === 'pass') {
    event(s, { type: 'pass', actor }); s.passes++;
    if (s.passes === 2) { s.turn = s.last!.actor; s.last = null; s.passes = 0; } else s.turn = next(actor);
    stage(s, [s.turn]);
  } else {
    for (const rank of a.cards) s.hands[actor].splice(s.hands[actor].indexOf(rank), 1);
    s.playCounts[actor]++; s.passes = 0; s.last = { actor, play: a };
    if (a.pattern.kind === 'bomb') s.bombs++;
    if (a.pattern.kind === 'rocket') s.rockets++;
    event(s, { type: 'play', actor, play: a });
    if (s.hands[actor].length < 2) event(s, { type: 'lastCard', actor, count: s.hands[actor].length });
    if (!s.hands[actor].length) { s.phase = 'ended'; s.stage = null; s.result = settle(s, actor); event(s, { type: 'result', result: s.result }); }
    else { s.turn = next(actor); stage(s, [s.turn]); }
  }
}
export function frame(s: State, eventOffset: number): Frame {
  return FrameSchema.parse({state:s,events:s.events.slice(eventOffset)});
}
