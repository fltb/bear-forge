import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript, compileTypeScript, admitSource } from '../src/index.ts';
test('emits ahead-of-time function factories rather than dynamic constructors', () => {
  const p = compileJavaScript('module.exports.program=async function run(n,io){function next(){return ++n;}await io.call({port:"read",input:next()});return next();}');
  const x = JSON.parse(new TextDecoder().decode(p.content));
  assert.equal(x.abi, 'effectful-v2-static-2');
  assert.match(x.code, /function \(module, exports,/);
  assert.match(x.code, /__tick\(\)/);
  assert.doesNotMatch(x.code, /new Function|eval\(/);
});
test('author admission rejects dynamic and undeclared effects including imports', () => {
  for (const source of ['const x=eval("1")', 'new Function("return 1")', 'Math.random()', 'fetch("x")', 'import("x")', 'const x=process.env', 'new Promise(()=>{})', 'const x=Object.constructor', 'const x=globalThis', 'import fs from "node:fs"']) assert.throws(() => admitSource(source, 'fixture.ts'), source);
  admitSource('export async function run(n:number,io:{call:(x:unknown)=>Promise<number>}){let value=n;function next(){return ++value;}return await io.call(next());}', 'fixture.ts');
});
test('TypeScript compilation rejects semantic errors before emitting an artifact', async () => {
  await assert.rejects(compileTypeScript('const value:number="wrong"; export const program=value;'), /TypeScript check failed/);
  const artifact = await compileTypeScript('export async function program(value:number,io:{call:(x:unknown)=>Promise<number>}){return value+await io.call(value);}');
  assert.ok(artifact.content.byteLength > 0);
});
test('Map/Set iterators and alias iteration across suspension are rejected at construction', () => {
  for (const source of ['const table=new Map();const alias=table;async function run(io){for(const item of alias){await io.call(item);}}', 'async function run(io){for(const item of new Set([1])){await io.call(item);}}', 'const table=new Map();const alias=table;const iterator=alias.values();']) assert.throws(() => admitSource(source, 'fixture.ts'), /iterator|iteration/);
  admitSource('const table=new Map();const values=Array.from(table.values());async function run(io){for(const value of values)await io.call(value);}', 'fixture.ts');
});
