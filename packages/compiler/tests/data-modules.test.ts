import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bundleProgram} from '../src/bundle.ts';
import {AuthorAdmissionError} from '../src/admission.ts';
import {isNativeModuleLinkError} from '../src/module-link.ts';

test('import attributes reject unknown keys/types and cannot reinterpret data as executable code',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-data-policy-'));
  try{
    await writeFile(join(root,'data.json'),'{}');
    for(const attributes of ["type:'text'","type:'bytes'","type:'unknown'","type:'json',extra:'ignored'","extra:'ignored'"]){
      await writeFile(join(root,'entry.mjs'),`import value from './data.json' with {${attributes}};export {value};`);
      await assert.rejects(bundleProgram(join(root,'entry.mjs')),AuthorAdmissionError);
    }
    await writeFile(join(root,'code.js'),'{}');
    await writeFile(join(root,'entry.mjs'),`import value from './code.js' with {type:'json'};export {value};`);
    await assert.rejects(bundleProgram(join(root,'entry.mjs')),AuthorAdmissionError);
    await writeFile(join(root,'entry.mjs'),`import value from './code.js' with {type:'json',extra:'ignored'};export {value};`);
    await assert.rejects(bundleProgram(join(root,'entry.mjs')),AuthorAdmissionError);
    await writeFile(join(root,'entry.mjs'),`import value from './code.js' with {type:'text'};export {value};`);
    await assert.rejects(bundleProgram(join(root,'entry.mjs')),AuthorAdmissionError);
    await writeFile(join(root,'data.json'),'process.env');
    await writeFile(join(root,'entry.mjs'),`import value from './data.json' with {type:'json'};export {value};`);
    await assert.rejects(bundleProgram(join(root,'entry.mjs')),SyntaxError);
    await writeFile(join(root,'data.json'),'{"field":1}');
    await writeFile(join(root,'entry.mjs'),`import data from './data.json';export {data};`);
    await assert.rejects(bundleProgram(join(root,'entry.mjs')),/JSON imports require type: json/);
    await writeFile(join(root,'entry.mjs'),`import {field} from './data.json' with {type:'json'};export {field};`);
    await assert.rejects(bundleProgram(join(root,'entry.mjs')),error=>
      isNativeModuleLinkError(error)&&error instanceof SyntaxError);
    await writeFile(join(root,'entry.mjs'),`export {default} from 'node:fs' with {type:'text'};`);
    await assert.rejects(bundleProgram(join(root,'entry.mjs')),AuthorAdmissionError);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('ordinary ESM attributes follow the target Node loader before bare V8 linking',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-module-attributes-'));
  try{
    await writeFile(join(root,'dep.mjs'),'export const answer=42;');
    const entry=join(root,'entry.mjs');
    await writeFile(entry,"import {answer} from './dep.mjs' with {};export {answer};");
    await bundleProgram(entry);
    await writeFile(entry,"import {answer} from './dep.mjs' with {if:''};export {answer};");
    await assert.rejects(import(pathToFileURL(entry).href),error=>(error as NodeJS.ErrnoException).code==='ERR_IMPORT_ATTRIBUTE_UNSUPPORTED');
    await assert.rejects(bundleProgram(entry),AuthorAdmissionError);
    await writeFile(entry,"import {missing} from './dep.mjs' with {if:''};export {missing};");
    await assert.rejects(import(pathToFileURL(entry).href+'?missing'),error=>(error as NodeJS.ErrnoException).code==='ERR_IMPORT_ATTRIBUTE_UNSUPPORTED');
    await assert.rejects(bundleProgram(entry),AuthorAdmissionError);
  }finally{await rm(root,{recursive:true,force:true});}
});
