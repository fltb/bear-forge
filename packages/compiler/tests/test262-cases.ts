import { createRequire } from 'node:module';
import { parseSync } from '@babel/core';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Readable } from 'node:stream';

const TestStream = createRequire(import.meta.url)('test262-stream') as new (
  root: string, options: { paths: string[]; omitRuntime: boolean }
) => Readable;
const execute = promisify(execFile);
export const test262Revision = '2e0a56762801e275a9fdf96dc49d90ba0cddcf63';
export const test262ExcludedFeatures = new Set(['import-defer','dynamic-import','import-text','import-bytes','immutable-arraybuffer']);
/** Some pinned cases omit the dynamic-import feature tag. Classify the syntax
 * itself, rather than granting those cases an author-source exception. */
export function hasUnsupportedDynamicImport(source:string):boolean{
  const ast=parseSync(source,{sourceType:'module',configFile:false,babelrc:false,
    parserOpts:{plugins:['deferredImportEvaluation','sourcePhaseImports']}});
  if(!ast)throw Error('Test262 module parser produced no AST');
  const pending:unknown[]=[ast];
  while(pending.length){
    const value=pending.pop();
    if(!value||typeof value!=='object')continue;
    const node=value as Record<string,unknown>;
    if(node.type==='ImportExpression')return true;
    for(const child of Object.values(node)){
      if(Array.isArray(child))pending.push(...child);
      else if(child&&typeof child==='object'&&'type' in child)pending.push(child);
    }
  }
  return false;
}
/** The target Node loader admits only an empty clause or exact JSON typing.
 * V8's bare module linker alone accepts more attribute records, so those
 * records cannot be counted as executable production-module conformance. */
export function hasUnsupportedImportAttributes(source:string):boolean{
  const ast=parseSync(source,{sourceType:'module',configFile:false,babelrc:false,
    parserOpts:{plugins:['deferredImportEvaluation','sourcePhaseImports']}});
  if(!ast)throw Error('Test262 module parser produced no AST');
  const pending:unknown[]=[ast];
  while(pending.length){
    const value=pending.pop();
    if(!value||typeof value!=='object')continue;
    const node=value as Record<string,unknown>;
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(String(node.type))){
      const attributes=node.attributes;
      if(Array.isArray(attributes)&&attributes.length&&
        (attributes.length!==1||!attributes.every(attribute=>{
          const item=attribute as {key?:{name?:string;value?:string};value?:{value?:string}};
          return (item.key?.name??item.key?.value)==='type'&&item.value?.value==='json';
        })))return true;
    }
    for(const child of Object.values(node)){
      if(Array.isArray(child))pending.push(...child);
      else if(child&&typeof child==='object'&&'type' in child)pending.push(child);
    }
  }
  return false;
}
export type Test262Case = {
  file: string;
  mode: 'module' | 'strict' | 'non-strict' | 'raw';
  source: string;
  harness: { file: string; source: string }[];
  features: string[];
  flags: string[];
  asynchronous: boolean;
  negative: { phase: 'parse' | 'resolution' | 'runtime'; type: string } | null;
};

export async function verifyTest262Checkout(root: string): Promise<void> {
  const { stdout: head } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  if (head.trim() !== test262Revision) throw Error('Test262 checkout does not match the pinned revision');
  const { stdout: changes } = await execute('git', ['status', '--porcelain', '--untracked-files=all', '--',
    'test', 'harness', 'INTERPRETING.md', 'package.json'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  if (changes.trim()) throw Error('Test262 test, harness or execution-contract files have local changes');
  const { stdout: tracked } = await execute('git', ['ls-files', '-t', '--', 'test', 'harness'],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  if (tracked.split('\n').some(line => line.startsWith('S '))) throw Error('Test262 checkout is sparse; omitted tests cannot count as full-suite coverage');
}
function strings(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string')) throw Error(`Invalid Test262 ${name}`);
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Test262 metadata');
  return value as Record<string, unknown>;
}
function inside(root: string, name: string): string {
  const absolute = resolve(root, name), suffix = relative(root, absolute);
  if (!suffix || suffix.startsWith('..') || isAbsolute(suffix)) throw Error('Test262 path escapes its declared directory');
  return absolute;
}
/** Test input preparation only. No source wrapping, compilation, execution, or
 * conformance result is performed here. Harness scripts must execute separately
 * as global code in the test's fresh realm, including for module tests. */
export async function* test262Cases(root: string, paths: string[] = ['test']): AsyncGenerator<Test262Case> {
  root = resolve(root);
  if (!paths.length) throw Error('Test262 selection must not be empty');
  for (const path of paths) {
    if (path !== 'test') inside(resolve(root, 'test'), relative(resolve(root, 'test'), resolve(root, path)));
  }
  const stream = new TestStream(root, { paths, omitRuntime: true });
  const seen = new Set<string>();
  const harnessSources = new Map<string, string>();
  for await (const raw of stream) {
    const test = record(raw), attrs = record(test.attrs), flags = record(attrs.flags);
    if (typeof test.file !== 'string' || typeof test.contents !== 'string') throw Error('Invalid Test262 test input');
    if (test.scenario !== 'default' && test.scenario !== 'strict mode') throw Error('Unknown Test262 scenario');
    // test262-stream emits both variants for modules. INTERPRETING.md specifies
    // one module execution; implicit module strictness must not insert a directive.
    if (flags.module && test.scenario === 'strict mode') continue;
    const mode = flags.module ? 'module' : flags.raw ? 'raw' : test.scenario === 'strict mode' ? 'strict' : 'non-strict';
    const key = `${test.file}\0${mode}`;
    if (seen.has(key)) throw Error(`Overlapping Test262 selection: ${test.file} (${mode})`);
    seen.add(key);
    const original = await readFile(inside(root, test.file), 'utf8');
    const source = mode === 'strict' ? '"use strict";\n' + original : original;
    if (test.contents !== source) throw Error('Test262 source preparation changed more than the strict directive');
    const includes = flags.raw ? [] : [...new Set(['assert.js', 'sta.js', ...strings(attrs.includes, 'includes'),
      ...(flags.async ? ['doneprintHandle.js'] : [])])];
    const harness: Test262Case['harness'] = [];
    for (const file of includes) {
      let source = harnessSources.get(file);
      if (source === undefined) {
        source = await readFile(inside(resolve(root, 'harness'), file), 'utf8');
        harnessSources.set(file, source);
      }
      harness.push({ file, source });
    }
    let negative: Test262Case['negative'] = null;
    if (attrs.negative !== undefined) {
      const value = record(attrs.negative);
      if (!['parse', 'resolution', 'runtime'].includes(String(value.phase)) || typeof value.type !== 'string') throw Error('Invalid Test262 negative expectation');
      negative = { phase: value.phase as NonNullable<Test262Case['negative']>['phase'], type: value.type };
    }
    yield { file: test.file, mode, source, harness, flags: Object.keys(flags),
      features: strings(attrs.features, 'features'), asynchronous: flags.async === true, negative };
  }
}
