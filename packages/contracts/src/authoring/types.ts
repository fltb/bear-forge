import type { z } from 'zod';
import type { FixedTable, ReadView, PortShape, ProgramModule } from '../core/types.ts';
import type { InteractionTable, Choice, GameInput, InputOptions, QueryShape } from '../game/types.ts';

/** Domain types are supplied by the game; execution locals are not schema slots. */
export type GameTypes = {
  setup: unknown;
  ports: Record<string, PortShape>;
  programResult: unknown;
  view: unknown;
  interactions: InteractionTable;
  actor: unknown;
  delivery: unknown;
  signal: unknown;
  player: string;
  observation: unknown;
  event: unknown;
  playerEvent: unknown;
  result: unknown;
};
export type Submission<G extends GameTypes> = GameInput<G['interactions'], G['delivery'], G['signal']>;
export type DecisionData<G extends GameTypes> = {
  view: G['view'];
  choices: Choice<G['interactions'], G['actor']>[];
  signalPlayers: G['player'][];
};
export type TerminalData<G extends GameTypes> = {
  view: G['view'];
  result: G['result'];
};
export type PreparedReturn<T> = { valid: false; reason: string } | { valid: true; output: T };
/** External ports have one game protocol role. Stateful services execute inside the program. */
export type GamePorts<G extends GameTypes> = FixedTable<G['ports']> & {
  [K in keyof G['ports']]:
    | {
        kind: 'event';
        receive: (input: ReadView<G['ports'][K]['input']>) => { events: G['event'][]; output: G['ports'][K]['output'] };
      }
    | {
        kind: 'decision';
        receive: (input: ReadView<G['ports'][K]['input']>) => DecisionData<G>;
        respond: (view: ReadView<G['view']>, input: ReadView<Submission<G>>, player: G['player']) => PreparedReturn<G['ports'][K]['output']>;
      };
};
export type GameSchemas<G extends GameTypes> = FixedTable<G['interactions']> & {
  [K in 'view' | 'actor' | 'delivery' | 'signal' | 'player' | 'observation' | 'event' | 'playerEvent' | 'result']: z.ZodType<G[K]>;
} & {
  interactions: {
    [K in keyof G['interactions']]: {
      [F in keyof G['interactions'][K]]: z.ZodType<G['interactions'][K][F]>;
    };
  };
};
export type GameInputDefinitions<G extends GameTypes> = {
  [K in keyof G['interactions']]: {
    options: z.ZodType<InputOptions<G['interactions'][K]['input'], G['interactions'][K]['description']>>;
    describe: (view: ReadView<G['view']>, choice: ReadView<{
      id: string; actor: G['actor']; type: K; request: G['interactions'][K]['request'];
    }>) => InputOptions<G['interactions'][K]['input'], G['interactions'][K]['description']>;
  };
};
export type GameQueryDefinition<G extends GameTypes, Q extends QueryShape> = {
  input: z.ZodType<Q['input']>;
  output: z.ZodType<Q['output']>;
  run: (view: ReadView<G['view']>, input: ReadView<Q['input']>) => Q['output'];
};
/** run executes the game; all adapter handlers are pure projections/conversions. */
export type GameContract<G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }> = {
  schemas: GameSchemas<G>;
  ports: GamePorts<G>;
  finish: (result: ReadView<G['programResult']>) => TerminalData<G>;
  playerFor: (actor: ReadView<G['actor']>) => G['player'];
  observe: (view: ReadView<G['view']>, player: G['player']) => G['observation'];
  projectEvent: (event: ReadView<G['event']>, player: G['player']) => { event: G['playerEvent'] } | null;
  inputs: GameInputDefinitions<G>;
  queries: { [K in keyof Q]: GameQueryDefinition<G, Q[K]> } & FixedTable<Q>;
};
/** Author package joins one program with the shared inner/outer contract. */
export type GameModule<G extends GameTypes, Q extends { [K in keyof Q]: QueryShape }> = {
  program: ProgramModule<G['setup'], G['ports'], G['programResult']>;
  contract: GameContract<G, Q>;
};
/** Inner library signature: typed functions over the exact declared IO ports. */
export type GameSDK<P extends { [K in keyof P]: PortShape }> = FixedTable<P> & {
  [K in keyof P]: (input: P[K]['input']) => Promise<P[K]['output']>;
};
