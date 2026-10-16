import { isNativeBudgetError, instantiateNative, nativeBudgetExceeded, nativeHostViolation } from './module.ts';
import { copy, read, keys, admitSchema, fields } from '@bear-forge/boundary';
import { Controller, ok, fail, createCapture, exceptionMessage, assertProgramModuleShape, assertProgramSchemasShape } from '@bear-forge/runtime';
import type { Execution, RawStop } from '@bear-forge/runtime';
import type { NativeCoreLoader } from '@bear-forge/contracts/loading';
import type { IO, PortShape, ProgramModule } from '@bear-forge/contracts/core';
export function createNativeLoader(): NativeCoreLoader {
  return {
    async load<S, P extends { [K in keyof P]: PortShape }, R>(program: ProgramModule<S, P, R>) {
      try {
        assertProgramModuleShape(program);
        assertProgramSchemasShape(program.schemas);
        admitSchema(program.schemas.setup);
        admitSchema(program.schemas.result);
        for (const declaration of Object.values(program.schemas.ports) as any[]) {
          admitSchema(declaration.input);
          admitSchema(declaration.output);
        }
      } catch (e) {
        return fail('invalid_argument', exceptionMessage(e));
      }
      const controllers = new Map<string, Controller<S, P, R>>();
      return ok({
        capture: createCapture(controllers),
        core: {
          async start(setup: S) {
            let active: ProgramModule<S, P, R>;
            try {
              active = await instantiateNative(program) as ProgramModule<S, P, R>;
            } catch (error) {
              return fail(isNativeBudgetError(error) ? 'budget_exceeded' : 'program_failed', exceptionMessage(error));
            }
            let checked: S;
            try {
              checked = read(active.schemas.setup, setup);
            } catch (e) {
              return fail(nativeBudgetExceeded(active) ? 'budget_exceeded' : 'invalid_input', exceptionMessage(e));
            }
            let state: RawStop | undefined, resolveReply: ((v: unknown) => void) | undefined, rejectReply: ((v: unknown) => void) | undefined;
            let wake!: () => void,
              ready = new Promise<void>(resolve => {
                wake = resolve;
              });
            let stopped = false;
            const fault = (code: 'program_failed' | 'invalid_output' | 'budget_exceeded', cause: unknown) => {
              if (stopped || state?.kind === 'fault') return;
              state = {
                kind: 'fault',
                error: {
                  kind: 'fault',
                  code,
                  message: exceptionMessage(cause)
                }
              };
              wake();
            };
            const io: IO<P> = {
              call: async call => {
                if (stopped || state?.kind === 'fault') throw Error('Stopped');
                if (resolveReply) {
                  fault('program_failed', 'Overlapping IO');
                  throw Error('Overlapping IO');
                }
                try {
                  if (!fields(call, ['port', 'input']) || !Object.hasOwn(active.schemas.ports, call.port)) throw Error('Undeclared port');
                  const input = read((active.schemas.ports as any)[call.port].input, call.input);
                  return (await new Promise((resolve, reject) => {
                    resolveReply = resolve;
                    rejectReply = reject;
                    state = {
                      kind: 'call',
                      call: {
                        port: call.port,
                        input
                      }
                    };
                    wake();
                  })) as P[typeof call.port]['output'];
                } catch (e) {
                  fault('invalid_output', e);
                  throw e;
                }
              }
            };
            Promise.resolve().then(() => active.run(checked, io)).then(result => {
              if (stopped || state?.kind === 'fault') return;
              if (resolveReply) {
                fault('program_failed', 'Returned with pending IO');
                return;
              }
              state = {
                kind: 'done',
                result
              };
              wake();
            }, e => fault(isNativeBudgetError(e) ? 'budget_exceeded' : 'program_failed', e));
            await ready;
            const engine: Execution = {
              current: () => nativeHostViolation(active)&&!nativeBudgetExceeded(active)?{kind:'fault',error:{kind:'fault',code:'program_failed',message:'Undeclared host effect'}}:nativeBudgetExceeded(active) ? {
                kind: 'fault',
                error: {
                  kind: 'fault',
                  code: 'budget_exceeded',
                  message: 'Native budget exceeded'
                }
              } : state!,
              advance: async output => {
                ready = new Promise(resolve => {
                  wake = resolve;
                });
                const reply = resolveReply!;
                resolveReply = undefined;
                state = undefined;
                reply(copy(output));
                await ready;
              },
              dispose: () => {
                stopped = true;
                rejectReply?.(Error('Closed'));
                resolveReply = undefined;
              }
            };
            const controller = new Controller(engine, active.schemas, checked);
            controllers.set(controller.id, controller);
            return ok(controller.handle());
          }
        }
      });
    }
  };
}
