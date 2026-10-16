import type { Test262Case } from './test262-cases.ts';
export type Test262Execution =
  | { kind: 'completed' }
  | { kind: 'threw'; phase: 'parse' | 'resolution' | 'runtime'; constructorName: string }
  | { kind: 'async-failure'; message: string }
  | { kind: 'timeout' }
  | { kind: 'runner-missing'; reason: string }
  | { kind: 'admission-rejected'; phase: 'compile' | 'runtime'; reason: string }
  | { kind: 'runner-error'; message: string };
export type Test262Result = {
  backend: 'native-reference' | 'production-controlled';
  file: string;
  mode: Test262Case['mode'];
  status: 'passed' | 'failed' | 'not-executed';
  execution: Test262Execution;
};
/** Execution backends report what happened; expected errors never alter execution. */
export function test262Result(test: Test262Case, backend: Test262Result['backend'], execution: Test262Execution): Test262Result {
  const expected = test.negative;
  const passed = execution.kind === 'completed' ? expected === null : execution.kind === 'threw' && expected !== null
    && execution.phase === expected.phase && execution.constructorName === expected.type;
  return { backend, file: test.file, mode: test.mode,
    status: execution.kind === 'runner-missing' || execution.kind === 'runner-error' || execution.kind === 'admission-rejected' ? 'not-executed' : passed ? 'passed' : 'failed', execution };
}
