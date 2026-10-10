import type {z} from 'zod';
import type {FixedTable,TableKeys} from '../internal/type-utils.ts';
import type {Outcome,InstanceId,PauseReason,CallbackReply,CallbackControl,CallId} from '../instance/instance.types.ts';
import type {RequestIdSchema,GameErrorSchema,JsonValueSchema,InputValidationSchema,EventDeliveryIdSchema} from './game.schemas.ts';

export type RequestId=z.infer<typeof RequestIdSchema>;
export type GameError=z.infer<typeof GameErrorSchema>;
export type JsonValue=z.infer<typeof JsonValueSchema>;
export type InputOptions<A extends JsonValue,D extends JsonValue=never>=
  | {kind:'exact';values:A[]}
  | ([D] extends [never]?never:{kind:'construct';description:D});
export type InputValidation=z.infer<typeof InputValidationSchema>;
export type ActionTable=Record<string,{request:JsonValue;action:JsonValue;description:JsonValue}>;
/** Each request names its player and one action type. */
export type Request<T extends ActionTable,P extends string,V>={
  [K in TableKeys<T>]:{id:RequestId;player:P;type:K;data:T[K]['request'];observation:V;options:InputOptions<T[K]['action'],T[K]['description']>}
}[TableKeys<T>];
export type ActionReply<T extends ActionTable>={
  [K in TableKeys<T>]:{requestId:RequestId;type:K;action:T[K]['action']}
}[TableKeys<T>];
export type Accepted<T extends ActionTable,P extends string,C=never>=
  | {kind:'action';player:P;reply:ActionReply<T>}
  | ([C] extends [never]?never:{kind:'control';callId:CallId;input:C});
export type GameState<T extends ActionTable,P extends string,V,R>=
  | {kind:'request';requests:Request<T,P,V>[]}
  | {kind:'event';callId:CallId}
  | {kind:'ended';result:R}
  | {kind:'fault';error:Extract<GameError,{kind:'fault'}>};
/** index is the player's visible ordinal within this call, never a raw event index.
 * Deduplicate by (player,id) within one instance identity; restore starts a new identity. */
export type EventDelivery<E>={id:z.infer<typeof EventDeliveryIdSchema>;event:E};
export type GameBindings<T extends ActionTable,P extends string,V,E>={
  player:P;
  onRequest?:<K extends TableKeys<T>>(request:Extract<Request<T,P,V>,{type:K}>,control:CallbackControl)=>Promise<CallbackReply<T[K]['action']>>;
  onEvent?:(delivery:EventDelivery<E>,control:CallbackControl&{player:P})=>Promise<CallbackReply<null>>;
};
/** One rules input per call, followed by event delivery to the next request or end. */
export type BaseGame<T extends ActionTable,P extends string,V,E,R,C=never>=FixedTable<T>&{
  readonly id:InstanceId;
  bind:(bindings:GameBindings<T,P,V,E>|null)=>Promise<Outcome<void,GameError>>;
  run:(options?:{signal?:AbortSignal})=>Promise<Outcome<{
    state:GameState<T,P,V,R>;accepted:Accepted<T,P,C>|null;pause:PauseReason|null;
  },GameError>>;
  inspect:()=>Promise<Outcome<GameState<T,P,V,R>,GameError>>;
  observe:(input:{player:P})=>Promise<Outcome<V,GameError>>;
  describe:<K extends TableKeys<T>>(input:{requestId:RequestId;type:K})=>Promise<Outcome<InputOptions<T[K]['action'],T[K]['description']>,GameError>>;
  validate:(input:{player:P;reply:ActionReply<T>})=>Promise<Outcome<InputValidation,GameError>>;
  close:()=>Promise<Outcome<void,GameError>>;
};
