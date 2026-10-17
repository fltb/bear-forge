import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCardLoader } from '@bear-forge/runtime-card';
import { game as module } from '@bear-forge/doudizhu';
import { createGameBinder } from '../src/index.ts';
const unwrap = <T,>(x: {
  ok: true;
  value: T;
} | {
  ok: false;
  error: unknown;
}): T => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return (x as {
    ok: true;
    value: T;
  }).value;
};
test('production binder owns real runner and completes a full game using public choices', async () => {
  const loaded = unwrap(await createCardLoader({controlled:false}).load(module.definition));
  const instance = unwrap(await loaded.core.start({
    game: {
      profile: 'competitive-2016-bear-1',
      firstBidder: '0',
      initialGameTime: 0
    },
    seed: 11
  }));
  const game = unwrap(await createGameBinder().bind({
    instance,
    contract: module.contract
  }));
  assert.equal((await instance.inspect()).ok, false);
  let delivered = 0;
  for (const player of ['0', '1', '2'] as const) unwrap(await game.bind({
    player,
    async onRequest(request) {
      assert.equal(request.player, player);
      assert.equal(request.options.kind, 'exact');
      if (request.options.kind !== 'exact') throw Error('expected exact');
      return {
        kind: 'reply',
        value: request.options.values.at(-1)!
      };
    },
    async onEvent() {
      delivered++;
      return {
        kind: 'reply',
        value: null
      };
    }
  }));
  let steps = 0;
  while (true) {
    const stop = unwrap(await game.run());
    assert.equal(stop.pause, null);
    assert.notEqual(stop.state.kind, 'fault', JSON.stringify(stop));
    if (stop.state.kind === 'ended') break;
    assert.ok(++steps < 600);
  }
  assert.ok(delivered > 0);
  unwrap(await game.close());
  assert.equal((await game.inspect()).ok, false);
});
