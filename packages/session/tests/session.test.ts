import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestIdSchema } from '@bear-forge/contracts/game';
import { VirtualSession } from '../src/index.ts';
const id = RequestIdSchema.parse({
  instanceId: randomUUID(),
  callId: randomUUID(),
  key: 'k'
});
test('timeoutFirst, explicit arrival order, revoked credentials and committed clock replay', () => {
  const s = new VirtualSession();
  s.enqueue({
    at: 10,
    player: '0',
    requestId: id,
    type: 'move',
    action: {
      a: 1
    }
  });
  const input = {
    at: 10,
    requests: [{
      id,
      player: '0',
      type: 'move'
    }],
    deadlines: [{
      key: 'slot',
      at: 10
    }]
  };
  const timeout = s.select(input);
  assert.equal(timeout.kind, 'timeout');
  assert.equal(s.snapshot().now, 0);
  s.commit(timeout);
  const restored = new VirtualSession(s.snapshot());
  assert.deepEqual(restored.select({
    ...input,
    deadlines: []
  }), s.select({
    ...input,
    deadlines: []
  }));
  assert.equal(restored.select({
    ...input,
    requests: [{
      id: RequestIdSchema.parse({
        ...id,
        instanceId: randomUUID()
      }),
      player: '0',
      type: 'move'
    }],
    deadlines: []
  }).kind, 'clock');
  const action = s.select({
    ...input,
    deadlines: []
  });
  assert.equal(s.commit(action), true);
  assert.equal(s.commit(action), false);
  assert.throws(() => s.select({
    ...input,
    at: 9
  }));
});
test('failed arrivals leave the session unchanged and never evaluate caller getters', () => {
  const session = new VirtualSession();
  const before = session.snapshot();
  assert.throws(() => session.enqueue({ at: 1, player: '0', requestId: id, type: 'move', action: () => 1 } as any));
  assert.deepEqual(session.snapshot(), before);
  let reads = 0;
  const invalid = { get at() { reads++; return 1; }, player: '0', requestId: id, type: 'move', action: null };
  assert.throws(() => session.enqueue(invalid));
  assert.equal(reads, 0);
  assert.deepEqual(session.snapshot(), before);
  assert.equal(session.enqueue({ at: 1, player: '0', requestId: id, type: 'move', action: null }), 0);
});
