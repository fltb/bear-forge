import { z } from 'zod';
import { createResolution, invoke, operation, request, repeat, branch, forEach } from '../../src/index.ts';
import type { EffectDefinition } from '../../src/index.ts';
import type { IO } from '@bear-forge/contracts/core';
type State = { sum: number; starts: number; rounds: number; items: number[]; seen: number[] };
type Ports = { choose: { input: { sum: number; starts: number; frames: string[] }; output: number } };
type Effect<A, R> = EffectDefinition<State, Ports, A, R>;
const add: Effect<number, number> = { id: 'add', async run(c, amount) {
  return operation(c, (s, n) => s.sum += n, amount);
} };
const fail: Effect<number, number> = { id: 'fail', async run() { throw Error('negative reply'); } };
const choose: Effect<number, number> = { id: 'choose', async run(c, scale) {
  operation(c, s => ++s.starts, undefined);
  const reply = await request(c, { port: 'choose', input: {
    sum: c.state.sum, starts: c.state.starts, frames: c.frames.map(f => f.definition),
  } });
  return await branch(c, (_, n) => n >= 0, add, fail, reply * scale);
} };
const round: Effect<number, void> = { id: 'round', async run(c, scale) {
  const before = c.state.sum;
  const result = await invoke(c, choose, scale, 'card:test');
  // A local value and child result must survive the child's input boundary.
  c.state.seen.push(result - before);
  c.state.rounds++;
} };
const visit: Effect<number, void> = { id: 'visit', async run(c, item) {
  c.state.seen.push(item);
  c.state.items.push(99);
} };
const spin: Effect<number, void> = { id: 'spin', async run(c) { c.state.starts++; } };
const automatic: Effect<undefined, void> = { id: 'automatic', async run() {} };
export const root: Effect<number, State> = { id: 'root', async run(c, scale) {
  if (scale === 99) {
    const first = invoke(c, automatic, undefined);
    const waiting = invoke(c, choose, 1);
    await first;
    if (c.frames.some(frame => frame.definition === 'automatic')) throw Error('completed sibling retained');
    await waiting;
    return c.state;
  }
  if (scale === 0) await repeat(c, () => true, spin, scale);
  await repeat(c, s => s.rounds < 2, round, scale);
  await forEach(c, c.state.items, visit);
  return c.state;
} };
export const program = {
  schemas: {
    setup: z.number(),
    result: z.object({ sum: z.number(), starts: z.number(), rounds: z.number(), items: z.array(z.number()), seen: z.array(z.number()) }),
    ports: { choose: { input: z.object({ sum: z.number(), starts: z.number(), frames: z.array(z.string()) }), output: z.number() } },
  },
  async run(scale: number, io: IO<Ports>) {
    const context = createResolution<State, Ports>({ sum: 0, starts: 0, rounds: 0, items: [7, 8], seen: [] }, io);
    const result = await invoke(context, root, scale);
    if (context.frames.length) throw Error('completed frames retained');
    return result;
  },
};
