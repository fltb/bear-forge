import { z } from 'zod';
import type { GameContract } from '@bear-forge/contracts/authoring';
import type { Types } from './game.types.ts';
import type { State, Event } from './forge.schemas.ts';
import { StateSchema, SeatSchema, ObservationSchema, EventSchema, ResultSchema, ActionSchema, RequestSchema, OptionsSchema } from './forge.schemas.ts';
import { legal, sameAction, decisionKey, observe, project } from './rules.ts';
export const contract: GameContract<Types> = {
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
            // The pure adapter borrows the Core's stable publication; BaseGame
            // still runs the declared view schema before exposing requests.
            view: state as State,
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
            events: events as Event[],
            output: null
          };
        }
      }
    },
    finish(state) {
      if (!state.result) throw Error('Nonterminal game');
      return {
        view: state as State,
        result: state.result
      };
    },
    observe(state, player) {
      return observe(state as State, player);
    },
    projectEvent(event, player) {
      return project(event as Event, player);
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
  };
