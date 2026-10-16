import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('unavailable optional intrinsics do not prevent execution, branching or restoration',()=>{
  const compiler=new URL('../../compiler/src/compile.ts',import.meta.url).href;
  const execution=new URL('../src/execution.ts',import.meta.url).href;
  const runtime=new URL('../../runtime/src/program-code.ts',import.meta.url).href;
  const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    // Use a fresh process so this capability absence cannot alter other tests.
    delete globalThis.SuppressedError;
    const {programCapabilities}=await import(${JSON.stringify(runtime)});
    assert.equal(Object.hasOwn(programCapabilities(()=>{},()=>{throw Error();}).globals(),'SuppressedError'),false);
    const {compileJavaScript}=await import(${JSON.stringify(compiler)});
    const {ProgramExecution,decode}=await import(${JSON.stringify(execution)});
    const source='export const program={schemas:{},async run(_,io){const state={value:1};state.value+=await io.call({port:"step",input:null});return state.value;}};';
    const parent=new ProgramExecution(decode(compileJavaScript(source).content));
    const owned=[parent];
    try{
      parent.start(null);assert.equal(parent.result.status,0);
      const fork=parent.fork(),restored=parent.fresh();owned.push(fork,restored);restored.restore(parent.snapshot());
      for(const [index,instance]of owned.entries()){
        instance.resume(index+2);assert.equal(instance.result.status,1);assert.equal(instance.result.value,index+3);
      }
    }finally{for(const instance of owned)instance.dispose();}
  `],{encoding:'utf8',timeout:30000});
  assert.ifError(child.error);
  assert.equal(child.status,0,child.stderr+child.stdout);
});
