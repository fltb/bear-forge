import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileNativeEntry} from '@bear-forge/compiler';
import {nativeProgram} from '../src/index.ts';
import {program, modes, forbiddenPromiseProgram} from './thenable-fixture.ts';

test('native production compilation preserves thenable assimilation across every Promise entry', async t => {
  const artifact = await compileNativeEntry(new URL('./thenable-fixture.ts', import.meta.url).pathname);
  for (const mode of modes) await t.test(mode, async () => {
    const expected = await program.run(mode);
    assert.equal(expected.value, 7);
    const actual = await (await nativeProgram(artifact)).run(mode, {} as never);
    assert.deepEqual(actual, expected);
  });
});

test('native callback ingress retains arrow/rest/default parameters, values and microtask order',async t=>{
  const {ingressProgram,ingressModes}=await import('./thenable-fixture.ts');
  const artifact=await compileNativeEntry(new URL('./thenable-fixture.ts',import.meta.url).pathname,'ingressProgram');
  for(const mode of ingressModes)await t.test(mode,async()=>{
    const expected=await ingressProgram.run(mode);
    const actual=await (await nativeProgram(artifact)).run(mode,{} as never);
    assert.deepEqual(actual,expected);
  });
});

test('native await and async return retain V8 thenable behavior without an IO-only guarantee',async t=>{
  const artifact=await compileNativeEntry(new URL('./thenable-fixture.ts',import.meta.url).pathname,'forbiddenPromiseProgram');
  const compiled=await nativeProgram(artifact);
  for(const mode of ['await','async-return'] as const)await t.test(mode,async()=>{
    const expected=await forbiddenPromiseProgram.run(mode);
    const actual=await compiled.run(mode,{} as never);
    assert.match(expected,/SyntaxError/);
    assert.equal(actual,expected);
  });
});
