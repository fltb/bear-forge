import { createResolution, invoke, request } from '@bear-forge/card-engine';
import { inputEffect } from './effects.ts';
import type { Program } from '@bear-forge/contracts';
import type { ProgramSetup, Frame } from '../../src/schemas.ts';
import { StateSchema, ProgramSetupSchema, InputSchema } from '../../src/schemas.ts';
import { frame } from '../../src/rules.ts';
import { createSDK } from './sdk.ts';
import type { DouDizhuPorts } from '../../src/types.ts';
import { initialState } from '../../src/initial-state.ts';

export const program: Program<ProgramSetup,DouDizhuPorts,Frame> = async (input, toolkit) => {
  const {game:setup,seed} = ProgramSetupSchema.parse(input);
  const sdk = createSDK(toolkit,seed);
  const state = initialState(setup);
  const context = createResolution(state, toolkit);
  let published = 0;
  while (true) {
    if (state.phase === 'dealing') await sdk.deal(state);
    const output = frame(state, published);
    if (output.events.length > 0) await request(context, { port: 'event', input: output.events });
    published = state.events.length;
    output.events = [];
    if (state.phase === 'ended') return output;
    const reply = await request(context, { port: 'decision', input: output });
    await invoke(context, inputEffect, InputSchema.parse(reply));
  }
};
