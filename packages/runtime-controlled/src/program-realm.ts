import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, constants, Script } from 'node:vm';

const require = createRequire(import.meta.url);
let runtimeScript: Script | undefined;
let effectsScript: Script | undefined;

/** One V8 Realm per loaded Program. Neither fork nor restore constructs one. */
export function createProgramRealm(code: string) {
  runtimeScript ??= new Script(`(function(require,module,exports){${readFileSync(new URL('../dist/realm-runtime.cjs', import.meta.url), 'utf8')}\n})`, { filename: 'bear-realm-runtime.cjs' });
  effectsScript ??= new Script(`(function(require,module,exports){${readFileSync(new URL('../dist/effects.cjs', import.meta.url), 'utf8')}\n})`, { filename: 'bear-realm-effects.cjs' });
  const realm = createContext(constants.DONT_CONTEXTIFY);
  const allocators = new Script('({ record: () => ({}), array: length => new Array(length) })').runInContext(realm);
  const runtimeModule = { exports: {} as any };
  const runtimeFactory = runtimeScript.runInContext(realm);
  runtimeFactory(require, runtimeModule, runtimeModule.exports);
  const effectsModule = { exports: undefined as any };
  const effectsLoader = effectsScript.runInContext(realm);
  effectsLoader(require, effectsModule, {});
  const programModule = { exports: undefined as any };
  const programFactory = new Script(`(function(module,exports){${code}\n})`, { filename: 'bear-program.cjs' }).runInContext(realm);
  programFactory(programModule, {});
  if (typeof programModule.exports !== 'function') throw Error('Artifact must export an instance factory');
  return { realm, allocators: allocators as { record: () => Record<string, unknown>; array: (length: number) => unknown[] }, effectsFactory: effectsModule.exports as () => any, runtime: runtimeModule.exports as {
    programEnvironment: typeof import('../../runtime/src/program-capabilities.ts').programEnvironment;
    createOperations: typeof import('../../runtime/src/operations.ts').createOperations;
    protectIntrinsics: typeof import('../../runtime/src/operations.ts').protectIntrinsics;
  }, factory: programModule.exports as Function };
}
