import type { z } from 'zod';
import type { PortShape, PortCall } from '../core/program.types.ts';
import type { EmptyTableGuard, FixedTable } from '../internal/type-utils.ts';
import type { InstanceIdSchema, CallIdSchema, InstanceErrorSchema, PauseReasonSchema, CallbackPauseSchema } from './instance.schemas.ts';
export type InstanceId = z.infer<typeof InstanceIdSchema>;
export type CallId = z.infer<typeof CallIdSchema>;
export type InstanceError = z.infer<typeof InstanceErrorSchema>;
export type InstanceFault = Extract<InstanceError, { kind: 'fault' }>;
export type Outcome<T, E = InstanceError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
export type PauseReason = z.infer<typeof PauseReasonSchema>;
export type CallbackPause = z.infer<typeof CallbackPauseSchema>;
export type CallbackReply<T> = {kind:'reply';value:T} | CallbackPause;
export type CallbackControl = {signal:AbortSignal};
export type PortBindings<P extends { [K in keyof P]: PortShape }> = FixedTable<P> & EmptyTableGuard<P> & {
  [K in keyof P]?: (request:{instanceId:InstanceId;callId:CallId;input:P[K]['input']}, control:CallbackControl) => Promise<CallbackReply<P[K]['output']>>;
};
export type InstanceStop<P extends { [K in keyof P]: PortShape }, R> =
  | { kind: 'call'; callId: CallId; call: PortCall<P> }
  | { kind: 'done'; result: R }
  | { kind: 'fault'; error: InstanceFault };
export type InstanceRunStop<P extends {[K in keyof P]:PortShape},R> = {accepted:boolean;state:InstanceStop<P,R>;pause:PauseReason|null};
export type Instance<P extends { [K in keyof P]: PortShape }, R> = {
  /** Fresh for start/fork/restore; transfer alone preserves identity. Never reused. */
  readonly id: InstanceId;
  transfer: () => Promise<Outcome<Instance<P, R>>>;
  bind: (bindings: PortBindings<P> | null) => Promise<Outcome<void>>;
  run: (options?: {signal?:AbortSignal}) => Promise<Outcome<InstanceRunStop<P, R>>>;
  inspect: () => Promise<Outcome<InstanceStop<P, R>>>;
  /** Independent state and identity, same available capabilities, empty host bindings. */
  fork?: () => Promise<Outcome<Instance<P, R>>>;
  close: () => Promise<Outcome<void>>;
};
