import type {State} from './schemas.ts';
import {event,stage} from './rules.ts';
export function dealState(s: State, random: (maximum: number) => number) {
  const deck = Array.from({ length: 54 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('toolkit randomInt returned outside requested range');
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const rank = (id: number) => id < 52 ? Math.floor(id / 4) + 3 : id - 36;
  s.deal++; s.hands = { '0': [], '1': [], '2': [] };
  for (let i = 0; i < 51; i++) s.hands[String(i % 3) as '0' | '1' | '2'].push(rank(deck[i]!));
  for (const hand of Object.values(s.hands)) hand.sort((a,b) => a-b);
  s.bottom = deck.slice(51).map(rank); s.bottomRevealed = false; s.landlord = null;
  s.bidCount = 0; s.highBid = 0; s.turn = s.firstBidder;
  s.doubles = { '0': null, '1': null, '2': null }; s.doublesRevealed = false; s.redoubled = false;
  s.last = null; s.passes = 0; s.bombs = 0; s.rockets = 0; s.playCounts = { '0': 0, '1': 0, '2': 0 }; s.result = null;
  s.phase = 'bidding'; event(s, { type: 'deal', deal: s.deal, firstBidder: s.firstBidder }); stage(s, [s.turn]);
}
