import { StateSchema } from './schemas.ts';
import type { State, Setup } from './schemas.ts';
export function initialState(setup: Setup): State {
  return StateSchema.parse({
    setup, phase: 'dealing', deal: 0, firstBidder: setup.firstBidder,
    hands: { '0': [], '1': [], '2': [] }, bottom: [], bottomRevealed: false, landlord: null,
    bidCount: 0, highBid: 0, turn: setup.firstBidder, doubles: { '0': null, '1': null, '2': null }, doublesRevealed: false, redoubled: false,
    last: null, passes: 0, bombs: 0, rockets: 0, playCounts: { '0': 0, '1': 0, '2': 0 },
    now: setup.initialGameTime, stageSequence: 0, boundarySequence: 0, stage: null,
    delta: { consumed: [], invalidated: [] }, events: [], result: null,
  });
}
