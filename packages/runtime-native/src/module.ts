import vm from 'node:vm';
import { copy } from '@bear-forge/boundary';
import type { ProgramModule, PortShape } from '@bear-forge/contracts/core';
export class NativeBudgetError extends Error {}
export class NativeHostError extends Error {}
const hostChecks=new WeakMap<object,()=>boolean>();
export function nativeHostViolation(program:object){return hostChecks.get(program)?.()??false;}
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
  if (artifact.format !== 1 || artifact.abi !== 'native-module-1' || typeof artifact.code !== 'string' || artifact.code.length > 32 * 1024 * 1024) throw Error('Invalid native artifact');
  const script = new vm.Script(artifact.code);
  function instantiate() {
    const realm = vm.createContext({}, {
      codeGeneration: {
        strings: false,
        wasm: false
      }
    });
    realm.__remaining = options.stepBudget ?? 100000000;
    vm.runInContext('module={exports:{}};exports=module.exports;__bearBudgetExceeded=false;function unavailable(){__bearHostViolation=true;throw Error("Undeclared host effect");}__bearHostViolation=false;Math.random=unavailable;Date.now=unavailable;setTimeout=clearTimeout=setInterval=clearInterval=setImmediate=clearImmediate=queueMicrotask=unavailable;Object.defineProperty(globalThis,"__tick",{value:function(){if(--__remaining<0){__bearBudgetExceeded=true;throw Error("budget exceeded");}},writable:false,configurable:false});', realm);
    script.runInContext(realm, {
      timeout: 10000
    });
    if(realm.__bearHostViolation)throw new NativeHostError('Undeclared host effect');
    const program = realm.module.exports[artifact.exportName];
    if (!program?.schemas || typeof program.run !== 'function') throw Error('Missing native ProgramModule');
    return {
      program,
      realm
    };
  }
  function create(): ProgramModule<S, P, R> {
    const {
      program,
      realm
    } = instantiate();
    const wrap = (schema: any) => new Proxy(schema, {
      get(target, key) {
        if (key !== 'parse') return Reflect.get(target, key);
        return (value: unknown) => {
          realm.__validationSchema = target;
          realm.__validationValue = copy(value);
          try {
            const result = vm.runInContext('__validationSchema.parse(__validationValue)', realm, {
              timeout: 1000
            });
            if (realm.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
            if(realm.__bearHostViolation)throw new NativeHostError('Undeclared host effect');
            return result;
          } catch (error) {
            if ((error as any)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
              realm.__bearBudgetExceeded = true;
              throw new NativeBudgetError('Native budget exceeded');
            }
            throw error;
          } finally {
            delete realm.__validationSchema;
            delete realm.__validationValue;
          }
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
          if (realm.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
            if(realm.__bearHostViolation)throw new NativeHostError('Undeclared host effect');
          throw error;
        }
        if (realm.__bearBudgetExceeded) throw new NativeBudgetError('Native budget exceeded');
            if(realm.__bearHostViolation)throw new NativeHostError('Undeclared host effect');
        return copy(result);
      }
    };
    hostChecks.set(active,()=>Boolean(realm.__bearHostViolation));
    budgetChecks.set(active, () => Boolean(realm.__bearBudgetExceeded));
    return active;
  }
  const initial = create();
  factories.set(initial, create);
  return initial;
}
