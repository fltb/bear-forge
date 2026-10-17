import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { card as c } from '@bear-forge/card-engine';
import type { CardDefinition } from '@bear-forge/card-engine';
import { createCardLoader } from '../src/index.ts';
const unwrap = (r: any): any => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };

test('two thousand dynamic calls preserve distinct environments, restore and unwind without JS recursion', async () => {
  type World = { value: number };
  const definition: CardDefinition<World, number, { choose: { input: number; output: number } }, number> = {
    id: 'recursive-1', schemas: { setup: z.number().int(), result: z.number(), ports: { choose: { input: z.number(), output: z.number() } } },
    initialize: () => ({ value: 0 }), entry: 'recursive', effects: [{ id: 'recursive', steps: [
      c.branch<World>(s => s.input === 0, [c.request<World>(() => ({ port: 'choose', input: 0 }), 'reply'), c.return<World>(s => s.locals.reply)]),
      c.invoke<World>(() => 'recursive', s => s.input - 1, 'child'), c.return<World>(s => s.locals.child + 1),
    ] }],
  };
  const loaded: any = unwrap(await createCardLoader({ stepBudget: 20000 }).load(definition)); const parent = unwrap(await loaded.core.start(2000));
  const saved = unwrap(await loaded.persistence.save(parent)), child = unwrap(await parent.fork()); await parent.close();
  const restored = unwrap(await loaded.persistence.restore(saved));
  for (const [instance, reply] of [[child, 3], [restored, 9]]) {
    unwrap(await instance.bind({ choose: async () => ({ kind: 'reply', value: reply }) })); unwrap(await instance.run());
    assert.deepEqual(unwrap(await instance.inspect()), { kind: 'done', result: 2000 + reply }); await instance.close();
  }
});

test('captured source survives removal and restore without aliasing its replacement', async () => {
  type World = { items: { id: string; n: number }[] };
  const definition: CardDefinition<World, null, { choose: { input: number; output: number } }, number[]> = {
    id: 'captured-source-1', schemas: { setup: z.null(), result: z.array(z.number()), ports: { choose: { input: z.number(), output: z.number() } } },
    initialize: () => ({ items: [{ id: 'same-name', n: 3 }] }), entry: 'root', effects: [
      { id: 'root', steps: [c.invoke<World>('source', s => s.state.items[0], 'old'), c.return<World>(s => [s.locals.old, s.state.items[0]!.n])] },
      { id: 'source', steps: [c.operation<World>(s => { s.state.items.splice(0, 1, { id: 'same-name', n: 12 }); }), c.request<World>(s => ({ port: 'choose', input: s.input.n }), 'reply'), c.operation<World>(s => { s.input.n += s.locals.reply; }), c.return<World>(s => s.input.n)] },
    ],
  };
  const loaded: any = unwrap(await createCardLoader().load(definition)), parent = unwrap(await loaded.core.start(null));
  const saved = unwrap(await loaded.persistence.save(parent)); const restored = unwrap(await loaded.persistence.restore(saved)); await parent.close();
  unwrap(await restored.bind({ choose: async () => ({ kind: 'reply', value: 4 }) })); unwrap(await restored.run());
  assert.deepEqual(unwrap(await restored.inspect()), { kind: 'done', result: [7, 12] }); await restored.close();
});
