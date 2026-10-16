import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Test262Case} from './test262-cases.ts';
import {excludedAuthorFeatures} from './test262-scope.ts';

test('scope classification follows original module dependencies and lexical bindings',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bear-test262-scope-'));
  try{
    await mkdir(join(root,'test'));
    const source='import "./dependency.js"; export {}';
    await writeFile(join(root,'test/main.js'),source);
    const candidate:Test262Case={file:'test/main.js',mode:'module',source,harness:[],flags:['module'],features:[],asynchronous:false,negative:null};
    await writeFile(join(root,'test/dependency.js'),'new Function("return 1")');
    assert.deepEqual([...await excludedAuthorFeatures(root,candidate)],['dynamic-code']);
    await writeFile(join(root,'test/dependency.js'),'const Function=x=>x; Function(1); const evalValue="eval(1)";');
    assert.deepEqual([...await excludedAuthorFeatures(root,candidate)],[]);
    await writeFile(join(root,'test/dependency.js'),'import source value from "<module source>";');
    assert.deepEqual([...await excludedAuthorFeatures(root,candidate)],['module-phase']);
    await writeFile(join(root,'test/dependency.js'),'import("./later.js");');
    assert.deepEqual([...await excludedAuthorFeatures(root,candidate)],['dynamic-import']);
  }finally{await rm(root,{recursive:true,force:true});}
});
