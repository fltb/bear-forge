import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {admitSource, AuthorAdmissionError} from '../src/admission.ts';
import {bundleProgram} from '../src/bundle.ts';
import {compileJavaScript} from '../src/compile.ts';

test('author source is parsed as a strict ES module', () => {
  assert.throws(() => admitSource('with ({}) {}', 'program.js'), SyntaxError);
  assert.throws(() => admitSource('function f(a,a) {}', 'program.js'), SyntaxError);
  assert.throws(() => admitSource('module.exports = 1', 'program.js'), AuthorAdmissionError);
  assert.throws(() => admitSource('exports.value = 1', 'program.js'), AuthorAdmissionError);
  assert.throws(() => admitSource('export const program = new Function("return 1")', 'program.js'), AuthorAdmissionError);
  assert.throws(() => admitSource('export const program = Function("return 1")', 'program.js'), AuthorAdmissionError);
  assert.doesNotThrow(() => admitSource('function require(){return 1} export const program=require()', 'program.js'));
  assert.doesNotThrow(() => admitSource('function Function(){return 1} export const program=new Function()', 'program.js'));
  assert.equal(admitSource('export function f(){ return this; }', 'program.js').hasTopLevelAwait, false);
  assert.equal(compileJavaScript('export const program=()=>undefined;').kind, 'controlled-program');
  for (const source of [
    "import {value} from './dependency.js'; export const program=()=>value;",
    "export {value} from './dependency.js';",
    "export * from './dependency.js';",
  ]) {
    assert.throws(() => admitSource(source, 'program.js', 'standalone'), /Use compileEntry for module dependencies/);
    assert.throws(() => compileJavaScript(source), /Use compileEntry for module dependencies/);
  }
});

test('every dependency is an admitted ESM source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-esm-boundary-'));
  try {
    await writeFile(join(root, 'entry.mjs'), "import {value} from './dependency.cjs'; export const program=()=>value;");
    await writeFile(join(root, 'dependency.cjs'), 'exports.value=1;');
    await assert.rejects(bundleProgram(join(root, 'entry.mjs')), /ESM source format required/);
    await writeFile(join(root, 'entry.mjs'), "import {value} from './dependency.js'; export const program=()=>value;");
    await writeFile(join(root, 'dependency.js'), 'module.exports={value:1};');
    await assert.rejects(bundleProgram(join(root, 'entry.mjs')), /Undeclared capability module/);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
});

test('package resolution cannot admit a CommonJS dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-esm-package-'));
  try {
    const packageRoot = join(root, 'node_modules', 'legacy-dependency');
    await mkdir(packageRoot, {recursive:true});
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({name:'legacy-dependency',main:'index.cjs'}));
    await writeFile(join(packageRoot, 'index.cjs'), 'module.exports={value:1};');
    await writeFile(join(root, 'entry.mjs'), "import {value} from 'legacy-dependency'; export const program=()=>value;");
    await assert.rejects(bundleProgram(join(root, 'entry.mjs')), /ESM source format required/);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
});
