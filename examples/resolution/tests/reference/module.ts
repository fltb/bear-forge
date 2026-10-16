import { z } from 'zod';
import type { GameModule } from '@bear-forge/contracts/authoring';
import { program } from './program.ts';
import type { Setup, Ports } from './program.ts';
import { StateSchema, ActionSchema, ObservationSchema, SeatSchema, RequestSchema } from './resolution.schemas.ts';
import type { State, Action } from './resolution.schemas.ts';
type View = z.infer<typeof RequestSchema>;
type Event = z.infer<typeof StateSchema>['events'][number];
type Types = {
  setup: Setup;
  ports: Ports;
  programResult: State;
  view: View;
  actions: {
    choice: {
      request: {
        kind: string;
      };
      action: Action;
      description: never;
    };
  };
  player: '0' | '1';
  observation: z.infer<typeof ObservationSchema>;
  event: Event;
  playerEvent: Event;
  result: State;
  control: never;
};
export const game: GameModule<Types> = {
  program,
  contract: {
    schemas: {
      view: RequestSchema,
      player: SeatSchema,
      observation: ObservationSchema,
      event: StateSchema.shape.events.element,
      playerEvent: StateSchema.shape.events.element,
      result: StateSchema,
      actions: {
        choice: {
          request: z.strictObject({
            kind: z.string()
          }),
          action: ActionSchema,
          description: z.never()
        }
      }
    },
    ports: {
      decision: {
        kind: 'request',
        receive(input) {
          return {
            view: RequestSchema.parse(input),
            requests: [{
              key: input.kind,
              player: input.player,
              type: 'choice',
              data: {
                kind: input.kind
              }
            }]
          };
        },
        respond(view, request, action) {
          return request.player === view.player && request.key === view.kind && view.options.some(a => a.kind === action.kind && a.value === action.value) ? {
            valid: true,
            output: ActionSchema.parse(action)
          } : {
            valid: false,
            reason: 'illegal-choice'
          };
        }
      }
    },
    finish(state) {
      return {
        view: {
          state: StateSchema.parse(state),
          player: '0',
          kind: 'ended',
          options: []
        },
        result: StateSchema.parse(state)
      };
    },
    observe(view, player) {
      const state = view.state;
      return ObservationSchema.parse({
        hp: state.hp,
        mana: state.mana,
        hand: state.hands[Number(player)],
        opponentHandCount: state.hands[player === '0' ? 1 : 0].length,
        deckCount: state.deck.length,
        board: state.board,
        discard: state.discard,
        events: state.events.map(e => e.owner !== null && e.owner !== player ? {
          ...e,
          value: null
        } : e)
      });
    },
    projectEvent(event, player) {
      return {
        event: event.owner !== null && event.owner !== player ? {
          ...event,
          value: null
        } : StateSchema.shape.events.element.parse(event)
      };
    },
    inputs: {
      choice: {
        options: z.strictObject({
          kind: z.literal('exact'),
          values: z.array(ActionSchema)
        }),
        describe(view) {
          return {
            kind: 'exact',
            values: view.options.map(a => ActionSchema.parse(a))
          };
        }
      }
    }
  }
};
