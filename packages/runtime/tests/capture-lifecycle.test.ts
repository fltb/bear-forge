import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Controller, createCapture } from '../src/index.ts';

test('release drops record roots even when a closed handle is retained; sibling prefixes remain intact', async () => {
  const schema = { parse: (value: any) => value };
  let raw: any = { kind: 'call', call: { port: 'ask', input: { retained: Array.from({ length: 1000 }, (_, n) => n) } } };
  const controller = new Controller({ current: () => raw, advance: async () => {}, dispose: () => { raw = undefined; } }, {
    setup: schema, result: schema, ports: { ask: { input: schema, output: schema } }
  }, null);
  const controllers = new Map([[controller.id, controller]]), capture = createCapture(controllers), handle = controller.handle();
  const siblingPrefix = controller.records!.fork();
  assert.equal((await capture.release(handle.id)).ok, false);
  assert.equal((await handle.close()).ok, true);
  assert.equal(controller.state.kind, 'fault');
  assert.equal(controller.records!.length, 2, 'close preserves capture until explicit release');
  const before = await capture.read(handle.id, { after: null, limit: 10 });
  assert.equal(before.ok, true);
  assert.equal((await capture.release(handle.id)).ok, true);
  assert.equal(controller.records!.length, 0);
  assert.equal(controllers.size, 0);
  assert.equal(siblingPrefix.length, 2);
  assert.equal(siblingPrefix.slice()[1]!.kind, 'called');
  assert.equal((await capture.read(handle.id, { after: null, limit: 10 })).ok, false);
  assert.equal((await capture.release(handle.id)).ok, true);
  assert.equal((await handle.inspect()).ok, false);
});
