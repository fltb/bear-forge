import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolution, invoke, sequence, request } from '../src/index.ts';
import type { EffectDefinition } from '../src/index.ts';
import { program } from './fixtures/nested.ts';

test('one definition serves independent instances with nested results and captured iteration', async () => {
  const run = async (scale: number) => {
    const calls: unknown[] = [];
    const result = await program.run(scale, { async call(call) { calls.push(structuredClone(call)); return calls.length; } });
    assert.deepEqual(calls, [
      { port: 'choose', input: { sum: 0, starts: 1, frames: ['root', 'round', 'choose'] } },
      { port: 'choose', input: { sum: scale, starts: 2, frames: ['root', 'round', 'choose'] } },
    ]);
    assert.deepEqual(result, { sum: 3 * scale, starts: 2, rounds: 2, items: [7, 8, 99, 99], seen: [scale, 2 * scale, 7, 8] });
  };
  await Promise.all([run(2), run(5)]);
});

test('sequence waits for IO, preserves single-candidate requests and propagates faults without rollback', async () => {
  type Ports = { choose: { input: number[]; output: number } };
  type State = { log: string[] };
  type Effect = EffectDefinition<State, Ports, undefined, void>;
  let answer: ((value: number) => void) | undefined;
  const context = createResolution<State, Ports>({ log: [] }, {
    async call(call) { assert.deepEqual(call.input, [42]); return await new Promise<number>(resolve => { answer = resolve; }); },
  });
  const first: Effect = { id: 'first', async run(c) { c.state.log.push('before'); await request(c, { port: 'choose', input: [42] }); c.state.log.push('after'); } };
  const failure = new Error('rule failed');
  const second: Effect = { id: 'second', async run(c) { c.state.log.push('failed'); throw failure; } };
  const third: Effect = { id: 'third', async run(c) { c.state.log.push('unreachable'); } };
  const root: Effect = { id: 'root', async run(c) { await sequence(c, [first, second, third], undefined); } };
  const pending = invoke(context, root, undefined);
  const rejected = assert.rejects(pending, error => error === failure);
  assert.deepEqual(context.state.log, ['before']);
  assert.deepEqual(context.frames.map(f => f.definition), ['root', 'first']);
  assert.ok(answer);
  answer(42);
  await rejected;
  assert.deepEqual(context.state.log, ['before', 'after', 'failed']);
  assert.deepEqual(context.frames, []);
});

test('an automatic sibling completing out of order cannot remove a waiting effect frame', async () => {
  type Ports = { choose: { input: null; output: number } };
  type Effect = EffectDefinition<null, Ports, undefined, number>;
  let answer: ((value: number) => void) | undefined;
  const context = createResolution<null, Ports>(null, {
    async call() { return await new Promise<number>(resolve => { answer = resolve; }); },
  });
  const automatic: Effect = { id: 'automatic', async run() { return 7; } };
  const waiting: Effect = { id: 'waiting', async run(c) { return await request(c, { port: 'choose', input: null }); } };
  const first = invoke(context, automatic, undefined);
  const second = invoke(context, waiting, undefined);
  assert.equal(await first, 7);
  assert.deepEqual(context.frames.map(f => f.definition), ['waiting']);
  assert.ok(answer); answer(9);
  assert.equal(await second, 9);
  assert.deepEqual(context.frames, []);
});
