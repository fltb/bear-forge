import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { callback } from '../src/index.ts';
test('handler pause/error/invalid reply remain distinct', async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await callback(async () => ({
    kind: 'pause'
  }), signal), {
    pause: 'requested'
  });
  assert.deepEqual(await callback(async () => {
    throw Error('failed');
  }, signal), {
    pause: 'handler_failed'
  });
  assert.deepEqual(await callback(async () => ({
    kind: 'reply',
    value: () => 0
  }), signal), {
    pause: 'invalid_reply'
  });
});
