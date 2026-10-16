import {Worker} from 'node:worker_threads';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join, relative, resolve} from 'node:path';
import type {Test262Case} from '../../compiler/tests/test262-cases.ts';
import {test262Result, type Test262Execution, type Test262Result} from '../../compiler/tests/test262-outcome.ts';

/** Execute the original module through the production compiler/ProgramExecution
 * stage. The importer introduces no bindings into the tested module. This is a
 * language test, not a loader/schema-validation conformance test. Each worker
 * owns a fresh Program Realm. Script harness assertions run there with Context-aware property operations
 * before module initialization; they are never author inputs. */
export async function runTest262Module(test: Test262Case, root: string, timeoutMs = 30000): Promise<Test262Result> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('Invalid Test262 timeout');
  const result = (execution: Test262Execution) => test262Result(test, 'production-controlled', execution);
  if (test.mode !== 'module' || test.negative !== null && test.negative.phase !== 'runtime') return result({
    kind:'runner-missing', reason:'Script mode and parse/resolution negatives require separate adapters'
  });
  const file = resolve(root, test.file), suffix = relative(resolve(root, 'test'), file);
  if (!suffix || suffix === '..' || suffix.startsWith('../') || isAbsolute(suffix)) throw Error('Test262 module escapes test directory');
  if (await readFile(file, 'utf8') !== test.source) throw Error('Test262 module source differs from the selected original');
  const directory = await mkdtemp(join(tmpdir(), 'bear-test262-module-'));
  try {
    const entry = join(directory, 'entry.mts');
    // Side-effect import preserves the original file and its relative imports.
    // The entry is an execution fixture; schemas are not validated by this
    // low-level language test. Full loader tests own the Zod/schema boundary.
    await writeFile(entry, `import ${JSON.stringify(file)};
export const program = {
  schemas: {setup: {parse: (value: unknown) => value}, result: {parse: (value: unknown) => value}, ports: {}},
  async run() { return null; }
};
`);
    return result(await new Promise<Test262Execution>(resolveResult => {
      const worker = new Worker(new URL('./test262-module-worker.ts', import.meta.url), {
        workerData:{entry,harness:test.harness,asynchronous:test.asynchronous}, stderr:true, execArgv:['--experimental-strip-types']
      });
      let diagnostic = '', settled = false;
      worker.stderr.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-4096); });
      const finish = (execution: Test262Execution) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate().then(() => resolveResult(execution), error => resolveResult({kind:'runner-error',message:String(error)}));
      };
      const timer = setTimeout(() => finish({kind:'timeout'}), timeoutMs);
      worker.once('message', finish);
      worker.once('error', error => finish({kind:'runner-error',message:String(error)+diagnostic}));
      worker.once('exit', code => { if (!settled) finish({kind:'runner-error',message:`Module worker exited without an outcome (${code}): ${diagnostic}`}); });
    }));
  } finally {
    await rm(directory, {recursive:true, force:true});
  }
}
