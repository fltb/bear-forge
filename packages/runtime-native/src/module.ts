import { loadProgramFactory, programCapabilities, assertProgramModuleShape, assertProgramSchemasShape } from '@bear-forge/runtime';
import { copy } from '@bear-forge/boundary';
import type { ProgramModule, PortShape } from '@bear-forge/contracts/core';
const nativeBudgetErrors = new WeakSet<object>();
export class NativeBudgetError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) { super(...args); nativeBudgetErrors.add(this); }
}
export function isNativeBudgetError(value: unknown): value is NativeBudgetError {
  return nativeBudgetErrors.has(value as object);
}
export class NativeHostError extends Error {}
const hostChecks = new WeakMap<object, () => boolean>();
export function nativeHostViolation(program: object) {
  return hostChecks.get(program)?.() ?? false;
}
const budgetChecks = new WeakMap<object, () => boolean>();
export function nativeBudgetExceeded(program: object) {
  return budgetChecks.get(program)?.() ?? false;
}
const factories = new WeakMap<object, () => Promise<ProgramModule<any, any, any>>>();
export function instantiateNative(program: ProgramModule<any, any, any>) {
  return factories.get(program)?.() ?? program;
}
/** Instantiates the approved native bundle afresh for each run, including module variables. */
export async function nativeProgram<S, P extends { [K in keyof P]: PortShape }, R>(artifact: {
  format: number;
  abi: string;
  code: string;
  exportName: string;
  policy: string;
}, options: {
  stepBudget?: number;
} = {}): Promise<ProgramModule<S, P, R>> {
  if (options.stepBudget !== undefined && (!Number.isSafeInteger(options.stepBudget) || options.stepBudget < 1)) throw Error('Invalid step budget');
  if (artifact.format !== 1 || artifact.abi !== 'native-main-2' || artifact.policy !== 'guarded-operations' || typeof artifact.code !== 'string' || artifact.code.length > 32 * 1024 * 1024) throw Error('Invalid native artifact');
  const factory = loadProgramFactory(artifact.code);
  async function instantiate() {
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
    let module;
    try { module = await factory(undefined, capabilities); } catch (error) {
      if (state.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
      if (state.__bearHostViolation) throw new NativeHostError('Undeclared host effect');
      throw error;
    }
    if (state.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
    if (state.__bearHostViolation) throw new NativeHostError('Undeclared host effect');
    const program = module.exports[artifact.exportName];
    assertProgramModuleShape(program);
    assertProgramSchemasShape(program.schemas);
    return {
      program: program as {
        schemas: { setup: any; result: any; ports: Record<string, { input: any; output: any }> };
        run: Function;
      },
      state
    };
  }
  async function create(): Promise<ProgramModule<S, P, R>> {
    const {
      program,
      state
    } = await instantiate();
    const wrap = (schema: any) => new Proxy(schema, {
      get(target, key) {
        if (key !== 'parse') return Reflect.get(target, key);
        return (value: unknown) => {
          const result = target.parse(copy(value));
          if (state.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
          if (state.__bearHostViolation) throw new NativeHostError('Undeclared host effect');
          return copy(result);
        };
      }
    });
    const schemas: any = {
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
  const initial = await create();
  factories.set(initial, create);
  return initial;
}
