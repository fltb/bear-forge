import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';
async function benchmark(size: number, io: any) {
  let value = await io.call({
    port: 'step',
    input: size
  });
  for (let i = 0; i < size; i++) value = Math.imul(value, 1664525) + 1013904223 >>> 0;
  return value;
}
test('main-runtime engine benchmark measures creation, compute, snapshot, restore and branch independently', async t => {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${benchmark.toString()}};`).content);
  const measurements: Record<string, number[]> = {};
  function measure<T>(name: string, action: () => T): T {
    const before = performance.now();
    const result = action();
    (measurements[name] ??= []).push(performance.now() - before);
    return result;
  }
  const expected = await benchmark(10000, {
    call: async () => 7
  });
  const program = measure('load', () => new ProgramExecution(artifact, 10000000));
  for (let i = 0; i < 4; i++) {
    const nativeStart = performance.now();
    assert.equal(await benchmark(10000, {
      call: async () => 7
    }), expected);
    (measurements.nativeCompute ??= []).push(performance.now() - nativeStart);
    const instance = measure('create', () => program.fresh(10000000));
    measure('startToWait', () => instance.start(10000));
    const snapshot = measure('saveInMemory', () => instance.snapshot());
    const restored = measure('restore', () => {
      const next = program.fresh(10000000);
      next.restore(snapshot);
      return next;
    });
    const branch = measure('forkInMemory', () => instance.fork());
    measure('controlledCompute', () => instance.resume(7));
    restored.resume(7);
    branch.resume(8);
    assert.equal(instance.result.value, expected);
    assert.equal(restored.result.value, expected);
    assert.equal(branch.result.value, await benchmark(10000, {
      call: async () => 8
    }));
    assert.equal(typeof (instance as any).context.bindings.run, 'function');
  }
  t.diagnostic('Engine-only 10,000 integer iterations; no Zod, protocol validation or disk IO; milliseconds; load is cold, subsequent handles share code: ' + JSON.stringify(measurements));
});

test('COW fork and first advance are measured separately across retained heap sizes',t=>{
  const code=decode(compileJavaScript(`export const program={schemas:{},async run(size,io){
    const values=Array.from({length:size},(_,index)=>({value:index}));
    const reply=await io.call({port:'step',input:size});
    values[0].value=reply;
    return [values[0].value,values[size-1].value];
  }};`).content);
  const measurements=[];
  for(const size of [32,4096,32768]){
    const parent=new ProgramExecution(code,10_000_000);parent.start(size);
    assert.equal(parent.result.status,0,parent.message(parent.result.value));
    const forkMs:number[]=[],advanceMs:number[]=[];
    for(let sample=0;sample<11;sample++){
      const begin=performance.now(),branch=parent.fork(),forked=performance.now();
      branch.resume(-sample-1);const advanced=performance.now();
      assert.equal(branch.result.status,1,branch.message(branch.result.value));
      assert.deepEqual(branch.result.value,[-sample-1,size-1]);
      assert.equal(parent.io.callData.input,size);
      if(sample>=3){forkMs.push(forked-begin);advanceMs.push(advanced-forked);}
      branch.dispose();
    }
    parent.resume(42);assert.deepEqual(parent.result.value,[42,size-1]);parent.dispose();
    const median=(values:number[])=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
    measurements.push({retainedObjects:size,forkMedianMs:median(forkMs),firstAdvanceMedianMs:median(advanceMs)});
  }
  t.diagnostic('Same Program and constant work after IO; 3 warmups and 8 samples per size; no timing pass threshold: '+JSON.stringify(measurements));
});
