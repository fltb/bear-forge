import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';
test('persistent array iterators and bound closures survive suspension without host prototype patches', () => {
  const artifact = decode(compileJavaScript(`module.exports.program={schemas:{},async run(n,io){
    let total=n;function add(value){total+=value;return total;}
    const bound=add.bind(null,2);const iter=[3,4].values();
    for(const value of [1,2])total+=value+await io.call({port:'step',input:bound()});
    return [total,iter.next().value,iter.next().value,bound()];
  }};`).content);
  const normal = new ProgramExecution(artifact);
  let restored = new ProgramExecution(artifact);
  normal.start(0);
  restored.start(0);
  for (const reply of [5, 6]) {
    const snapshot = restored.snapshot();
    restored = new ProgramExecution(artifact);
    restored.restore(snapshot);
    assert.deepEqual(restored.io.callData, normal.io.callData);
    normal.resume(reply);
    restored.resume(reply);
  }
  assert.equal(normal.result.status, 1);
  assert.equal(restored.result.status, 1);
  assert.deepEqual(normal.result.value, [14, 3, 4, 16]);
  assert.deepEqual(restored.result.value, normal.result.value);
});
test('yield delegation retains the array iterator across a saved outer await', () => {
  const artifact = decode(compileJavaScript(`module.exports.program={schemas:{},async run(n,io){
    function* values(){yield* [2,3];}const iterator=values();const first=iterator.next().value;
    const reply=await io.call({port:'step',input:first});return [first,iterator.next().value,iterator.next().done,reply];
  }};`).content);
  const original = new ProgramExecution(artifact);
  original.start(0);
  const restored = new ProgramExecution(artifact);
  restored.restore(original.snapshot());
  original.resume(7);
  restored.resume(7);
  assert.equal(restored.result.status, 1);
  assert.deepEqual(original.result.value, [2, 3, true, 7]);
  assert.deepEqual(restored.result.value, original.result.value);
});
