import { randomUUID } from 'node:crypto';
const startupFailures = new WeakMap<object, 'budget_exceeded' | 'invalid_input' | 'program_failed'>();
class StartupFailure extends Error {
  readonly code: 'budget_exceeded' | 'invalid_input' | 'program_failed';
  constructor(code: 'budget_exceeded' | 'invalid_input' | 'program_failed', cause: unknown) { super(exceptionMessage(cause)); this.code = code; startupFailures.set(this, code); }
}
import { copy, read } from '@bear-forge/boundary';
import { Controller, ok, fail, createCapture, exceptionMessage } from '@bear-forge/runtime';
import type { Execution, RawStop } from '@bear-forge/runtime';
import type { CompiledProgram, ControlledCoreLoader, LoadedCore } from '@bear-forge/contracts/loading';
import type { Instance, InstanceStop, Outcome } from '@bear-forge/contracts/instance';
import type { PortShape } from '@bear-forge/contracts/core';
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
        return fail('invalid_argument', exceptionMessage(e));
      }
      let registered: ProgramExecution;
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
        records: NonNullable<Controller<S, P, R>['records']> | any[];
      }, branched?: ProgramExecution): Instance<P, R> {
        const execution = branched ?? registered.fresh(options.stepBudget);
        if (data && !branched) execution.restore(data.engine);
        const startupFailure = (code: 'invalid_input' | 'program_failed', cause: unknown): never => {
          const failure = new StartupFailure(execution.fault ? 'budget_exceeded'
            : execution.hostViolation ? 'program_failed' : code, execution.message(cause));
          execution.dispose();
          throw failure;
        };
        let schemas: Controller<S, P, R>['schemas'];
        try {
          if (!data) execution.admitSchemas();
          schemas = execution.boundarySchemas() as Controller<S, P, R>['schemas'];
        } catch (error) { startupFailure('program_failed', error); }
        let checkedSetup: S;
        try { checkedSetup = data ? setup : read(schemas!.setup, setup); }
        catch (error) { startupFailure('invalid_input', error); }
        let initialFault: RawStop | undefined;
        try {
          if (!data) execution.start(checkedSetup!);
        } catch (e) {
          if (data) throw e;
          initialFault = {
            kind: 'fault',
            error: {
              kind: 'fault',
              code: execution.fault ? 'budget_exceeded' : 'program_failed',
              message: execution.message(e)
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
                message: execution.message(execution.result.value)
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
          discardOutput() {
            execution.discardOutput();
          },
          dispose() {
            execution.dispose();
          },
          snapshot: () => execution.snapshot()
        };
        const controller = new Controller(engine, schemas!, checkedSetup!, data);
        controller.forkHandler = async () => {
          try {
            return ok(instantiate(setup, {
              engine: '',
              state: controller.state,
              records: controller.records!
            }, execution.fork()));
          } catch (e) {
            return fail('program_failed', exceptionMessage(e));
          }
        };
        controllers.set(controller.id, controller);
        return remember(controller.handle(), controller);
      }
      try {
        registered = new ProgramExecution(artifact, options.stepBudget);
        // Frozen loading semantics require schema admission before returning a
        // provider. This temporary Context is never a restoration source.
        const admission = registered.fresh(options.stepBudget);
        try { admission.admitSchemas(); }
        finally { admission.dispose(); }
      } catch (e) {
        return fail('invalid_argument', exceptionMessage(e));
      }
      return ok({
        core: {
          async start(setup) {
            try {
              return ok(instantiate(setup));
            } catch (e) {
              return fail(startupFailures.get(e as object) ?? 'program_failed', exceptionMessage(e));
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
                records: c.records!.slice()
              };
              await store.put(id, serialize(content));
              return ok(InstanceSnapshotSchema.parse({
                snapshotId: id
              }));
            } catch (e) {
              return fail('program_failed', exceptionMessage(e));
            }
          },
          async restore(snapshot) {
            try {
              const ref = InstanceSnapshotSchema.parse(snapshot),
                bytes = await store.get(ref.snapshotId);
              if (!bytes) return fail('snapshot_not_found');
              const data = deserialize(bytes);
              if (!data || typeof data !== 'object' || data.format !== 4 || data.hash !== hash) return fail('snapshot_incompatible');
              return ok(instantiate(undefined as S, data));
            } catch (e) {
              return fail('snapshot_incompatible', exceptionMessage(e));
            }
          },
          async release(snapshot) {
            try {
              const ref = InstanceSnapshotSchema.parse(snapshot);
              if (!(await store.known(ref.snapshotId))) return fail('snapshot_not_found');
              const bytes = await store.get(ref.snapshotId);
              if (!bytes) return ok(undefined);
              let data: any;
              try { data = deserialize(bytes); }
              catch { return fail('snapshot_incompatible'); }
              if (!data || typeof data !== 'object' || data.format !== 4 || data.hash !== hash) return fail('snapshot_incompatible');
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
