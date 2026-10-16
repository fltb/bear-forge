import { z } from 'zod';
import { createGameSDK } from './game-sdk.ts';
import type { GameModule } from '@bear-forge/contracts/authoring';
import type { Types, Ports } from './game.types.ts';
import { SetupSchema, StateSchema, SeatSchema, ObservationSchema, EventSchema, ResultSchema, ActionSchema, RequestSchema, OptionsSchema, gamePorts } from './forge.schemas.ts';
import { create, apply, legal, sameAction, available, decisionKey, observe, project } from './rules.ts';
export const game: GameModule<Types> = {
  program: {
    schemas: {
      setup: SetupSchema,
      result: StateSchema,
      ports: gamePorts
    },
    async run(setup, io) {
      const state = create(setup),
        sdk = createGameSDK<Ports>(io, gamePorts);
      while (!state.result) {
        available(state);
        if (state.pending.length) await sdk.event(state.pending.splice(0));
        const action = await sdk.decision(state);
        apply(state, action);
      }
      if (state.pending.length) await sdk.event(state.pending.splice(0));
      return state;
    }
  },
  contract: {
    schemas: {
      view: StateSchema,
      player: SeatSchema,
      observation: ObservationSchema,
      event: EventSchema,
      playerEvent: EventSchema,
      result: ResultSchema,
      actions: {
        move: {
          request: RequestSchema,
          action: ActionSchema,
          description: z.never()
        }
      }
    },
    ports: {
      decision: {
        kind: 'request',
        receive(state) {
          return {
            view: StateSchema.parse(state),
            requests: state.result ? [] : [{
              key: decisionKey(state),
              player: state.active,
              type: 'move',
              data: {
                decision: decisionKey(state)
              }
            }]
          };
        },
        respond(state, request, action) {
          if (state.result || request.player !== state.active || request.key !== decisionKey(state)) return {
            valid: false,
            reason: 'request_mismatch'
          };
          const checked = ActionSchema.safeParse(action);
          return checked.success && legal(state as any).some(candidate => sameAction(candidate, checked.data)) ? {
            valid: true,
            output: checked.data
          } : {
            valid: false,
            reason: 'illegal_action'
          };
        }
      },
      event: {
        kind: 'event',
        receive(events) {
          return {
            events: EventSchema.array().parse(events),
            output: null
          };
        }
      }
    },
    finish(state) {
      const parsed = StateSchema.parse(state);
      if (!parsed.result) throw Error('Nonterminal game');
      return {
        view: parsed,
        result: parsed.result
      };
    },
    observe(state, player) {
      return ObservationSchema.parse(observe(state as any, player));
    },
    projectEvent(event, player) {
      return project(EventSchema.parse(event), player);
    },
    inputs: {
      move: {
        options: OptionsSchema,
        describe(state, request) {
          if (request.player !== state.active || request.key !== decisionKey(state)) throw Error('Request mismatch');
          return {
            kind: 'exact',
            values: legal(state as any)
          };
        }
      }
    }
  }
};
export const program = game.program;
