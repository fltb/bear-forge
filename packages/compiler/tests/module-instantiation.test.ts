import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bundleProgram} from '../src/bundle.ts';
import {programCapabilities} from '../../runtime/src/program-code.ts';

test('production module framing preserves native graph evaluation and microtask order',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-linked-graphs-'));
  try{
    for(let edges=0;edges<64;edges++)for(let awaits=0;awaits<8;awaits++){
      const root=join(directory,`${edges}-${awaits}`);await mkdir(root);
      await writeFile(join(root,'state.mjs'),'export const trace=[];');
      let bit=0;
      for(let id=0;id<3;id++){
        let source='import {trace} from "./state.mjs";';
        for(let dependency=0;dependency<3;dependency++)if(dependency!==id){
          if(edges&(1<<bit))source+=`import './${dependency}.mjs';`;bit++;
        }
        source+=`trace.push('${id}:start');`;
        if(awaits&(1<<id))source+=`Promise.resolve().then(()=>trace.push('${id}:job'));await 0;`;
        source+=`trace.push('${id}:end');export {trace};`;
        await writeFile(join(root,`${id}.mjs`),source);
      }
      const entry=join(root,'0.mjs'),native=await import(pathToFileURL(entry).href);
      const bundle=await bundleProgram(entry);
      const module={exports:{} as {trace:string[]}};
      await Function('module','exports','__bearOps',`return (async()=>{${bundle.code}\n})();`)(module,module.exports,operations());
      assert.deepEqual(module.exports.trace,native.trace,`edges=${edges},awaits=${awaits}`);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

// Link-only execution still supplies the real, isolated capability environment.
function operations(){
  const capabilities=programCapabilities(()=>{},()=>{throw Error('Unavailable host capability');});
  capabilities.globals();
  return capabilities.operations;
}
