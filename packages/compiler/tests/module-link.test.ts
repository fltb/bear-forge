import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateModuleLink,isNativeModuleLinkError} from '../src/module-link.ts';
import {isDependencyResolutionError} from '../src/module-resolution.ts';
import {isAuthorParseError} from '../src/admission.ts';
import {bundleProgram} from '../src/bundle.ts';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

test('native link validation never evaluates source or synthetic modules',async()=>{
  await validateModuleLink({id:'entry',source:`import {value} from 'data';
    throw new Error('source evaluated'); export {value};`},async()=>({id:'data',exports:['value']}));
});

test('native link validation rejects missing exports as SyntaxError',async()=>{
  await assert.rejects(validateModuleLink({id:'entry',source:`import {absent} from 'data';`},
    async()=>({id:'data',exports:['present']})),error=>isNativeModuleLinkError(error)&&error instanceof SyntaxError);
});

test('bundling defers missing-export diagnostics until native link validation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-link-'));
  const entry=join(directory,'entry.js'),dependency=join(directory,'dependency.js');
  try{
    await writeFile(dependency,'export const present=1;');
    await assert.rejects(bundleProgram(entry,`import {absent} from './dependency.js';
      export const program={schemas:{},async run(){return absent;}};`),SyntaxError);
  }finally{
    await unlink(dependency);
    await rmdir(directory);
  }
});

test('bundling reports circular reexports through native link validation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-link-'));
  const entry=join(directory,'entry.js'),dependency=join(directory,'dependency.js');
  try{
    await writeFile(entry,"export {missing} from './dependency.js';");
    await writeFile(dependency,"export {missing} from './entry.js';");
    await assert.rejects(bundleProgram(entry),SyntaxError);
  }finally{
    await unlink(entry);
    await unlink(dependency);
    await rmdir(directory);
  }
});

test('valid indirect reexport cycles terminate production bundling',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-reexports-'));
  const entry=join(directory,'entry.mjs'),dependency=join(directory,'dependency.mjs');
  const letters='abcdefghijklmnopqrstuvwxyz';
  const entryExports=Array.from({length:13},(_,index)=>{
    const imported=letters[2*index],exported=index===0?'a':letters[2*index-1];
    return `export {${imported}${imported===exported?'':` as ${exported}`}} from './dependency.mjs';`;
  }).join('\n');
  const dependencyExports=Array.from({length:13},(_,index)=>
    `export {${letters[2*index+1]} as ${letters[2*index]}} from './entry.mjs';`).join('\n');
  try{
    await writeFile(entry,`${entryExports}\nexport var z;`);
    await writeFile(dependency,dependencyExports);
    const native=await import(pathToFileURL(entry).href);
    assert.equal(native.a,undefined);
    assert.equal(native.z,undefined);
    // An upstream cycle in reexport-warning traversal previously blocked the
    // event loop forever. Run the production bundler in a bounded child so a
    // regression fails this test instead of hanging the entire check suite.
    const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',
      "import {bundleProgram} from './src/bundle.ts';await bundleProgram(process.argv[1]);",entry],{
      cwd:fileURLToPath(new URL('../',import.meta.url)),timeout:10_000,encoding:'utf8'
    });
    assert.equal(child.error,undefined,String(child.error));
    assert.equal(child.status,0,child.stderr);
  }finally{
    await unlink(entry);await unlink(dependency);await rmdir(directory);
  }
});

test('an imported parse error has resolution provenance while an entry parse error does not',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-link-'));
  const entry=join(directory,'entry.js'),dependency=join(directory,'dependency.js');
  try{
    await writeFile(dependency,'export const = ;');
    await assert.rejects(bundleProgram(entry,"import './dependency.js';"),error=>isDependencyResolutionError(error));
    await assert.rejects(bundleProgram(entry,'export const = ;'),error=>
      isAuthorParseError(error)&&!isDependencyResolutionError(error));
  }finally{
    await unlink(dependency);
    await rmdir(directory);
  }
});

test('invalid imported JSON reports a resolution-phase SyntaxError',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-module-link-'));
  const entry=join(directory,'entry.js'),data=join(directory,'data.json');
  try{
    await writeFile(data,'{"missing": }');
    await assert.rejects(bundleProgram(entry,"import data from './data.json' with {type:'json'}; export {data};"),
      error=>isDependencyResolutionError(error));
  }finally{
    await unlink(data);
    await rmdir(directory);
  }
});

test('native link validation propagates synchronous and asynchronous resolver failures',async()=>{
  const failure=new Error('resolver failed');
  for(const resolve of [()=>{throw failure;},async()=>{throw failure;}]){
    await assert.rejects(validateModuleLink({id:'entry',source:`import 'dependency';`},resolve),error=>error===failure);
  }
});

test('native link validation retains cyclic module identity',async()=>{
  const entry={id:'entry',source:`export * from 'cycle';export * from 'provider';`};
  await validateModuleLink(entry,async({specifier})=>{
    if(specifier==='cycle')return {id:'cycle',source:`export {value} from 'entry';`};
    if(specifier==='entry')return entry;
    return {id:'provider',source:'export const value=1;'};
  });
});
