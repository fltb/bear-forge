import type { Setup, State, Seat, Action, Observation, Event, Result } from './forge.schemas.ts';
export type Ports = {
  decision: {
    kind: 'request';
    input: State;
    output: Action;
  };
  event: {
    kind: 'event';
    input: Event[];
    output: null;
  };
};
export type Types = {
  setup: Setup;
  ports: Ports;
  programResult: State;
  view: State;
  actions: {
    move: {
      request: {
        decision: string;
      };
      action: Action;
      description: never;
    };
  };
  player: Seat;
  observation: Observation;
  event: Event;
  playerEvent: Event;
  result: Result;
  control: never;
};
