import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScript, PolicyRouter, randomInt } from '../src/index.ts';
import type { PolicyRequest } from '../src/index.ts';
const request = {
  id: {
    instanceId: 'i',
    callId: 'c',
    key: 'k'
  },
  player: '0',
  type: 'move',
  data: {},
  observation: {},
  options: {
    kind: 'exact',
    values: [{
      x: 1
    }, {
      x: 2
    }, {
      x: 3
    }]
  }
} as unknown as PolicyRequest;
const signal = new AbortController().signal;
test('all scripts consume canonical actions and explicit random state', async () => {
  const input = {
    request,
    visibleHistory: [],
    memory: {},
    random: {
      state: 1,
      position: 0
    },
    signal
  };
  assert.deepEqual((await createScript('first').decide(input)).action, {
    x: 1
  });
  assert.deepEqual((await createScript('last').decide(input)).action, {
    x: 3
  });
  assert.deepEqual((await createScript('rule', {
    score: a => (a as any).x
  }).decide(input)).action, {
    x: 3
  });
  const a = await createScript('random').decide(input),
    b = await createScript('random').decide(input);
  assert.deepEqual(a, b);
  assert.equal(a.logProbability, -Math.log(3));
  assert.equal(input.random.position, 0);
  assert.ok(a.nextRandom.position > 0);
});
test('staged, failed and unmatched replies cannot advance committed memory or random cursors', async () => {
  const router = new PolicyRouter({
      '0': createScript('random')
    }, 3),
    before = router.snapshot(),
    binding = router.binding('0');
  router.begin();
  const reply = await binding.onRequest(request, {
    signal
  });
  assert.deepEqual(router.snapshot(), before);
  assert.throws(() => router.prepare({
    kind: 'action',
    player: '0',
    reply: {
      requestId: {
        ...request.id,
        key: 'wrong'
      },
      type: 'move',
      action: reply.value
    }
  }));
  assert.deepEqual(router.prepare(null).state, before);
  const prepared = router.prepare({
    kind: 'action',
    player: '0',
    reply: {
      requestId: request.id,
      type: 'move',
      action: reply.value
    }
  });
  assert.equal(router.commit('task:0', prepared.state), true);
  assert.equal(router.commit('task:0', prepared.state), false);
  assert.equal((router.snapshot().actors['0']!.memory as any).decisions, 1);
});
test('event memory is applied in temporal order, deduplicated, and isolated by game and actor', async () => {
  const policy = {
    ...createScript('first'),
    event: (m: any) => ({
      ...m,
      events: (m.events ?? 0) + 1
    })
  };
  const router = new PolicyRouter({
      '0': policy,
      '1': policy
    }, 1),
    binding = router.binding('0');
  router.begin();
  const event = {
    id: {
      instanceId: 'i',
      callId: 'e',
      index: 0
    },
    event: {
      kind: 'draw'
    }
  };
  await binding.onEvent(event, {
    signal
  });
  const reply = await binding.onRequest(request, {
    signal
  });
  await binding.onEvent(event, {
    signal
  });
  await binding.onEvent({
    ...event,
    id: {
      ...event.id,
      index: 1
    }
  }, {
    signal
  });
  const p = router.prepare({
    kind: 'action',
    player: '0',
    reply: {
      requestId: request.id,
      type: 'move',
      action: reply.value
    }
  });
  router.commit('task:1', p.state);
  assert.deepEqual(router.snapshot().actors['0']!.memory, {
    events: 2,
    decisions: 1
  });
  assert.deepEqual(router.snapshot().actors['1']!.memory, {});
  assert.deepEqual(new PolicyRouter({
    '0': policy
  }, 1).snapshot().actors['0']!.memory, {});
});
test('bounded random draws reject invalid domains and remain deterministic', () => {
  assert.throws(() => randomInt({
    state: 0,
    position: 0
  }, 0));
  assert.deepEqual(randomInt({
    state: 7,
    position: 8
  }, 5), randomInt({
    state: 7,
    position: 8
  }, 5));
});
