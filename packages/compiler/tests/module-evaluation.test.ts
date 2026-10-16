import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evaluateModuleGraph,type EvaluationModule} from '../src/module-evaluation.ts';

test('module evaluator matches native ESM for all three-node directed graphs without self edges and all async-body assignments',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bear-evaluation-graphs-'));
  try{
    for(let edges=0;edges<64;edges++)for(let awaits=0;awaits<8;awaits++){
      const root=join(directory,`${edges}-${awaits}`);await mkdir(root);
      await writeFile(join(root,'state.mjs'),'export const trace=[];');
      const trace:string[]=[],definitions:EvaluationModule[]=[];
      let bit=0;
      for(let id=0;id<3;id++){
        const dependencies:number[]=[];
        for(let dependency=0;dependency<3;dependency++)if(dependency!==id){
          if(edges&(1<<bit))dependencies.push(dependency);bit++;
        }
        const async=Boolean(awaits&(1<<id));
        const body=`trace.push('${id}:start');`+
          (async?`Promise.resolve().then(()=>trace.push('${id}:job'));await 0;`:'')+
          `trace.push('${id}:end');`;
        await writeFile(join(root,`${id}.mjs`),
          'import {trace} from "./state.mjs";'+dependencies.map(dependency=>`import './${dependency}.mjs';`).join('')+body);
        const execute=Function('trace',`return ${async?'async ':''}function(){${body}}`)(trace);
        definitions.push(async?{dependencies,async:true,execute}:{dependencies,async:false,execute});
      }
      await import(pathToFileURL(join(root,'0.mjs')).href);
      const native=await import(pathToFileURL(join(root,'state.mjs')).href);
      await evaluateModuleGraph(definitions,0);
      assert.deepEqual(trace,native.trace,`edges=${edges},awaits=${awaits}`);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('module evaluator retains falsy rejection values and suppresses dependent execution',async()=>{
  for(const value of [undefined,null,false,0,'',17])for(const async of [false,true]){
    const trace:string[]=[];
    const execute=async?async()=>{await 0;throw value;}:()=>{throw value;};
    const modules:EvaluationModule[]=[
      {dependencies:[1],async:false,execute(){trace.push('wrong');}},
      async?{dependencies:[],async:true,execute:execute as ()=>Promise<void>}:
        {dependencies:[],async:false,execute}
    ];
    let rejected=false;
    try{await evaluateModuleGraph(modules,0);}catch(error){rejected=true;assert.strictEqual(error,value);}
    assert.equal(rejected,true);assert.deepEqual(trace,[]);
  }
});

test('an asynchronous cycle is awaited through its root by a later sibling',async()=>{
  const trace:string[]=[];
  const modules:EvaluationModule[]=[
    {dependencies:[1,3],async:false,execute(){trace.push('entry');}},
    {dependencies:[2],async:true,async execute(){trace.push('a:start');await 0;trace.push('a:end');}},
    {dependencies:[1],async:false,execute(){trace.push('b');}},
    {dependencies:[2],async:false,execute(){trace.push('sibling');}}
  ];
  await evaluateModuleGraph(modules,0);
  assert.deepEqual(trace,['b','a:start','a:end','sibling','entry']);
});

test('a started async sibling can finish after synchronous graph failure without reviving its parent',async()=>{
  const trace:string[]=[];let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let running!:Promise<void>;
  const modules:EvaluationModule[]=[
    {dependencies:[1,2],async:false,execute(){trace.push('wrong');}},
    {dependencies:[],async:true,execute(){
      running=(async()=>{trace.push('started');await gate;trace.push('finished');})();
      return running;
    }},
    {dependencies:[],async:false,execute(){throw 0;}}
  ];
  const evaluation=evaluateModuleGraph(modules,0);
  let rejected=false;
  try{await evaluation;}catch(error){rejected=true;assert.strictEqual(error,0);}
  assert.equal(rejected,true);assert.deepEqual(trace,['started']);
  release();await running;
  // Surface a stray rejection from completion dispatch to the test runner.
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(trace,['started','finished']);
});


test('synchronous module evaluation completes directly and preserves falsy errors',()=>{
  const trace:number[]=[];
  const result=evaluateModuleGraph([{dependencies:[1],async:false,execute(){trace.push(0);}},{dependencies:[],async:false,execute(){trace.push(1);}}],0,true);
  assert.equal(result,undefined);assert.deepEqual(trace,[1,0]);
  for(const value of [undefined,null,false,0,'']){
    let caught=false;
    try{evaluateModuleGraph([{dependencies:[],async:false,execute(){throw value;}}],0,true);}
    catch(error){caught=true;assert.strictEqual(error,value);}
    assert.equal(caught,true);
  }
});
