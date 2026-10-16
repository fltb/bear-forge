import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleProgram } from '../src/bundle.ts';
import { admitSource, AuthorAdmissionError } from '../src/admission.ts';
import {programCapabilities} from '../../runtime/src/program-code.ts';
import { normalizeLabels } from '../src/labels.ts';
import {compileEntry} from '../src/compile.ts';
import {Script} from 'node:vm';
import {createHash} from 'node:crypto';

test('file-backed bundle records exact source, JSON and package resolution inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-source-manifest-'));
  try {
    const entry = join(root, 'entry.mts'), json = join(root, 'rules.json'), manifest = join(root, 'package.json');
    await writeFile(manifest, '{"type":"module"}');
    await writeFile(json, '{"value":1}');
    await writeFile(entry, `import rules from './rules.json' with { type: 'json' }; export const program = rules;`);
    const first = new Map((await bundleProgram(entry)).sourceFiles);
    const hash = (content: string) => createHash('sha256').update(content).digest('hex');
    assert.equal(first.get(await realpath(entry)), hash(await readFile(entry, 'utf8')));
    assert.equal(first.get(await realpath(json)), hash('{"value":1}'));
    assert.equal(first.get(await realpath(manifest)), hash('{"type":"module"}'));
    await writeFile(json, '{"value":2}');
    assert.notEqual(new Map((await bundleProgram(entry)).sourceFiles).get(await realpath(json)), first.get(await realpath(json)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dependency await syntax retains parse context without skipping later source admission',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-await-dependency-'));
  try{
    const entry=join(root,'entry.mts'),dependency=join(root,'dependency.mjs');
    await writeFile(entry,'import "./dependency.mjs";export const program={schemas:{},async run(){return null;}};');
    await writeFile(dependency,'await ``;');
    const artifact=JSON.parse(new TextDecoder().decode((await compileEntry(entry)).content));
    assert.doesNotThrow(()=>new Script(artifact.code));
    await writeFile(entry,'await ``;import "./dependency.mjs";export const value=1;');
    await writeFile(dependency,'fetch("undeclared");');
    await assert.rejects(compileEntry(entry),/Undeclared capability fetch/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('transitive ESM packages receive the same admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-dependencies-'));
  try {
    for (const name of ['zod', 'ordinary-library']) {
      const directory = join(root, 'node_modules', name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, type:'module', main: 'index.js' }));
      await writeFile(join(directory, 'index.js'), 'export {value} from "./nested.js";');
      await writeFile(join(root, 'entry.js'), `import {value} from '${name}';export const program=value;`);
      const bundle = () => bundleProgram(join(root, 'entry.js'));
      await writeFile(join(directory, 'nested.js'), 'export const value=process.env;');
      await assert.rejects(bundle(), (error: unknown) => {
        assert.ok(error instanceof AuthorAdmissionError);
        assert.equal(error instanceof SyntaxError, false);
        assert.match(error.message, /Undeclared capability process/);
        return true;
      });
      await writeFile(join(directory, 'nested.js'), 'export const value=40+2;');
      await bundle();
      await writeFile(join(directory, 'nested.js'), 'using resource=null;export const value=42;');
      await bundle();
      for (const declaration of ['import defer * as ns', 'import source ns']) {
        await writeFile(join(directory, 'nested.js'), `${declaration} from './other.js';export const value=42;`);
        await assert.rejects(bundle(), /Unsupported import phase/);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unresolved global references keep ESM semantics inside the instance', () => {
  for (const source of ['Object=1;', 'Object++;', '({value:Object}={value:1});', '[Object]=[1];', 'for(Object of []){}', 'for(Object in {}){}']) {
    assert.doesNotThrow(() => admitSource(source, 'program.ts'));
    assert.doesNotThrow(() => admitSource(source.replaceAll('Object','notDeclared'), 'program.ts'));
  }
  admitSource('let Object=1;Object++;', 'program.ts');
});

test('author imports cannot address compiler virtual modules', () => {
  for (const source of ['import value from "\\0commonjsHelpers.js";',
    'export * from "\\0commonjsHelpers.js";', 'export {value} from "\\0commonjsHelpers.js";']) {
    assert.throws(() => admitSource(source, 'entry.ts'), /Invalid module specifier/);
  }
});

test('bundling canonicalizes label aliases without crossing nested function scopes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-labels-'));
  try {
    const source = `export function run(){const values=[];
      first: second: for(let i=0;i<3;i++){
        function nested(){first: for(let j=0;j<2;j++){if(j===0)continue first;return j;}}
        values.push(nested());if(i<2)continue second;break first;
      }
      block: alias: {values.push(9);break alias;values.push(10);}
      return values;}`;
    await writeFile(join(root, 'library.ts'), source);
    await writeFile(join(root, 'entry.ts'), `export {run} from './library.ts';`);
    const bundle = await bundleProgram(join(root, 'entry.ts'));
    const module = { exports: {} as {run: () => number[]} };
    Function('module', 'exports', '__bearOps', bundle.code)(module, module.exports, operations());
    assert.deepEqual(module.exports.run(), [1,1,1,9]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('label normalization preserves empty modules and unchanged source', () => {
  for (const source of ['', 'export {};', 'const x: number = 1;']) assert.equal(normalizeLabels(source, 'source.ts'), source);
});

test('linking preserves dependency TDZ, cycles and live imported bindings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-module-semantics-'));
  try {
    await writeFile(join(root, 'entry.mjs'), `
      import {trace,read} from './dependency.mjs';
      export let value=7;
      export function increment(){return ++value;}
      export const program={trace,read,increment};
    `);
    await writeFile(join(root, 'dependency.mjs'), `
      import {value} from './entry.mjs';
      export const trace=[];
      try{trace.push(value);}catch(error){trace.push(error.name);}
      export function read(){return value;}
    `);
    const original = await import(pathToFileURL(join(root, 'entry.mjs')).href);
    const bundle = await bundleProgram(join(root, 'entry.mjs'));
    const module = { exports: {} as any };
    Function('module', 'exports', '__bearOps', bundle.code)(module, module.exports, operations());
    const actual = module.exports.program, expected = original.program;
    assert.deepEqual(actual.trace, expected.trace);
    assert.deepEqual(actual.trace, ['ReferenceError']);
    assert.equal(actual.read(), expected.read());
    assert.equal(actual.increment(), expected.increment());
    assert.equal(actual.read(), expected.read());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('JSON dependencies preserve data keys and ordinary object prototypes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-json-'));
  try {
    const source = '{"__proto__":{"answer":42},"name":"data","negativeZero":-0}';
    await writeFile(join(root, 'data.json'), source);
    await writeFile(join(root, 'entry.mjs'), `import data from './data.json' with {type:'json'};const {__proto__:proto,name}=data;export const program={data,proto,name};`);
    const bundle = await bundleProgram(join(root, 'entry.mjs'));
    const module = { exports: {} as any };
    Function('module', 'exports', '__bearOps', bundle.code)(module, module.exports, operations());
    const { data, proto, name } = module.exports.program;
    assert.equal(Object.getPrototypeOf(data), Object.prototype);
    assert.deepEqual(data, JSON.parse(source));
    assert.equal(proto, data.__proto__);
    assert.equal(name, data.name);
    assert.equal(Object.is(data.negativeZero, -0), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});


for (const subject of ['names', 'namespace'] as const) test(`linking preserves observable module ${subject}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bear-module-reflection-'));
  try {
    await writeFile(join(root, 'first.mjs'), `
      export function same(){};
      export class Model{static initialName=this.name;}
      export const arrow=()=>0;
      export let value=1;
      export function increment(){value++;}
    `);
    await writeFile(join(root, 'second.mjs'), `
      export function same(){};
      export class Model{static initialName=this.name;}
      export const arrow=()=>0;
    `);
    const entry=join(root, 'entry.mjs');
    await writeFile(entry, `
      import * as first from './first.mjs';
      import * as second from './second.mjs';
      export function names(){return [first.same.name,second.same.name,
        first.Model.name,second.Model.name,first.Model.initialName,second.Model.initialName,
        first.arrow.name,second.arrow.name];}
      export function namespace(){
        const describe=()=>{
          const descriptor=Object.getOwnPropertyDescriptor(first,'value');
          return [Object.getPrototypeOf(first)===null,Object.isExtensible(first),Object.isSealed(first),Object.isFrozen(first),
            Object.prototype.toString.call(first),Reflect.ownKeys(first).map(String),
            descriptor.value,descriptor.writable,descriptor.enumerable,descriptor.configurable,'get' in descriptor];
        };
        const before=describe();first.increment();const after=describe();
        const same=Reflect.defineProperty(first,'value',{value:first.value});
        const different=Reflect.defineProperty(first,'value',{value:9});
        return [before,after,same,different,Reflect.set(first,'value',9),first.value];
      }
    `);
    const original=await import(pathToFileURL(entry).href);
    const bundle=await bundleProgram(entry);
    const module={exports:{} as any};
    Function('module','exports','__bearOps',bundle.code)(module,module.exports,operations());
    assert.deepEqual(module.exports[subject](),original[subject]());
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('linked default and explicitly named functions retain names without changing binding recursion', async () => {
  const root=await mkdtemp(join(tmpdir(),'bear-linked-default-names-'));
  try {
    await writeFile(join(root,'first.mjs'), `
      export default function(){return 'first';}
      export function same(){return same;}
      export function replace(value){same=value;}
      export const explicit=function same(){return same;};
    `);
    await writeFile(join(root,'second.mjs'), `export default ()=>0;export async function same(){};`);
    const entry=join(root,'entry.mjs');
    await writeFile(entry, `
      import first,{same,replace,explicit} from './first.mjs';
      import second,{same as other} from './second.mjs';
      export function run(){
        const saved=same,names=[first.name,second.name,same.name,other.name,explicit.name];
        replace(7);return [names,saved()===7,explicit()===explicit];
      }
    `);
    const original=await import(pathToFileURL(entry).href),bundle=await bundleProgram(entry),module={exports:{} as any};
    Function('module','exports','__bearOps',bundle.code)(module,module.exports,operations());
    assert.deepEqual(module.exports.run(),original.run());
  } finally {await rm(root,{recursive:true,force:true});}
});

test('namespace provenance covers reexports and cannot retag ordinary frozen objects', async () => {
  const root=await mkdtemp(join(tmpdir(),'bear-namespace-provenance-'));
  try {
    await writeFile(join(root,'dependency.mjs'), `const proto=7;export {proto as '__proto__'};export const x=1;`);
    await writeFile(join(root,'reexport.mjs'), `export * as ns from './dependency.mjs';`);
    const entry=join(root,'entry.mjs');
    await writeFile(entry, `import {ns} from './reexport.mjs';
      const ordinary=Object.freeze({__proto__:null,x:1});
      export const program=[ns.__proto__,Object.getPrototypeOf(ns),Object.prototype.toString.call(ns),
        Object.prototype.toString.call(ordinary),Object.isFrozen(ordinary),Object.getOwnPropertyDescriptor(ns,'x').writable];`);
    const original=await import(pathToFileURL(entry).href),bundle=await bundleProgram(entry),module={exports:{} as any};
    Function('module','exports','__bearOps',bundle.code)(module,module.exports,operations());
    assert.deepEqual(module.exports.program,original.program);
    assert.doesNotMatch(bundle.code,/moduleNamespaceMarker/);
    assert.throws(()=>admitSource('__bearOps.moduleNamespaceMarker(value);','entry.ts'),/Reserved execution identifier/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('runtime global bindings are reachable through the same direct-name admission surface',async()=>{
  const {programCapabilities}=await import('../../runtime/src/program-code.ts');
  const globals=programCapabilities(()=>{},()=>{throw new Error('unavailable');}).globals();
  for(const name of Object.getOwnPropertyNames(globals)){
    admitSource(`const binding=${name};`, 'globals.ts');
    assert.doesNotThrow(()=>admitSource(`${name}=null;`, 'globals.ts'));
  }
});

test('author supplied source maps cannot forge callable names during linking',async()=>{
  const map={version:3,sources:['fake.js'],sourcesContent:['function forged(){return 7;}'],names:[],mappings:'AAAA'};
  const source='function actual(){return 7;} export const program=actual;\n//# sourceMappingURL=data:application/json;base64,'+
    Buffer.from(JSON.stringify(map)).toString('base64');
  for(const extension of ['js','ts']){
    const bundle=await bundleProgram('origin-input.'+extension,source),module:any={exports:{}};
    Function('module','exports','__bearOps',bundle.code)(module,module.exports,operations());
    assert.equal(module.exports.program.name,'actual');assert.equal(module.exports.program(),7);
  }
});

// Link-only execution still supplies the real, isolated capability environment.
function operations(){
  const capabilities=programCapabilities(()=>{},()=>{throw Error('Unavailable host capability');});
  capabilities.globals();
  return capabilities.operations;
}
