import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from '../src/index.ts';

test('bootstrap intervals are reproducible and retain constant samples', () => {
  assert.deepEqual(bootstrap([1, 1], 5, 2000, 0.025), [1, 1]);
  const interval = bootstrap([0, 1], 7, 1000, 0.025);
  assert.deepEqual(interval, bootstrap([0, 1], 7, 1000, 0.025));
  assert.ok(interval[0] >= 0 && interval[0] <= interval[1] && interval[1] <= 1);
  assert.throws(() => bootstrap([], 7, 1000, 0.025), /Empty bootstrap/);
});
