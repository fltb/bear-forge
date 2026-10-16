import { test } from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type { Test262Case } from './test262-cases.ts';
import { test262Result } from './test262-outcome.ts';
import { runTest262Reference } from './test262-reference.ts';
const input = (source: string, changes: Partial<Test262Case> = {}): Test262Case => ({
  file: 'test/synthetic.js', mode: 'non-strict', source, harness: [], flags: [], features: [], asynchronous: false, negative: null, ...changes
});
test('Test262 outcomes require both expected phase and error constructor; missing infrastructure never passes', () => {
  const candidate = input('', { negative: { phase: 'runtime', type: 'TypeError' } });
  for (const phase of ['parse', 'resolution', 'runtime'] as const) for (const constructorName of ['Error', 'TypeError']) {
    assert.equal(test262Result(candidate, 'production-controlled', { kind: 'threw', phase, constructorName }).status,
      phase === 'runtime' && constructorName === 'TypeError' ? 'passed' : 'failed');
  }
  assert.equal(test262Result(candidate, 'production-controlled', { kind: 'completed' }).status, 'failed');
  assert.equal(test262Result(candidate, 'production-controlled', { kind: 'timeout' }).status, 'failed');
  assert.equal(test262Result(candidate, 'production-controlled', { kind: 'runner-missing', reason: 'realm' }).status, 'not-executed');
  assert.equal(test262Result(candidate, 'production-controlled', { kind: 'runner-error', message: 'harness' }).status, 'not-executed');
});
test('reference execution keeps global-code semantics and a fresh realm for each case', async () => {
  const a = await runTest262Reference(input('var example = 7; if (this.example !== 7) throw Error(); Array.prototype.leaked = 1;'));
  assert.equal(a.status, 'passed'); assert.equal(a.backend, 'native-reference');
  assert.equal((await runTest262Reference(input('if (Array.prototype.leaked !== undefined) throw Error();'))).status, 'passed');
  assert.equal((await runTest262Reference(input('"use strict"; if (this !== globalThis) throw Error();', { mode: 'strict' }))).status, 'passed');
});
test('reference execution distinguishes parse/runtime/harness failures and constructor names', async () => {
  assert.equal((await runTest262Reference(input('let = ;', { negative: { phase: 'parse', type: 'SyntaxError' } }))).status, 'passed');
  assert.equal((await runTest262Reference(input('throw new TypeError();', { negative: { phase: 'runtime', type: 'TypeError' } }))).status, 'passed');
  assert.equal((await runTest262Reference(input('throw {name:"TypeError"};', { negative: { phase: 'runtime', type: 'TypeError' } }))).status, 'failed');
  const broken = await runTest262Reference(input('throw new TypeError();', { harness: [{ file: 'broken.js', source: 'throw new TypeError();' }], negative: { phase: 'runtime', type: 'TypeError' } }));
  assert.equal(broken.status, 'not-executed');
  const brokenBeforeParse = await runTest262Reference(input('let = ;', {
    harness: [{ file: 'broken.js', source: 'throw new Error();' }], negative: { phase: 'parse', type: 'SyntaxError' }
  }));
  assert.equal(brokenBeforeParse.status, 'not-executed');
});
test('reference async execution requires completion and cannot turn $DONE failure or missing host support into success', async () => {
  assert.equal((await runTest262Reference(input('Promise.resolve().then(()=>print("Test262:AsyncTestComplete"));', { asynchronous: true }))).status, 'passed');
  assert.equal((await runTest262Reference(input('print("Test262:AsyncTestFailure:Error: bad");', { asynchronous: true }))).status, 'failed');
  assert.equal((await runTest262Reference(input('Promise.resolve();', { asynchronous: true }), 200)).execution.kind, 'timeout');
  assert.equal((await runTest262Reference(input('try {$262.detachArrayBuffer();} catch {}'))).status, 'not-executed');
  assert.equal((await runTest262Reference(input('export {};', { mode: 'module' }))).status, 'passed');
});
test('reference wall-time limit also terminates non-yielding promise microtasks', async () => {
  const result = await runTest262Reference(input('function loop(){Promise.resolve().then(loop)}loop();', { asynchronous: true }), 200);
  assert.equal(result.execution.kind, 'timeout');
});

