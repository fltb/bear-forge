import { Worker } from 'node:worker_threads';
import type { Test262Case } from './test262-cases.ts';
import { test262Result, type Test262Execution, type Test262Result } from './test262-outcome.ts';

/** Isolated original-V8 oracle, never a production-compiler conformance result.
 * The parent enforces a wall-time limit even for infinite promise microtasks. */
export async function runTest262Reference(test: Test262Case, timeoutMs = 5000, root?: string): Promise<Test262Result> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('Invalid Test262 timeout');
  const execution = await new Promise<Test262Execution>(resolve => {
    const worker = new Worker(new URL('./test262-reference-worker.ts', import.meta.url), {
      workerData: {test, root}, stderr: true, execArgv: ['--experimental-strip-types', '--experimental-vm-modules']
    });
    // Keep expected VM experimental warnings out of per-case output, while
    // preserving diagnostics if the worker itself fails.
    let diagnostic = '';
    worker.stderr?.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-4096); });
    let settled = false;
    const finish = (result: Test262Execution) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(() => resolve(result), error => resolve({ kind: 'runner-error', message: String(error) }));
    };
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    worker.once('message', (result: Test262Execution) => finish(result));
    worker.once('error', error => finish({ kind: 'runner-error', message: String(error) + diagnostic }));
    worker.once('exit', code => { if (!settled) finish({ kind: 'runner-error', message: `Reference worker exited without an outcome (${code}): ${diagnostic}` }); });
  });
  return test262Result(test, 'native-reference', execution);
}
