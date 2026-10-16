import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Records } from '../src/records.ts';

test('record forks share immutable prefixes and append independent suffixes across chunk boundaries', () => {
  const parent = new Records<number>();
  for (let i = 0; i < 150; i++) parent.push(i);
  const child = parent.fork();
  assert.strictEqual((parent as any).tail, (child as any).tail);
  parent.push(150); child.push(900);
  for (let i = 0; i < 80; i++) child.push(1000 + i);
  assert.deepEqual(parent.slice(145), [145,146,147,148,149,150]);
  assert.deepEqual(child.slice(145,152), [145,146,147,148,149,900,1000]);
  assert.deepEqual(parent.slice(62,67), [62,63,64,65,66]);
  assert.deepEqual(child.slice(0,150), Array.from({ length: 150 }, (_, i) => i));
});
