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
  const artifact = decode(compileJavaScript(`module.exports.program={schemas:{},run:${benchmark.toString()}};`).content);
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
  for (let i = 0; i < 4; i++) {
    const nativeStart = performance.now();
    assert.equal(await benchmark(10000, {
      call: async () => 7
    }), expected);
    (measurements.nativeCompute ??= []).push(performance.now() - nativeStart);
    const instance = measure('create', () => new ProgramExecution(artifact, 10000000));
    measure('startToWait', () => instance.start(10000));
    const snapshot = measure('saveInMemory', () => instance.snapshot());
    const restored = measure('restore', () => {
      const next = new ProgramExecution(artifact, 10000000);
      next.restore(snapshot);
      return next;
    });
    const branch = measure('forkInMemory', () => {
      const next = new ProgramExecution(artifact, 10000000);
      next.restore(instance.snapshot());
      return next;
    });
    measure('controlledCompute', () => instance.resume(7));
    restored.resume(7);
    branch.resume(8);
    assert.equal(instance.result.value, expected);
    assert.equal(restored.result.value, expected);
    assert.equal(branch.result.value, await benchmark(10000, {
      call: async () => 8
    }));
    assert.equal(instance.program.run instanceof Function, true);
  }
  t.diagnostic('Engine-only 10,000 integer iterations; no Zod, protocol validation or disk IO; milliseconds, first sample cold: ' + JSON.stringify(measurements));
});