test('reference evalScript evaluates global code in the existing realm and returns its completion', async () => {
  const result = await runTest262Reference(input(`
    if ($262.evalScript('var shared = 7; shared + 2') !== 9) throw Error();
    if (shared !== 7 || globalThis.shared !== 7) throw Error();
    if ($262.evalScript('this') !== globalThis) throw Error();
    $262.evalScript('let lexical = 11');
    if ($262.evalScript('lexical') !== 11) throw Error();
    if ($262.evalScript('Array') !== Array) throw Error();
    $262.evalScript('function declared() {}');
    if (Object.getOwnPropertyDescriptor(globalThis, 'declared').configurable) throw Error();
    try { $262.evalScript('let = ;'); throw Error(); }
    catch (error) { if (!(error instanceof SyntaxError)) throw Error(); }
    const marker = {};
    globalThis.marker = marker;
    try { $262.evalScript('throw marker'); throw Error(); }
    catch (error) { if (error !== marker) throw Error(); }
  `));
  assert.equal(result.status, 'passed');
  assert.equal((await runTest262Reference(input('Object.preventExtensions(globalThis); if(Object.isExtensible(globalThis))throw Error();'))).status, 'passed');
  assert.equal((await runTest262Reference(input('$262.evalScript("let = ;")', {
    negative: {phase:'runtime', type:'SyntaxError'}
  }))).status, 'passed');
  assert.equal((await runTest262Reference(input('$262.evalScript("while (true) {}")'), 200)).execution.kind, 'timeout');
});

test('reference createRealm installs the host API with independent globals and intrinsic identities', async () => {
  const result = await runTest262Reference(input(`
    const other = $262.createRealm();
    if (other.global === globalThis || other.global.$262 !== other) throw Error();
    if (other.evalScript('this') !== other.global) throw Error();
    if (other.evalScript('Array') === Array) throw Error();
    other.evalScript('var privateGlobal = 7; let privateLexical = 9');
    if (other.global.privateGlobal !== 7 || other.evalScript('privateLexical') !== 9) throw Error();
    if (typeof privateGlobal !== 'undefined' || typeof privateLexical !== 'undefined') throw Error();
    try { other.evalScript('let = ;'); throw Error(); }
    catch (error) {
      if (error.constructor !== other.global.SyntaxError || error instanceof SyntaxError) throw Error();
    }
    const nested = other.createRealm();
    if (nested.global.Array === other.global.Array || nested.global.Array === Array) throw Error();
    const receiverIndependent = other.evalScript;
    if (receiverIndependent.call($262, 'this') !== other.global) throw Error();
  `));
  assert.equal(result.status, 'passed');
  assert.equal((await runTest262Reference(input('$262.createRealm().evalScript("while(true){}");'), 200)).execution.kind, 'timeout');
  assert.equal((await runTest262Reference(input('$262.createRealm().evalScript("print(\\"Test262:AsyncTestComplete\\")")', {asynchronous:true}))).status, 'passed');
});

test('missing reference capabilities report immediately even when the test catches and waits forever', async () => {
  const sources = [
    input('try {$262.detachArrayBuffer();} catch {}', {asynchronous:true}),
    input('import("./absent.js").catch(()=>{});', {mode:'module',asynchronous:true}),
    input('try {await import("./absent.js");} catch {} await new Promise(()=>{});', {mode:'module',asynchronous:true})
  ];
  for (const source of sources) {
    const result=await runTest262Reference(source,1000);
    assert.equal(result.execution.kind,'runner-missing');
    assert.equal(result.status,'not-executed');
  }
});


test('admission rejections never satisfy positive or negative Test262 expectations', () => {
  for (const negative of [null, {phase:'parse',type:'SyntaxError'}, {phase:'runtime',type:'TypeError'}] as const) {
    const result = test262Result(input('', {negative}), 'production-controlled', {
      kind:'admission-rejected', phase:'compile', reason:'Undeclared capability'
    });
    assert.equal(result.status, 'not-executed');
    assert.equal(result.execution.kind, 'admission-rejected');
  }
});


