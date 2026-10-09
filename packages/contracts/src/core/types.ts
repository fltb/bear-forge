import type { z } from 'zod';
import type {
  InstanceIdSchema, CallIdSchema, InstanceSnapshotSchema,
  InstanceErrorSchema, RecordReadSchema, PauseReasonSchema, InstanceRunLimitsSchema, CallbackPauseSchema,
} from './schemas.ts';

export type InstanceId = z.infer<typeof InstanceIdSchema>;
export type CallId = z.infer<typeof CallIdSchema>;
export type InstanceSnapshot = z.infer<typeof InstanceSnapshotSchema>;
export type InstanceError = z.infer<typeof InstanceErrorSchema>;
export type InstanceFault = Extract<InstanceError, { kind: 'fault' }>;
export type RecordRead = z.infer<typeof RecordReadSchema>;
export type Outcome<T, E = InstanceError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type ReadView<T> = T extends object
  ? { readonly [K in keyof T]: ReadView<T[K]> }
  : T;
type IsUnion<T, Whole = T> = T extends unknown
  ? [Whole] extends [T] ? false : true
  : never;
type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];
export type FixedTable<T> = true extends IsUnion<T> ? never
  : string extends keyof T ? never
  : Exclude<keyof T, string> extends never
    ? [OptionalKeys<T>] extends [never] ? unknown : never
    : never;
export type TableKeys<T> = FixedTable<T> extends never ? never : keyof T & string;

export type PortShape = { input: unknown; output: unknown };
export type PortCall<P extends { [K in keyof P]: PortShape }> = {
  [K in TableKeys<P>]: { port: K; input: P[K]['input'] };
}[TableKeys<P>];
export type PortReturn<P extends { [K in keyof P]: PortShape }> = {
  [K in TableKeys<P>]: { port: K; output: P[K]['output'] };
}[TableKeys<P>];
/** Correlate the entire argument, including when the port key is a union. */
export type IO<P extends { [K in keyof P]: PortShape }> = {
  call: <const A extends PortCall<P>>(call: A) => Promise<P[A['port']]['output']>;
};
export type PauseReason = z.infer<typeof PauseReasonSchema>;
export type CallbackPause = z.infer<typeof CallbackPauseSchema>;
export type CallbackReply<T> = {kind:'reply';value:T} | CallbackPause;
/** Host control only: never serialized into an Instance or sent to its program. */
export type CallbackControl = {signal:AbortSignal};
export type InstanceRunLimits = z.infer<typeof InstanceRunLimitsSchema>;
export type InstanceRunOptions = {limits?:InstanceRunLimits;signal?:AbortSignal};
export type PortBindings<P extends { [K in keyof P]: PortShape }> = FixedTable<P> & {
  [K in keyof P]?: (request:{instanceId:InstanceId;callId:CallId;input:P[K]['input']}, control:CallbackControl) => Promise<CallbackReply<P[K]['output']>>;
};
export type InstanceRunStop<P extends { [K in keyof P]: PortShape }, R> = {acceptedReplies:number} & (
  | {kind:'paused';reason:PauseReason;call:Extract<InstanceStop<P,R>,{kind:'call'}>;message?:string}
  | Extract<InstanceStop<P,R>,{kind:'done'|'fault'}>);
export type Program<S, P extends { [K in keyof P]: PortShape }, R> =
  (setup: S, io: IO<P>) => Promise<R>;
export type ProgramSchemas<S, P extends { [K in keyof P]: PortShape }, R> = FixedTable<P> & {
  setup: z.ZodType<S>;
  result: z.ZodType<R>;
  ports: { [K in keyof P]: { input: z.ZodType<P[K]['input']>; output: z.ZodType<P[K]['output']> } };
};
export type ProgramModule<S, P extends { [K in keyof P]: PortShape }, R> = {
  schemas: ProgramSchemas<S, P, R>;
  run: Program<S, P, R>;
};
export type InstanceStop<P extends { [K in keyof P]: PortShape }, R> =
  | { kind: 'call'; callId: CallId; call: PortCall<P> }
  | { kind: 'done'; result: R }
  | { kind: 'fault'; error: InstanceFault };
/** A handle to one complete execution; no mutable heap or stack is exported. */
export type Instance<P extends { [K in keyof P]: PortShape }, R> = {
  readonly id: InstanceId;
  transfer: () => Promise<Outcome<Instance<P, R>>>;
  bind: (bindings: PortBindings<P> | null) => Promise<Outcome<void>>;
  run: (options?: InstanceRunOptions) => Promise<Outcome<InstanceRunStop<P, R>>>;
  inspect: () => Promise<Outcome<InstanceStop<P, R>>>;
  resume: (input: { callId: CallId; reply: PortReturn<P> }) => Promise<Outcome<InstanceStop<P, R>>>;
  fork?: () => Promise<Outcome<Instance<P, R>>>;
  close: () => Promise<Outcome<void>>;
};
/** Bound to one admitted program; start runs to a stable stop before returning. */
export type Core<S, P extends { [K in keyof P]: PortShape }, R> = {
  start: (setup: S) => Promise<Outcome<Instance<P, R>>>;
};
/** Saves the complete execution including controlled SDK/device locals; no opaque host state. */
export type InstancePersistence<P extends { [K in keyof P]: PortShape }, R> = {
  save: (instance: Instance<P, R>) => Promise<Outcome<InstanceSnapshot>>;
  restore: (snapshot: InstanceSnapshot) => Promise<Outcome<Instance<P, R>>>;
  release: (snapshot: InstanceSnapshot) => Promise<Outcome<void>>;
};
export type InstanceRecord<S, P extends { [K in keyof P]: PortShape }, R> =
  | { sequence: number; kind: 'started'; setup: S }
  | { sequence: number; kind: 'called'; callId: CallId; call: PortCall<P> }
  | { sequence: number; kind: 'returned'; callId: CallId; reply: PortReturn<P> }
  | { sequence: number; kind: 'completed'; result: R }
  | { sequence: number; kind: 'faulted'; error: InstanceFault };
export type InstanceCapture<S, P extends { [K in keyof P]: PortShape }, R> = {
  read: (instance: Instance<P, R>, input: RecordRead) => Promise<Outcome<{
    records: InstanceRecord<S, P, R>[];
    next: number | null;
  }>>;
};
