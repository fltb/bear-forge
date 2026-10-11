import { loadProgramFactory, programCapabilities } from '@bear-forge/runtime';
import { copy } from '@bear-forge/boundary';
import type { ProgramModule, PortShape } from '@bear-forge/contracts/core';
export class NativeBudgetError extends Error {}
export class NativeHostError extends Error {}
const hostChecks = new WeakMap<object, () => boolean>();
export function nativeHostViolation(program: object) {
  return hostChecks.get(program)?.() ?? false;
}
const budgetChecks = new WeakMap<object, () => boolean>();
export function nativeBudgetExceeded(program: object) {
  return budgetChecks.get(program)?.() ?? false;
}
const factories = new WeakMap<object, () => ProgramModule<any, any, any>>();
export function instantiateNative(program: ProgramModule<any, any, any>) {
  return factories.get(program)?.() ?? program;
}
/** Instantiates the approved native bundle afresh for each run, including module variables. */
export function nativeProgram<S, P extends { [K in keyof P]: PortShape }, R>(artifact: {
  format: number;
  abi: string;
  code: string;
  exportName: string;
}, options: {
  stepBudget?: number;
} = {}): ProgramModule<S, P, R> {
  if (options.stepBudget !== undefined && (!Number.isSafeInteger(options.stepBudget) || options.stepBudget < 1)) throw Error('Invalid step budget');
  if (artifact.format !== 1 || artifact.abi !== 'native-main-2' || typeof artifact.code !== 'string' || artifact.code.length > 32 * 1024 * 1024) throw Error('Invalid native artifact');
  const factory = loadProgramFactory(artifact.code);
  function instantiate() {
    const state = {
      __remaining: options.stepBudget ?? 100000000,
      __bearBudgetExceeded: false,
      __bearHostViolation: false
    };
    const capabilities = programCapabilities(() => {
      if (--state.__remaining < 0) {
        state.__bearBudgetExceeded = true;
        throw new NativeBudgetError('Native budget exceeded');
      }
    }, () => {
      state.__bearHostViolation = true;
      throw new NativeHostError('Undeclared host effect');
    });
    const module = factory(undefined, capabilities);
    if (state.__bearHostViolation) throw new NativeHostError('Undeclared host effect');
    const program = module.exports[artifact.exportName];
    if (!program?.schemas || typeof program.run !== 'function') throw Error('Missing native ProgramModule');
    return {
      program,
      state
    };
  }
  function create(): ProgramModule<S, P, R> {
    const {
      program,
      state
    } = instantiate();
    const wrap = (schema: any) => new Proxy(schema, {
      get(target, key) {
        if (key !== 'parse') return Reflect.get(target, key);
        return (value: unknown) => {
          const result = target.parse(copy(value));
          if (state.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
          if (state.__bearHostViolation) throw new NativeHostError('Undeclared host effect');
          return result;
        };
      }
    });
    const schemas: any = {
      ...program.schemas,
      setup: wrap(program.schemas.setup),
      result: wrap(program.schemas.result),
      ports: Object.fromEntries(Object.entries(program.schemas.ports).map(([key, port]: [string, any]) => [key, {
        ...port,
        input: wrap(port.input),
        output: wrap(port.output)
      }]))
    };
    const active: ProgramModule<S, P, R> = {
      schemas,
      async run(setup, io) {
        let result;
        try {
          result = await program.run(copy(setup), {
            async call(input: any) {
              return copy(await io.call(copy(input)));
            }
          });
        } catch (error) {
          if (state.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
          if (state.__bearHostViolation) throw new NativeHostError('Undeclared host effect');
          throw error;
        }
        if (state.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
        if (state.__bearHostViolation) throw new NativeHostError('Undeclared host effect');
        return copy(result);
      }
    };
    hostChecks.set(active, () => Boolean(state.__bearHostViolation));
    budgetChecks.set(active, () => Boolean(state.__bearBudgetExceeded));
    return active;
  }
  const initial = create();
  factories.set(initial, create);
  return initial;
}
