import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateModuleGraph,type EvaluationModule} from '../../compiler/src/module-evaluation.ts';
import {compileJavaScript} from '@bear-forge/compiler';
import {ProgramExecution,decode} from '../src/execution.ts';

test('module evaluator executes inside controlled Context and leaves independent recoverable game state',async()=>{
  // Emitting this compiler-owned helper exercises the real conversion, Future
  // jobs and closure capture. Full source-module linking is a separate gate.
  const artifact=decode(compileJavaScript(`
    const evaluate=${evaluateModuleGraph.toString()};
    export const program={schemas:{},async run(setup,io){
      const trace=[];let bit=0;
      const definitions=[0,1,2].map(id=>{
        const dependencies=[];
        for(let dependency=0;dependency<3;dependency++)if(dependency!==id){
          if(setup.edges&(1<<bit))dependencies.push(dependency);bit++;
        }
        const asynchronous=Boolean(setup.awaits&(1<<id));
        return {dependencies,async:asynchronous,execute:asynchronous?async()=>{
          trace.push(id+':start');Promise.resolve().then(()=>trace.push(id+':job'));
          await 0;trace.push(id+':end');
        }:()=>{trace.push(id+':start');trace.push(id+':end');}};
      });
      await evaluate(definitions,0);
      trace.push(await io.call({port:'step',input:trace}));
      return trace;
    }};
  `).content);
  assert.deepEqual(artifact.namespaceKeys,[]);
  for(let edges=0;edges<64;edges++)for(let awaits=0;awaits<8;awaits++){
    const expected:(string|number)[]=[],definitions:EvaluationModule[]=[];let bit=0;
    for(let id=0;id<3;id++){
      const dependencies:number[]=[];
      for(let dependency=0;dependency<3;dependency++)if(dependency!==id){
        if(edges&(1<<bit))dependencies.push(dependency);bit++;
      }
      definitions.push(awaits&(1<<id)?{dependencies,async:true,async execute(){
        expected.push(id+':start');Promise.resolve().then(()=>expected.push(id+':job'));
        await 0;expected.push(id+':end');
      }}:{dependencies,async:false,execute(){expected.push(id+':start');expected.push(id+':end');}});
    }
    await evaluateModuleGraph(definitions,0);
    const parent=new ProgramExecution(artifact);
    try{
      parent.start({edges,awaits});
      assert.equal(parent.result.status,0,`edges=${edges},awaits=${awaits}`);
      assert.deepEqual(parent.io.callData,{port:'step',input:expected});
      if(edges===0||edges===63){
        const initialized=parent.loaded.statistics.initializations;
        const fork=parent.fork(),restored=parent.fresh();
        try{
          restored.restore(parent.snapshot());
          for(const [instance,reply]of [[fork,2],[restored,3]] as const){
            instance.resume(reply);
            assert.equal(instance.result.status,1);
            assert.deepEqual(instance.result.value,[...expected,reply]);
            assert.strictEqual(instance.loaded,parent.loaded);
          }
          assert.equal(parent.loaded.statistics.initializations,initialized);
        }finally{fork.dispose();restored.dispose();}
      }
      parent.resume(1);assert.equal(parent.result.status,1);
      assert.deepEqual(parent.result.value,[...expected,1]);
    }finally{parent.dispose();}
  }
});