test('reference modules retain module scope, global harness bindings and distinct failure phases', async () => {
  const helper={file:'scope.js',source:'var helper=7; if(this!==globalThis)throw Error();'};
  const module=(source:string,changes:Partial<Test262Case>={})=>input(source,{mode:'module',harness:[helper],...changes});
  assert.equal((await runTest262Reference(module('if(this!==undefined || helper!==7)throw Error(); var local=1;if(globalThis.local!==undefined)throw Error(); await Promise.resolve();'))).status,'passed');
  assert.equal((await runTest262Reference(module('export {missing};',{negative:{phase:'parse',type:'SyntaxError'}}))).status,'passed');
  assert.equal((await runTest262Reference(module('throw new TypeError();',{negative:{phase:'runtime',type:'TypeError'}}))).status,'passed');
  assert.equal((await runTest262Reference(module('await Promise.resolve();print("Test262:AsyncTestComplete");',{asynchronous:true}))).status,'passed');
  assert.equal((await runTest262Reference(module('try{await import("./absent.js")}catch{}'))).status,'not-executed');
});

test('reference module linking preserves cycles and distinguishes missing exports from fixture failures', async () => {
  const root=await mkdtemp(join(tmpdir(),'bear-test262-modules-'));
  try {
    const module=(source:string,changes:Partial<Test262Case>={})=>input(source,{file:'main.js',mode:'module',...changes});
    await writeFile(join(root,'dep.js'),'import {read} from "./main.js"; export const value=read();');
    const cycle=module('import {value} from "./dep.js";export function read(){return 9;}if(value!==9)throw Error();');
    assert.equal((await runTest262Reference(cycle,5000,root)).status,'passed');
    await writeFile(join(root,'dep.js'),'export const present=1;');
    const missingExport=module('import {absent} from "./dep.js";throw Error("must not evaluate");',{negative:{phase:'resolution',type:'SyntaxError'}});
    assert.equal((await runTest262Reference(missingExport,5000,root)).status,'passed');
    const missingFixture=module('import "./missing.js";',{negative:{phase:'resolution',type:'Error'}});
    assert.equal((await runTest262Reference(missingFixture,5000,root)).execution.kind,'runner-error');
    const noRoot=await runTest262Reference(module('import "./dep.js";'));
    assert.equal(noRoot.execution.kind,'runner-missing');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('reference JSON modules retain realm, aliases, default-only exports and native values',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-test262-json-'));
  try{
    const module=(source:string,changes:Partial<Test262Case>={})=>input(source,{file:'main.js',mode:'module',...changes});
    await writeFile(join(root,'data.json'),'\uFEFF{"__proto__":{"safe":true},"items":[-0],"value":1}');
    await writeFile(join(root,'dep.js'),`export {default as alias} from './data.json' with {type:'json'};`);
    const source=module(`
      import value from './data.json' with {type:'json'};
      import * as namespace from './data.json' with {type:'json'};
      import {alias} from './dep.js';
      if(value!==alias||value!==namespace.default)throw Error('identity');
      if(Object.getPrototypeOf(value)!==Object.prototype||Object.getPrototypeOf(value.items)!==Array.prototype)throw Error('realm');
      if(Object.getOwnPropertyNames(namespace).join()!=='default')throw Error('exports');
      if(!Object.hasOwn(value,'__proto__')||!value.__proto__.safe||!Object.is(value.items[0],-0))throw Error('values');
      value.value++;if(alias.value!==2)throw Error('alias mutation');
    `);
    assert.equal((await runTest262Reference(source,5000,root)).status,'passed');
    assert.equal((await runTest262Reference(module(`import {value} from './data.json' with {type:'json'};`,{negative:{phase:'resolution',type:'SyntaxError'}}),5000,root)).status,'passed');
    await writeFile(join(root,'data.json'),'not JSON');
    assert.equal((await runTest262Reference(module(`import value from './data.json' with {type:'json'};`,{negative:{phase:'resolution',type:'SyntaxError'}}),5000,root)).status,'passed');
    assert.equal((await runTest262Reference(module(`import value from './data.json' with {type:'bytes'};`),5000,root)).status,'not-executed');
  }finally{await rm(root,{recursive:true,force:true});}
});
