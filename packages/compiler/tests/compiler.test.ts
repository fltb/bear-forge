import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { transformSync } from '@babel/core';
import { compileJavaScript, compileTypeScript, admitSource } from '../src/index.ts';
import { AuthorAdmissionError, isAuthorParseError } from '../src/admission.ts';
import { generatedGlobals } from '../src/generated-globals.ts';

test('module await syntax survives reparsing after module declarations are erased', async () => {
  // This checks compilation, not the still-incomplete async module evaluator.
  for (const source of ['await ``;', '{ await `text`; }', 'for await (const item of []) {}',
    'const value = await `text`; export {value};',
    '({[await `key`]() {}});', 'class Example {[await `key`]() {}}',
    'class Example {static [await `key`]() {}}']) {
    const artifact=JSON.parse(new TextDecoder().decode(compileJavaScript(source).content));
    assert.doesNotThrow(()=>new Script(artifact.code),source);
  }
  for(const source of ['await ``; export const value=1;', 'const value=await `text`;export {value};']) {
    const artifact=JSON.parse(new TextDecoder().decode((await compileTypeScript(source)).content));
    assert.doesNotThrow(()=>new Script(artifact.code),source);
  }
  // A real tag remains outside admission; detecting an await grants no syntax
  // exemptions to the rest of the source.
  for(const source of ['const tag=x=>x;tag``;', 'await 0;const tag=x=>x;tag``;'])
    assert.throws(()=>compileJavaScript(source),/Unsupported author syntax TaggedTemplateExpression/);
  for(const source of ['async function f(){await ``;}',
    'async function f(){({[await `key`]() {}});}',
    'async function f(){class Example{[await `key`]() {}}}'])
    assert.equal(admitSource(source,'program.js').hasTopLevelAwait,false,source);
});
test('emits ahead-of-time function factories rather than dynamic constructors', () => {
  const p = compileJavaScript('export const program=async function run(n,io){function next(){return ++n;}await io.call({port:"read",input:next()});return next();}');
  const x = JSON.parse(new TextDecoder().decode(p.content));
  assert.equal(x.abi, 'effectful-v2-main-3');
  assert.match(x.code, /function \(module, exports,/);
  assert.match(x.code, /__tick\(\)/);
  assert.doesNotMatch(x.code, /new Function|eval\(/);
  assert.doesNotMatch(x.code, /__webpack_require__/);
});
test('compiled factories do not supply ambient host fallbacks', () => {
  const source='export const program={schemas:{},async run(){return [typeof navigator,Date,Proxy,URL,File]}};';
  const artifact=JSON.parse(new TextDecoder().decode(compileJavaScript(source).content));
  for(const name of ['Date','Proxy','URL','File','setTimeout','clearTimeout','setInterval','clearInterval','setImmediate','clearImmediate','queueMicrotask'])
    assert.doesNotMatch(artifact.code,new RegExp('\\b(?:const|let|var)\\s+'+name+'\\s*='));
  assert.match(artifact.code,/globalRead/);
  assert.match(artifact.code,/globalTypeof\(/);
});
test('generated code rejects unbound host names without rejecting local bindings', () => {
  const check=(source:string)=>transformSync(source,{
    configFile:false,babelrc:false,plugins:[()=>generatedGlobals(false)]
  });
  for(const name of ['process','__webpack_require__','URL','setTimeout'])
    assert.throws(()=>check(`${name};`),new RegExp('Generated host-global reference '+name));
  assert.throws(()=>check('arguments[1];'),/Generated host-global reference arguments/);
  assert.throws(()=>check('const read=()=>arguments[1];'),/Generated host-global reference arguments/);
  assert.doesNotThrow(()=>check('function read(){return arguments[1]}'));
  assert.doesNotThrow(()=>check('function read(){return ()=>arguments[1]}'));
  assert.doesNotThrow(()=>check('const process={pid:1};process.pid;Object.keys(process);'));
  assert.match(check('JSON.parse("{}");')!.code!,/__bearCapabilities\.intrinsics\.JSON\.parse/);
});
test('author admission rejects dynamic and undeclared effects including imports', () => {
  for (const source of ['const x=eval("1")', 'fetch("x")', 'import("x")', 'const x=process.env', 'import fs from "node:fs"', 'const __bearOps={}']) assert.throws(() => admitSource(source, 'fixture.ts'), source);
  admitSource('export async function run(n:number,io:{call:(x:unknown)=>Promise<number>}){let value=n;function next(){return ++value;}return await io.call(next());}', 'fixture.ts');
});
test('TypeScript compilation rejects semantic errors before emitting an artifact', async () => {
  await assert.rejects(compileTypeScript('const value:number="wrong"; export const program=value;'), /TypeScript check failed/);
  const artifact = await compileTypeScript('export async function program(value:number,io:{call:(x:unknown)=>Promise<number>}){return value+await io.call(value);}');
  assert.ok(artifact.content.byteLength > 0);
});
test('Map/Set iteration uses runtime semantics independently of source spelling', () => {
  for (const source of ['const table=new Map();const alias=table;async function run(io){for(const item of alias){await io.call(item);}}', 'async function run(io){for(const item of new Set([1])){await io.call(item);}}', 'const table=new Map();const alias=table;const iterator=alias.values();']) admitSource(source, 'fixture.ts');
  admitSource('const table=new Map();const values=Array.from(table.values());async function run(io){for(const value of values)await io.call(value);}', 'fixture.ts');
});

test('arguments belongs to its lexical ordinary function, never to the module wrapper', () => {
  for (const source of ['arguments[0]', 'const read=()=>arguments[0]', 'const value={ [arguments[0]](){} }']) {
    assert.throws(() => admitSource(source, 'fixture.ts'), /Undeclared capability arguments/);
  }
  for (const source of ['function read(){return arguments[0]}',
    'function read(){return ()=>arguments[0]}', 'const object={read(){return arguments[0]}}']) {
    admitSource(source, 'fixture.ts');
  }
});

test('continuation stage rejects missing assignment lowering instead of using an arithmetic fallback', () => {
  const require = createRequire(import.meta.url);
  const plugin = require('@effectful/core/v2/compiler').babelPlugin(require('@effectful/core/v2/presets/debugger').default);
  for (const expression of ['value++', 'value += 1', 'value ||= 2']) {
    assert.throws(() => transformSync(`module.exports=function(){let value='1';return ${expression}}`, {
      configFile: false, babelrc: false, plugins: [[plugin, { blackbox: true }]],
    }), /Internal compiler stage error/);
    assert.ok(compileJavaScript(`export const program=async function(){let value='1';return ${expression}}`).content.byteLength);
  }
});

test('continuation compilation releases invocation graphs after success and failure', () => {
  const require = createRequire(import.meta.url);
  const context = require('@effectful/core/v2/context');
  const config = require('@effectful/core/v2/config').default;
  const root = context.root, file = config.babelFile;
  compileJavaScript('export const program=async function(n,io){return n+await io.call(n);}');
  assert.strictEqual(context.root, root);
  assert.strictEqual(config.babelFile, file);
  const plugin = require('@effectful/core/v2/compiler').babelPlugin(require('@effectful/core/v2/presets/debugger').default);
  assert.throws(() => transformSync('function failed(){let n=0;return n++;}', {
    configFile: false, babelrc: false, plugins: [[plugin, { blackbox: true }]],
  }), /Internal compiler stage error/);
  assert.strictEqual(context.root, root);
  assert.strictEqual(config.babelFile, file);
});


test('policy rejection cannot masquerade as an ECMAScript syntax error', () => {
  const policySources = [
    'fetch("x")', 'import("x")',
    'import fs from "node:fs"',
    'const __bearOps={};', 'import x from "bad\\0specifier";'
  ];
  for (const source of policySources) {
    for (const check of [() => admitSource(source, 'policy.ts'), () => compileJavaScript(source)]) {
      assert.throws(check, (error: unknown) => {
        assert.ok(error instanceof AuthorAdmissionError, source);
        assert.equal(error instanceof SyntaxError, false, source);
        assert.equal(isAuthorParseError(error), false);
        assert.match(error.message, /\^/);
        return true;
      });
    }
  }
  for (const source of ['unknown=null;', 'const x=unknown;', 'const x=typeof navigator;']) {
    assert.doesNotThrow(() => admitSource(source, 'policy.ts'));
  }
  for (const source of ['const = ;', 'function broken( {', 'const x=1;const x=2;']) {
    assert.throws(() => compileJavaScript(source), (error: unknown) => {
      assert.ok(error instanceof SyntaxError, source);
      assert.equal(error instanceof AuthorAdmissionError, false, source);
      assert.equal((error as SyntaxError & {code?: string}).code, 'BABEL_PARSE_ERROR');
      assert.equal(isAuthorParseError(error), true);
      return true;
    });
  }
});


test('generated-code parse errors are not original-source syntax failures', () => {
  try { transformSync('const = ;', {configFile:false,babelrc:false}); }
  catch(error) {
    assert.ok(error instanceof SyntaxError);
    assert.equal(isAuthorParseError(error), false);
    return;
  }
  assert.fail('Malformed generated source must be rejected');
});

test('resource declarations are admitted and lowered through ordinary control flow', () => {
  for(const body of ['using value=null;','await using value=null;',
    'for(using value of []){}','for(await using value of []){}',
    '{using resource={ [Symbol.dispose](){} };}']){
    const source=`export const program=async function(){${body}};`;
    for(const filename of ['program.js','program.ts'])admitSource(source,filename);
    assert.ok(compileJavaScript(source).content.byteLength);
  }
  assert.equal(admitSource('await using value=null;','module.js').hasTopLevelAwait,true);
});

test('JavaScript admission retains module early errors instead of using TypeScript grammar', () => {
  for (const source of [
    'const x=1;export {x};export {x};',
    'const x=1;export {x as z};export * as z from "./self.js";',
    'export var x=1,x=2;',
    'const x:number=1;'
  ]) {
    for (const filename of ['module.js','module.mjs']) {
      assert.throws(() => admitSource(source,filename), isAuthorParseError);
    }
    assert.throws(() => compileJavaScript(source), isAuthorParseError);
  }
  for (const filename of ['module.ts','module.mts']) {
    admitSource('const x:number=1;export {x};', filename);
  }
  admitSource('const x=1;export {x};', 'module.js');
});
