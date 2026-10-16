import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEntry } from '@bear-forge/compiler';
import { createControlledLoader, programDigest } from '@bear-forge/runtime-controlled';
import { createGameBinder } from '@bear-forge/game-host';
import { game as module } from '../src/module.ts';
const unwrap = (x: any) => {
  assert.equal(x.ok, true, JSON.stringify(x));
  return x.value;
};
function action(input: any) {
  if (input.kind.includes('response')) return {
    kind: 'pass',
    value: null
  };
  if (input.kind === 'wave-0-target') return {
    kind: 'target',
    value: 'L'
  };
  if (input.kind === 'wave-0-prevent') return {
    kind: 'prevent',
    value: null
  };
  if (input.kind === 'wave-1-target') return {
    kind: 'target',
    value: 'G'
  };
  if (input.kind === 'wave-1-prevent') return {
    kind: 'prevent',
    value: 'U'
  };
  if (input.kind === 'take') return {
    kind: 'take',
    value: 'B'
  };
  return {
    kind: 'beneficiary',
    value: '0'
  };
}
test('K2–K6 save and restore complete continuations; public binder rejects stale, illegal and cross-branch replies', async () => {
  const artifact = await compileEntry(new URL('../src/program.ts', import.meta.url).pathname, 'program'),
    loaded = unwrap(await createControlledLoader({
      trustedDigests: new Set([programDigest(artifact.content)])
    }).load(artifact));
  let instance = unwrap(await loaded.core.start({
    variant: 'normal'
  }));
  const saves: any[] = [];
  let final: any;
  while (true) {
    const stop = unwrap(await instance.inspect());
    assert.notEqual(stop.kind, 'fault', JSON.stringify(stop));
    if (stop.kind === 'done') {
      final = stop.result;
      break;
    }
    if (['wave-0-prevent', 'wave-1-target', 'wave-1-prevent', 'take', 'beneficiary'].includes(stop.call.input.kind)) saves.push({
      snapshot: unwrap(await loaded.persistence.save(instance)),
      state: stop
    });
    unwrap(await instance.bind({
      decision: async ({
        input
      }: any) => ({
        kind: 'reply',
        value: action(input)
      })
    }));
    unwrap(await instance.run());
  }
  unwrap(await instance.close());
  assert.equal(saves.length, 5);
  for (const save of saves) {
    const restored = unwrap(await loaded.persistence.restore(save.snapshot));
    assert.deepEqual(unwrap(await restored.inspect()), save.state);
    unwrap(await restored.bind({
      decision: async ({
        input
      }: any) => ({
        kind: 'reply',
        value: action(input)
      })
    }));
    let result;
    while (true) {
      const stop = unwrap(await restored.run());
      assert.notEqual(stop.state.kind, 'fault', JSON.stringify(stop));
      if (stop.state.kind === 'done') {
        result = stop.state.result;
        break;
      }
    }
    assert.deepEqual(result, final);
    unwrap(await restored.close());
  }
  const restored = unwrap(await loaded.persistence.restore(saves[2].snapshot)),
    parent = unwrap(await createGameBinder().bind({
      instance: restored,
      contract: module.contract
    })),
    a = unwrap(await parent.fork()),
    b = unwrap(await parent.fork());
  const current = unwrap(await a.inspect()),
    request = current.requests[0];
  const reply = {
    requestId: request.id,
    type: 'choice',
    action: {
      kind: 'prevent',
      value: 'U'
    }
  };
  const aBefore = unwrap(await a.inspect());
  const bBefore = unwrap(await b.inspect());
  assert.deepEqual(unwrap(await a.validate({
    player: '0',
    reply
  })), { valid: false, reason: 'request_mismatch' });
  assert.equal(unwrap(await a.validate({
    player: '1',
    reply: {
      ...reply,
      action: {
        kind: 'prevent',
        value: 'missing'
      }
    }
  })).valid, false);
  assert.deepEqual(unwrap(await b.validate({
    player: '1',
    reply
  })), { valid: false, reason: 'request_mismatch' });
  assert.deepEqual(unwrap(await a.inspect()), aBefore);
  assert.deepEqual(unwrap(await b.inspect()), bBefore);
  assert.equal(unwrap(await b.observe({
    player: '1'
  })).hand.length, 1);
  unwrap(await a.bind({
    player: '1',
    async onRequest() {
      return {
        kind: 'reply',
        value: reply.action
      };
    }
  }));
  const next = unwrap(await a.run());
  assert.equal(next.accepted.kind, 'action');
  const aAfter = unwrap(await a.inspect());
  assert.deepEqual(unwrap(await a.validate({
    player: '1',
    reply
  })), { valid: false, reason: 'request_mismatch' });
  assert.deepEqual(unwrap(await a.inspect()), aAfter);
  assert.equal(unwrap(await b.observe({
    player: '1'
  })).hand.length, 1);
  async function finish(game: any, choices: Record<string, any> = {}) {
    for (const player of ['0', '1']) unwrap(await game.bind({
      player,
      async onRequest(request: any) {
        return {
          kind: 'reply',
          value: choices[request.data.kind] ?? action({
            kind: request.data.kind
          })
        };
      }
    }));
    while (true) {
      const next = unwrap(await game.run());
      assert.notEqual(next.state.kind, 'fault', JSON.stringify(next));
      if (next.state.kind === 'ended') return next.state.result;
      assert.equal(next.pause, null);
    }
  }
  const av = await finish(a),
    bv = await finish(b, {
      'wave-1-prevent': {
        kind: 'prevent',
        value: null
      }
    });
  assert.equal(av.board.find((u: any) => u.id === 'G').hp, 3);
  assert.equal(bv.board.find((u: any) => u.id === 'G').hp, 1);
  assert.equal(av.damage, 2);
  assert.equal(bv.damage, 4);
  assert.deepEqual(av.hands, [['B'], []]);
  assert.deepEqual(bv.hands, [['B'], ['U']]);
  assert.deepEqual(av.triggers, bv.triggers);
  assert.equal(av.events.filter((e: any) => e.kind === 'death').length, 1);
  assert.equal(bv.events.filter((e: any) => e.kind === 'death').length, 1);
  assert.equal(unwrap(await parent.observe({
    player: '1'
  })).hand.length, 1);
  await a.close();
  await b.close();
  await parent.close();
  for (const [index, choices, check] of [[1, {
    'wave-1-target': {
      kind: 'target',
      value: 'W'
    }
  }, (x: any, y: any) => {
    assert.ok(x.board.some((u: any) => u.id === 'W'));
    assert.ok(!y.board.some((u: any) => u.id === 'W'));
    assert.deepEqual(x.hp, y.hp);
    assert.equal(y.hands[1][0], 'U');
  }], [3, {
    take: {
      kind: 'take',
      value: 'P'
    }
  }, (x: any, y: any) => {
    assert.deepEqual(x.deck, ['M', 'N', 'P', 'S']);
    assert.deepEqual(y.deck, ['M', 'N', 'B', 'S']);
    assert.equal(y.hands[0][0], 'P');
  }], [4, {
    beneficiary: {
      kind: 'beneficiary',
      value: '1'
    }
  }, (x: any, y: any) => {
    assert.deepEqual(x.hp, [11, 10]);
    assert.deepEqual(y.hp, [10, 11]);
    assert.deepEqual(x.deck, y.deck);
    assert.deepEqual(x.hands, y.hands);
  }]] as const) {
    const source = unwrap(await loaded.persistence.restore(saves[index].snapshot)),
      game = unwrap(await createGameBinder().bind({
        instance: source,
        contract: module.contract
      })),
      before = unwrap(await game.inspect()),
      left = unwrap(await game.fork()),
      right = unwrap(await game.fork());
    if (index === 1) {
      const r = before.requests[0];
      assert.equal(unwrap(await game.validate({
        player: '0',
        reply: {
          requestId: r.id,
          type: 'choice',
          action: {
            kind: 'target',
            value: 'L'
          }
        }
      })).valid, false);
    }
    const x = await finish(left),
      y = await finish(right, choices);
    check(x, y);
    assert.deepEqual(unwrap(await game.inspect()), before);
    if (index === 3) {
      const xv = unwrap(await left.observe({
          player: '1'
        })),
        yv = unwrap(await right.observe({
          player: '1'
        }));
      assert.deepEqual(xv, yv);
    }
    await left.close();
    await right.close();
    await game.close();
  }
  for (const save of saves) unwrap(await loaded.persistence.release(save.snapshot));
});
