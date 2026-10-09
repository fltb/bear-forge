import type {z} from 'zod';
import type {RecordReadSchema} from './schemas.ts';
import type {PortShape,PortCall,PortReturn} from '../core/types.ts';
import type {InstanceId,CallId,Outcome,InstanceFault} from '../instance/types.ts';
export type RecordRead = z.infer<typeof RecordReadSchema>;
export type InstanceRecord<S, P extends { [K in keyof P]: PortShape }, R> =
  | { sequence: number; kind: 'started'; setup: S }
  | { sequence: number; kind: 'called'; callId: CallId; call: PortCall<P> }
  | { sequence: number; kind: 'returned'; callId: CallId; reply: PortReturn<P> }
  | { sequence: number; kind: 'completed'; result: R }
  | { sequence: number; kind: 'faulted'; error: InstanceFault };
export type InstanceCapture<S, P extends { [K in keyof P]: PortShape }, R> = {
  read: (instanceId: InstanceId, input: RecordRead) => Promise<Outcome<{
    records: InstanceRecord<S, P, R>[];
    next: number | null;
  }>>;
  release: (instanceId: InstanceId) => Promise<Outcome<void>>;
};
