import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileNativeEntry } from '@bear-forge/compiler';
import { createNativeLoader, nativeProgram } from '../src/index.ts';
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};
test('native approved bundle retains V8 async execution and isolates mutable module state per instance', async () => {
  const artifact = await compileNativeEntry(new URL('./module-fixture.ts', import.meta.url).pathname);
  assert.ok(!artifact.code.includes('effects.fun'));
  const program = nativeProgram<number, {}, number>(artifact),
    loaded = unwrap(await createNativeLoader().load(program));
  const a = unwrap(await loaded.core.start(3)),
    b = unwrap(await loaded.core.start(5)),
    c = unwrap(await loaded.core.start(3));
  assert.deepEqual(unwrap(await a.inspect()), {
    kind: 'done',
    result: 3
  });
  assert.deepEqual(unwrap(await b.inspect()), {
    kind: 'done',
    result: 5
  });
  assert.deepEqual(unwrap(await c.inspect()), {
    kind: 'done',
    result: 3
  });
  await a.close();
  await b.close();
  await c.close();
});
test('native computation budget stays faulted even when the author catches its exception', async () => {
  const artifact = await compileNativeEntry(new URL('./budget-fixture.ts', import.meta.url).pathname);
  const loaded = unwrap(await createNativeLoader().load(nativeProgram(artifact, {
    stepBudget: 100000
  })));
  const instance = unwrap(await loaded.core.start(null));
  const stop = unwrap(await instance.inspect());
  assert.equal(stop.kind, 'fault');
  assert.equal(stop.error.code, 'budget_exceeded');
  await instance.close();
});
test('budget exhausted inside result schema remains budget_exceeded rather than invalid_output', async () => {
  const artifact = await compileNativeEntry(new URL('./schema-budget.ts', import.meta.url).pathname);
  const loaded = unwrap(await createNativeLoader().load(nativeProgram(artifact, {
    stepBudget: 100000
  })));
  const instance = unwrap(await loaded.core.start(null));
  const stop = unwrap(await instance.inspect());
  assert.equal(stop.kind, 'fault');
  assert.equal(stop.error.code, 'budget_exceeded');
  await instance.close();
});

test('computed entropy access cannot be caught into native success',async()=>{const artifact=await compileNativeEntry(new URL('./entropy.ts',import.meta.url).pathname);const loaded=unwrap(await createNativeLoader().load(nativeProgram(artifact)));const instance=unwrap(await loaded.core.start(null));const stop=unwrap(await instance.inspect());assert.equal(stop.kind,'fault');assert.equal(stop.error.code,'program_failed');await instance.close();});
