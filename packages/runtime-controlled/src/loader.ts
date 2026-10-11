import { randomUUID } from 'node:crypto';
import { copy, read } from '@bear-forge/boundary';
import { Controller, ok, fail, createCapture } from '@bear-forge/runtime';
import type { Execution, RawStop } from '@bear-forge/runtime';
import type { CompiledProgram, ControlledCoreLoader, LoadedCore } from '@bear-forge/contracts/loading';
import type { Instance, InstanceStop, Outcome } from '@bear-forge/contracts/instance';
import type { ProgramSchemas, PortShape } from '@bear-forge/contracts/core';
import { deserialize, serialize } from 'node:v8';
import { InstanceSnapshotSchema } from '@bear-forge/contracts/persistence';
import { ProgramExecution, decode, digest } from './execution.ts';
import { memorySnapshotStore } from './store.ts';
import type { SnapshotStore } from './store.ts';
export { fileSnapshotStore, memorySnapshotStore } from './store.ts';
export type { SnapshotStore } from './store.ts';
export { digest as programDigest } from './execution.ts';
export function createControlledLoader(options: {
  trustedDigests: ReadonlySet<string>;
  snapshots?: SnapshotStore;
  stepBudget?: number;
}): ControlledCoreLoader {
  if (options.stepBudget !== undefined && (!Number.isSafeInteger(options.stepBudget) || options.stepBudget < 1)) throw Error('Invalid step budget');
  const store = options.snapshots ?? memorySnapshotStore();
  return {
    async load<S, P extends { [K in keyof P]: PortShape }, R>(program: CompiledProgram<S, P, R>): Promise<Outcome<LoadedCore<S, P, R>>> {
      let artifact: ReturnType<typeof decode>, hash: string;
      try {
        hash = digest(program.content);
        if (!options.trustedDigests.has(hash)) return fail('invalid_argument', 'Artifact is not trusted');
        artifact = decode(program.content);
      } catch (e) {
        return fail('invalid_argument', String(e));
      }
      const controllers = new Map<string, Controller<S, P, R>>(),
        handles = new WeakMap<object, Controller<S, P, R>>();
      function remember(handle: Instance<P, R>, controller: Controller<S, P, R>) {
        handles.set(handle, controller);
        const transfer = handle.transfer;
        handle.transfer = async () => {
          const result = await transfer();
          if (result.ok) remember(result.value, controller);
          return result;
        };
        return handle;
      }
      function instantiate(setup: S, data?: {
        engine: string;
        state: InstanceStop<P, R>;
        records: any[];
      }): Instance<P, R> {
        const execution = new ProgramExecution(artifact, options.stepBudget);
        let schemas = execution.boundarySchemas() as ProgramSchemas<S, P, R>;
        const checkedSetup = data ? setup : read(schemas.setup, setup);
        let initialFault: RawStop | undefined;
        try {
          if (data) {
            execution.restore(data.engine);
            schemas = execution.boundarySchemas();
          } else execution.start(checkedSetup);
        } catch (e) {
          if (data) throw e;
          initialFault = {
            kind: 'fault',
            error: {
              kind: 'fault',
              code: String(e).includes('budget') ? 'budget_exceeded' : 'program_failed',
              message: String(e)
            }
          };
        }
        const engine: Execution = {
          current() {
            if (initialFault) return initialFault;
            if (execution.fault) return {
              kind: 'fault',
              error: {
                kind: 'fault',
                code: 'budget_exceeded',
                message: 'Budget exhausted'
              }
            };
            if (execution.hostViolation) return {
              kind: 'fault',
              error: {
                kind: 'fault',
                code: 'program_failed',
                message: 'Undeclared host effect'
              }
            };
            if (execution.io?.fault || execution.result?.status === 1 && execution.io?.pending) return {
              kind: 'fault',
              error: {
                kind: 'fault',
                code: 'program_failed',
                message: execution.io?.fault ?? 'Returned with pending IO'
              }
            };
            if (execution.result?.status === 2) return {
              kind: 'fault',
              error: {
                kind: 'fault',
                code: 'program_failed',
                message: String(execution.result.value)
              }
            };
            if (execution.result?.status === 1) return {
              kind: 'done',
              result: execution.result.value
            };
            if (execution.io?.pending) return {
              kind: 'call',
              call: execution.io.callData
            };
            return {
              kind: 'fault',
              error: {
                kind: 'fault',
                code: 'program_failed',
                message: 'Execution escaped controlled scheduler'
              }
            };
          },
          async advance(output) {
            execution.resume(output);
          },
          dispose() {
            execution.io = undefined;
          },
          snapshot: () => execution.snapshot()
        };
        const controller = new Controller(engine, schemas, checkedSetup, data);
        controller.forkHandler = async () => {
          try {
            return ok(instantiate(setup, {
              engine: engine.snapshot!(),
              state: controller.state,
              records: controller.records
            }));
          } catch (e) {
            return fail('program_failed', String(e));
          }
        };
        controllers.set(controller.id, controller);
        return remember(controller.handle(), controller);
      }
      try {
        const r = new ProgramExecution(artifact, options.stepBudget);
        r.admitSchemas();
      } catch (e) {
        return fail('invalid_argument', String(e));
      }
      return ok({
        core: {
          async start(setup) {
            try {
              return ok(instantiate(setup));
            } catch (e) {
              return fail('invalid_input', String(e));
            }
          }
        },
        persistence: {
          async save(instance) {
            const c = handles.get(instance);
            if (!c) return fail('invalid_argument');
            const status = await instance.inspect();
            if (!status.ok) return status;
            if (c.state.kind === 'fault') return {
              ok: false,
              error: copy(c.state.error)
            };
            try {
              const id = randomUUID();
              const content = {
                format: 4,
                hash,
                engine: c.engine.snapshot!(),
                state: c.state,
                records: c.records
              };
              await store.put(id, serialize(content));
              return ok(InstanceSnapshotSchema.parse({
                snapshotId: id
              }));
            } catch (e) {
              return fail('program_failed', String(e));
            }
          },
          async restore(snapshot) {
            try {
              const ref = InstanceSnapshotSchema.parse(snapshot),
                bytes = await store.get(ref.snapshotId);
              if (!bytes) return fail('snapshot_not_found');
              const data = deserialize(bytes);
              if (data.format !== 4 || data.hash !== hash) return fail('snapshot_incompatible');
              return ok(instantiate(undefined as S, data));
            } catch (e) {
              return fail('snapshot_incompatible', (e as any)?.stack ?? String(e));
            }
          },
          async release(snapshot) {
            try {
              const ref = InstanceSnapshotSchema.parse(snapshot);
              if (!(await store.known(ref.snapshotId))) return fail('snapshot_not_found');
              if (!(await store.get(ref.snapshotId))) return ok(undefined);
              await store.remove(ref.snapshotId);
              return ok(undefined);
            } catch {
              return fail('invalid_argument');
            }
          }
        },
        capture: createCapture<S, P, R>(controllers)
      });
    }
  };
}
