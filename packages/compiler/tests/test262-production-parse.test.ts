import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runTest262ProductionParse} from './test262-production-parse.ts';
import type {Test262Case} from './test262-cases.ts';
import {admitSource,AuthorAdmissionError} from '../src/admission.ts';
const input = (source:string, changes:Partial<Test262Case> = {}):Test262Case => ({
  file:'test/synthetic.js', mode:'module', source, harness:[], flags:['module'], features:[], asynchronous:false,
  negative:{phase:'parse',type:'SyntaxError'}, ...changes
});

test('production parse checks require real parser errors and never execute source', () => {
  const valid = 'export const program={schemas:{},async run(){throw new Error("must not execute");}};';
  assert.equal(runTest262ProductionParse(input(valid)).outcome, 'parse-accepted');
  assert.equal(runTest262ProductionParse(input(valid)).status, 'failed');
  const bad = 'export const value = ;';
  assert.equal(runTest262ProductionParse(input(bad)).status, 'passed');
  assert.equal(runTest262ProductionParse(input(bad)).backend, 'production-module-parse');
  assert.equal(runTest262ProductionParse(input(bad, {negative:{phase:'parse',type:'TypeError'}})).status, 'failed');
  const rejected = runTest262ProductionParse(input('fetch("x");'));
  assert.equal(rejected.outcome, 'admission-rejected');
  assert.equal(rejected.status, 'not-executed');
});

test('production parse adapter does not silently change source goals or claim runtime coverage', () => {
  for (const mode of ['raw','strict','non-strict'] as const) {
    const result = runTest262ProductionParse(input('const = ;', {mode}));
    assert.equal(result.outcome, 'runner-missing');
    assert.equal(result.status, 'not-executed');
  }
  for (const negative of [null, {phase:'runtime',type:'SyntaxError'}, {phase:'resolution',type:'SyntaxError'}] as const) {
    assert.equal(runTest262ProductionParse(input('const = ;', {negative})).status, 'not-executed');
  }
});

test('missing parser support cannot satisfy an expected ECMAScript early error', () => {
  for (const source of [
    'const value = do { 1; };',
    'const value = do { 1; }; const = ;'
  ]) {
    const result = runTest262ProductionParse(input(source));
    assert.equal(result.outcome, 'admission-rejected');
    assert.equal(result.status, 'not-executed');
  }
});

test('module phase grammar is parsed without granting module phase execution', () => {
  for (const source of [
    'import defer * as ns from "./dependency.js";',
    'import source ns from "./dependency.js";',
    'import.defer("./dependency.js");',
    'import.source("./dependency.js");'
  ]) {
    const result=runTest262ProductionParse(input(source));
    assert.equal(result.outcome,'admission-rejected');
    assert.equal(result.status,'not-executed');
    for (const filename of ['entry.js','entry.ts'])
      assert.throws(() => admitSource(source,filename), AuthorAdmissionError);
  }
  for (const phase of ['defer','source']) {
    for (const source of [`import.${phase}() = 1;`, `(import.${phase}()) = 1;`,
      `import.${phase}("./dependency.js") = 1;`]) {
      assert.equal(runTest262ProductionParse(input(source)).status,'passed');
    }
  }
});
