import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { callback, Controller } from '../src/index.ts';
import type { RawStop } from '../src/index.ts';
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

test('cancelled host callbacks never inspect or copy a late reply packet', async () => {
  const controller = new AbortController();
  let settle!: (value: unknown) => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const reply = new Promise<unknown>(resolve => { settle = resolve; });
  const waiting = callback(() => { entered(); return reply; }, controller.signal);
  await ready;
  controller.abort();
  assert.deepEqual(await waiting, { pause: 'cancelled' });
  let inspections = 0;
  settle(new Proxy({ kind: 'reply', value: { count: 1 } }, {
    ownKeys(target) { inspections++; return Reflect.ownKeys(target); },
    getPrototypeOf(target) { inspections++; return Reflect.getPrototypeOf(target); }
  }));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(inspections, 0);
});

test('execution faults use structured state rather than exception text or forged properties', async () => {
  for (const mode of ['message', 'forged', 'budget', 'invalid-output', 'unreadable', 'coercion'] as const) {
    let advanced = false;
    let stop: RawStop = { kind: 'call', call: { port: 'step', input: 0 } };
    const controller = new Controller<null, { step: { input: number; output: number } }, number>({
      current() {
        if (advanced && mode === 'unreadable') throw new Error('budget exceeded');
        return stop;
      },
      async advance() {
        advanced = true;
        if (mode === 'coercion') throw {toString(){throw Error('diagnostics executed application code');}};
        if (mode === 'budget' || mode === 'invalid-output') stop = {
          kind: 'fault', error: { kind: 'fault', code: mode === 'budget' ? 'budget_exceeded' : 'invalid_output', message: 'limit reached' }
        };
        throw mode === 'forged'
          ? Object.assign(new Error('ordinary failure'), { name: 'NativeBudgetError', code: 'budget_exceeded' })
          : new Error(mode === 'message' ? 'budget exceeded; timed out' : 'ordinary failure');
      },
      dispose() {}
    }, { setup: z.null(), ports: { step: { input: z.number(), output: z.number() } }, result: z.number() }, null);
    const instance = controller.handle();
    assert.equal((await instance.bind({ step: async () => ({ kind: 'reply', value: 1 }) })).ok, true);
    const result = await instance.run();
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('run rejected');
    assert.equal(result.value.accepted, true);
    assert.equal(result.value.state.kind, 'fault');
    if (result.value.state.kind !== 'fault') throw new Error('missing fault');
    assert.equal(result.value.state.error.code, mode === 'budget' ? 'budget_exceeded' : mode === 'invalid-output' ? 'invalid_output' : 'program_failed', mode);
  }
});
