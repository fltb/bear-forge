import type { z } from 'zod';
import type { FixedTable, TableKeys, Outcome, InstanceId, InstanceSnapshot, CallId, CallbackReply, CallbackControl, PauseReason } from '../core/types.ts';
import type { DecisionIdSchema, ChoiceIdSchema, GameErrorSchema, JsonValueSchema, InputValidationSchema, GameRunLimitsSchema, EventDeliveryIdSchema } from './schemas.ts';

export type DecisionId = z.infer<typeof DecisionIdSchema>;
export type ChoiceId = z.infer<typeof ChoiceIdSchema>;
export type GameError = z.infer<typeof GameErrorSchema>;
export type JsonValue = z.infer<typeof JsonValueSchema>;
export type InputValidation = z.infer<typeof InputValidationSchema>;
export type GameOutcome<T> = Outcome<T, GameError>;
export type InputOptions<I extends JsonValue, D extends JsonValue = never> =
  | { kind: 'exact'; values: I[] }
  | ([D] extends [never] ? never : { kind: 'construct'; description: D });
/** One interaction's payload contract. Delivery data and session signals are separate. */
export type InteractionShape = { request: JsonValue; input: JsonValue; description: JsonValue };
export type InteractionTable = Record<string, InteractionShape>;
export type Choice<T extends InteractionTable, A> = {
  [K in TableKeys<T>]: { id: ChoiceId; actor: A; type: K; request: T[K]['request'] };
}[TableKeys<T>];
export type ChoiceInput<T extends InteractionTable> = {
  [K in TableKeys<T>]: { type: K; value: T[K]['input'] };
}[TableKeys<T>];
/** A pending choice is an actual game-declared input endpoint, not a query filter. */
export type GameBoundary<T extends InteractionTable, A, R> =
  | { kind: 'decision'; decisionId: DecisionId; choices: Choice<T, A>[] }
  | { kind: 'event'; callId: CallId }
  | { kind: 'ended'; result: R };
/** Session signals remain domain data; games with none use never. */
export type GameInput<T extends InteractionTable, D, S> =
  | { kind: 'choice'; choiceId: ChoiceId; input: ChoiceInput<T>; delivery: D }
  | ([S] extends [never] ? never : { kind: 'signal'; signal: S });
export type DescribeChoice<T extends InteractionTable> = {
  [K in TableKeys<T>]: { decisionId: DecisionId; choiceId: ChoiceId; type: K };
}[TableKeys<T>];
export type QueryShape = { input: unknown; output: unknown };
export type QueryCall<Q extends { [K in keyof Q]: QueryShape }> = {
  [K in TableKeys<Q>]: { name: K; args: Q[K]['input'] };
}[TableKeys<Q>];
/** An input endpoint and its complete payload options. */
export type DecisionOffer<T extends InteractionTable, A> = {
  [K in TableKeys<T>]: {
    choice:{id:ChoiceId;actor:A;type:K;request:T[K]['request']};
    options:InputOptions<T[K]['input'],T[K]['description']>;
  };
}[TableKeys<T>];
/** A policy selects a payload using one offer and its player observation. */
export type DecisionPolicy<T extends InteractionTable, A, V> = <const C extends DecisionOffer<T,A>>(
  offer:C, observation:V, control:CallbackControl
) => Promise<CallbackReply<T[C['choice']['type']]['input']>>;
export type GameRequest<T extends InteractionTable, A, V> = {
  decisionId:DecisionId;
  observation:V;
  offers:DecisionOffer<T,A>[];
  acceptsSignal:boolean;
};
export type EventDeliveryId = z.infer<typeof EventDeliveryIdSchema>;
export type EventDelivery<E> = {id:EventDeliveryId;event:E};
/** Callbacks registered for one game-defined player key. */
export type GameBindings<T extends InteractionTable, A, D, S, Player extends string, V, E> = {
  player:Player;
  onDecision?: (request:GameRequest<T,A,V>, control:CallbackControl & {player:Player}) => Promise<CallbackReply<GameInput<T,D,S>>>;
  onEvent?: (delivery:EventDelivery<E>, control:CallbackControl & {player:Player}) => Promise<CallbackReply<null>>;
};
export type GameRunLimits = z.infer<typeof GameRunLimitsSchema>;
export type GameRunOptions = {limits?:GameRunLimits;signal?:AbortSignal};
export type GameRunStop<T extends InteractionTable, A, R> = {acceptedInputs:number} & (
  | {kind:'paused';reason:PauseReason;boundary:Exclude<GameBoundary<T,A,R>,{kind:'ended'}>;message?:string}
  | {kind:'ended';result:R}
  | {kind:'fault';error:Extract<GameError,{kind:'fault'}>});
/** Exclusive outer facade of one Instance; no separate mutable game/service state. */
export type BaseGame<T extends InteractionTable, A, D, S, Player extends string, V, E, R, Q extends { [K in keyof Q]: QueryShape }> = FixedTable<T> & FixedTable<Q> & {
  readonly id: InstanceId;
  bind: (bindings: GameBindings<T,A,D,S,Player,V,E> | null) => Promise<GameOutcome<void>>;
  run: (options?: GameRunOptions) => Promise<GameOutcome<GameRunStop<T,A,R>>>;
  inspect: () => Promise<GameOutcome<GameBoundary<T, A, R>>>;
  observe: (input: { player: Player }) => Promise<GameOutcome<V>>;
  describe: <const C extends DescribeChoice<T>>(input: C) => Promise<GameOutcome<InputOptions<T[C['type']]['input'], T[C['type']]['description']>>>;
  validate: (input: { player: Player; decisionId: DecisionId; input: GameInput<T, D, S> }) => Promise<GameOutcome<InputValidation>>;
  query: <const C extends QueryCall<Q>>(call: C) => Promise<GameOutcome<Q[C['name']]['output']>>;
  fork?: () => Promise<GameOutcome<BaseGame<T, A, D, S, Player, V, E, R, Q>>>;
  save?: () => Promise<GameOutcome<InstanceSnapshot>>;
  close: () => Promise<GameOutcome<void>>;
};
/** Neutral search operations: the caller owns algorithms, actors and value meanings. */
export type StateTransition<S, I, V> = {
  inspect: (state: S) => Promise<V>;
  transition: (input: { state: S; input: I }) => Promise<{ state: S; view: V }>;
};
export type StateResources<S> = { release: (states: S[]) => Promise<void> };
export type StateConstruction<S, C, E, R> = { construct: (input: { source: S; config: C; entropy: E }) => Promise<R> };
export type Evaluation<S, C, V> = { evaluate: (input: { source: S; config: C }) => Promise<V> };
export type Encoding<S, E> = { encode: (source: S) => Promise<E> };
export type FactExtraction<S, C, F> = { extract: (input: { source: S; config: C }) => Promise<F[]> };
export type GameHistory<Setup, Configuration, Input, Update> = {
  setup: Setup;
  configuration: Configuration;
  initial: Update;
  transitions: { input: Input; output: Update }[];
};
