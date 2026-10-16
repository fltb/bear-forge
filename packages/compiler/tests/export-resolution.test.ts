import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bundleProgram} from '../src/bundle.ts';
import {programCapabilities} from '../../runtime/src/program-code.ts';

const graphs:Record<string,Record<string,string>>={
  single:{a:`export * from './b.mjs';export * from './c.mjs';`,b:`export {value} from './a.mjs';`,c:'export let value=1;'},
  reversed:{a:`export * from './c.mjs';export * from './b.mjs';`,b:`export {value} from './a.mjs';`,c:'export let value=1;'},
  multiple:{a:`export * from './b.mjs';export * from './c.mjs';export * from './d.mjs';`,b:`export {value} from './a.mjs';`,c:'export let value=1;',d:`export {value} from './a.mjs';`},
  diamond:{a:`export * from './b.mjs';export * from './c.mjs';`,b:`export {value} from './d.mjs';`,c:`export {value} from './d.mjs';`,d:'export let value=1;'},
  ambiguous:{a:`export * from './b.mjs';export * from './c.mjs';`,b:'export let value=1;',c:'export let value=1;'},
  shadow:{a:`export * from './b.mjs';export * from './c.mjs';export const value=2;`,b:'export let value=1;',c:'export let value=1;'},
};
for(const [name,graph] of Object.entries(graphs))test(`export resolution matches raw V8: ${name}`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-export-resolution-'));
  try{
    for(const [id,source] of Object.entries(graph))await writeFile(join(root,id+'.mjs'),source);
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`import {value} from './a.mjs';export const result=value;`);
    let native:unknown,nativeError:unknown;
    try{native=(await import(pathToFileURL(entry).href)).result;}catch(error){nativeError=error;}
    if(nativeError){
      assert.ok(nativeError instanceof SyntaxError);
      await assert.rejects(bundleProgram(entry));
    }else{
      const bundle=await bundleProgram(entry),module:{exports:Record<string,unknown>}={exports:{}};
      const capabilities=programCapabilities(()=>{},()=>{throw Error('Unavailable host capability');});
      capabilities.globals();
      Function('module','exports','__bearOps',bundle.code)(module,module.exports,capabilities.operations);
      assert.equal(module.exports.result,native);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

for(const name of ['*','*value'])test(`literal export name ${JSON.stringify(name)} is not a namespace marker`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-literal-export-'));
  try{
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`var value='ok';export {value as ${JSON.stringify(name)}};
      import {${JSON.stringify(name)} as imported} from './entry.mjs';
      import * as namespace from './entry.mjs';
      export const result=[imported,namespace[${JSON.stringify(name)}],Object.getOwnPropertyNames(namespace)];`);
    const native=(await import(pathToFileURL(entry).href)).result;
    const bundle=await bundleProgram(entry),module:{exports:Record<string,unknown>}={exports:{}};
    const capabilities=programCapabilities(()=>{},()=>{throw Error('Unavailable host capability');});
    capabilities.globals();
    Function('module','exports','__bearOps',bundle.code)(module,module.exports,capabilities.operations);
    assert.deepEqual(module.exports.result,native);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('export star forwards a quoted star name as a named binding',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-forwarded-star-'));
  try{
    await writeFile(join(root,'value.mjs'),`var value='ok';export {value as '*'};`);
    await writeFile(join(root,'forward.mjs'),`export * from './value.mjs';`);
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`import {'*' as value} from './forward.mjs';export const result=value;`);
    const native=(await import(pathToFileURL(entry).href)).result;
    const bundle=await bundleProgram(entry),module:{exports:Record<string,unknown>}={exports:{}};
    const capabilities=programCapabilities(()=>{},()=>{throw Error('Unavailable host capability');});
    capabilities.globals();
    Function('module','exports','__bearOps',bundle.code)(module,module.exports,capabilities.operations);
    assert.equal(module.exports.result,native);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('quoted star reexport and namespace alias remain distinct',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-star-reexports-'));
  try{
    await writeFile(join(root,'value.mjs'),`export const value='ok';export {value as '*'};`);
    await writeFile(join(root,'forward.mjs'),`export {'*' as '*value'} from './value.mjs';export * as '*' from './value.mjs';`);
    const entry=join(root,'entry.mjs');
    await writeFile(entry,`import {'*' as namespace,'*value' as value} from './forward.mjs';
      export const result=[namespace.value,namespace['*'],value,Object.getOwnPropertyNames(namespace)];`);
    const native=(await import(pathToFileURL(entry).href)).result;
    const bundle=await bundleProgram(entry),module:{exports:Record<string,unknown>}={exports:{}};
    const capabilities=programCapabilities(()=>{},()=>{throw Error('Unavailable host capability');});
    capabilities.globals();
    Function('module','exports','__bearOps',bundle.code)(module,module.exports,capabilities.operations);
    assert.deepEqual(module.exports.result,native);
  }finally{await rm(root,{recursive:true,force:true});}
});
