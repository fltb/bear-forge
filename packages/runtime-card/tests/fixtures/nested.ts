import {z} from 'zod';
import {card as c} from '@bear-forge/card-engine';
import type {CardDefinition} from '@bear-forge/card-engine';
type World = { sum: number; rounds: number; items: { n: number }[]; seen: number[] };
type Ports = { choose: { input: number; output: number } };
export const definition: CardDefinition<World, number, Ports, World> = {
  id: 'test/nested-1', schemas: { setup: z.number(), result: z.any(), ports: { choose: { input: z.number(), output: z.number() } } },
  initialize: n => ({ sum: n, rounds: 0, items: [{ n: 3 }, { n: 5 }], seen: [] }), entry: 'root', effects: [
    { id: 'root', steps: [c.repeat<World>(s => s.state.rounds < 2, [c.invoke<World>('child', s => s.state.items[0], 'answer'), c.operation<World>(s => { s.state.sum += s.locals.answer; s.state.rounds++; })]), c.forEach<World>(s => s.state.items, 'item'), c.return<World>(s => s.state)] },
    { id: 'child', steps: [c.operation<World>(s => s.input, 'alias'), c.request<World>(s => ({ port: 'choose', input: s.state.sum }), 'n'), c.operation<World>(s => { s.locals.alias.n += s.locals.n; }), c.return<World>(s => s.locals.n * 2)] },
    { id: 'item', steps: [c.operation<World>(s => { s.state.seen.push(s.input.n); s.state.items.push({ n: 99 }); })] },
  ],
};
