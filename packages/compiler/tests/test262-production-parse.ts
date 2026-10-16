import { compileJavaScript } from '../src/compile.ts';
import { AuthorAdmissionError, isAuthorParseError } from '../src/admission.ts';
import type { Test262Case } from './test262-cases.ts';

export type ProductionParseResult = {
  file: string;
  mode: Test262Case['mode'];
  backend: 'production-module-parse';
  status: 'passed' | 'failed' | 'not-executed';
  outcome: 'parse-error' | 'parse-accepted' | 'admission-rejected' | 'compiler-error' | 'runner-missing';
  detail: string;
};
/** Phase-only checks, not an evaluation backend. Production currently parses
 * module code. Never reinterpret a script as a module to obtain a parse result.
 * No harness or test body executes: the required outcome is an early error. */
export function runTest262ProductionParse(test: Test262Case): ProductionParseResult {
  const base = {file:test.file, mode:test.mode, backend:'production-module-parse' as const};
  if (test.mode !== 'module' || test.negative?.phase !== 'parse') return {
    ...base, status:'not-executed', outcome:'runner-missing', detail:'This adapter checks module parse-negative cases only'
  };
  try {
    compileJavaScript(test.source);
    return {...base, status:'failed', outcome:'parse-accepted', detail:'Production compiler accepted a source requiring an early error'};
  } catch (error) {
    if (error instanceof AuthorAdmissionError) return {
      ...base, status:'not-executed', outcome:'admission-rejected', detail:error.message
    };
    if (isAuthorParseError(error)) return {
      ...base, status:error.constructor.name === test.negative.type ? 'passed' : 'failed',
      outcome:'parse-error', detail:error.constructor.name
    };
    return {...base, status:'not-executed', outcome:'compiler-error', detail:String(error)};
  }
}
