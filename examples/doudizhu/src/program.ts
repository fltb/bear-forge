import type { Program } from '@bear-forge/contracts';
import type { ProgramSetup, Frame } from './schemas.ts';
import { StateSchema, ProgramSetupSchema, InputSchema } from './schemas.ts';
import { apply, frame } from './rules.ts';
import { createSDK } from './sdk.ts';
import type { DouDizhuPorts } from './types.ts';

export const program: Program<ProgramSetup,DouDizhuPorts,Frame> = async (input, toolkit) => {
  const {game:setup,seed} = ProgramSetupSchema.parse(input);
  const sdk = createSDK(toolkit,seed);
  const state = StateSchema.parse({
    setup, phase: 'dealing', deal: 0, firstBidder: setup.firstBidder,
    hands: { '0': [], '1': [], '2': [] }, bottom: [], bottomRevealed: false, landlord: null,
    bidCount: 0, highBid: 0, turn: setup.firstBidder, doubles: { '0': null, '1': null, '2': null }, doublesRevealed: false, redoubled: false,
    last: null, passes: 0, bombs: 0, rockets: 0, playCounts: { '0': 0, '1': 0, '2': 0 },
    now: setup.initialGameTime, stageSequence: 0, boundarySequence: 0, stage: null,
    delta: { consumed: [], invalidated: [] }, events: [], result: null,
  });
  let published = 0;
  while (true) {
    if (state.phase === 'dealing') await sdk.deal(state);
    const output = frame(state, published);
    if (output.events.length > 0) await sdk.event(output.events);
    published = state.events.length;
    output.events = [];
    if (state.phase === 'ended') return output;
    const reply = await sdk.decision(output);
    apply(state, InputSchema.parse(reply));
  }
};
