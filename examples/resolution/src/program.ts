import { createResolution, invoke } from '@bear-forge/card-engine';
import { spellEffect } from './effects.ts';
import type { ProgramModule, IO } from '@bear-forge/contracts/core';
import type { z } from 'zod';
import { SetupSchema, StateSchema, RequestSchema, ActionSchema } from './resolution.schemas.ts';
import type { State, Action } from './resolution.schemas.ts';
export type Setup = z.infer<typeof SetupSchema>;
export type Ports = {
  decision: {
    kind: 'request';
    input: z.infer<typeof RequestSchema>;
    output: Action;
  };
};
const ports = {
  decision: {
    kind: 'request' as const,
    input: RequestSchema,
    output: ActionSchema
  }
};
export const program = {
  schemas: {
    setup: SetupSchema,
    result: StateSchema,
    ports
  },
  async run(setup: Setup, io: IO<Ports>) {
    const state: State = {
      hp: [10, 10],
      mana: 3,
      hands: [['F'], setup.variant === 'double-prevent' ? ['U1', 'U2'] : ['U']],
      deck: ['P', 'B', 'S', 'M', 'N'],
      discard: [[], []],
      board: [{
        id: 'W',
        owner: '0',
        hp: 2
      }, {
        id: 'L',
        owner: '1',
        hp: 2
      }, {
        id: 'G',
        owner: '1',
        hp: 3
      }],
      damage: 0,
      triggers: [],
      events: []
    };
    return await invoke(createResolution(state, io), spellEffect, setup);
  }
} satisfies ProgramModule<Setup, Ports, State>;
