import type {z} from 'zod';
import type {InstanceSnapshotSchema} from './persistence.schemas.ts';
import type {PortShape} from '../core/program.types.ts';
import type {Instance,Outcome} from './instance.types.ts';
export type InstanceSnapshot = z.infer<typeof InstanceSnapshotSchema>;
export type InstancePersistence<P extends { [K in keyof P]: PortShape }, R> = {
  save: (instance: Instance<P, R>) => Promise<Outcome<InstanceSnapshot>>;
  /** New InstanceId, saved CallId/prefix preserved, no host bindings copied. */
  restore: (snapshot: InstanceSnapshot) => Promise<Outcome<Instance<P, R>>>;
  release: (snapshot: InstanceSnapshot) => Promise<Outcome<void>>;
};
