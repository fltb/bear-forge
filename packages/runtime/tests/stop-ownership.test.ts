import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Controller, type RawStop } from '../src/instance.ts';
import { invokeOwnedStop, inputlessReply, registerStopOwner, exportStop } from '../src/stop-ownership.ts';

function create(input: any) {
  let raw: RawStop = { kind: 'call', call: { port: 'step', input } };
  const controller = new Controller<null, { step: { input: any; output: number } }, number>({
    current: () => raw,
    async advance(output: any) { raw = { kind: 'done', result: output }; },
    dispose() {}
  }, { setup: z.null(), result: z.number(), ports: { step: { input: z.any(), output: z.number() } } }, null);
  return { controller, handle: controller.handle() };
}
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  assert.equal(result.ok, true);
  if (!result.ok) throw Error('operation failed');
  return result.value;
};

test('stop composition returns the original Promise without inserting a scheduling turn', async () => {
  const stop = { kind: 'done', result: { n: 1 } };
  let underlying!: Promise<typeof stop>;
  const handle = {
    inspect() { underlying = Promise.resolve(exportStop(handle, 'inspect', stop, this)); return underlying; },
    run() { underlying = Promise.resolve(exportStop(handle, 'run', stop, this)); return underlying; }
  };
  registerStopOwner(handle);
  for (const operation of ['inspect', 'run'] as const) {
    const result = invokeOwnedStop(handle, operation);
    assert.equal(result, underlying);
    assert.equal(await result, stop);
  }
  const original = handle.inspect;
  handle.inspect = function () { return original.call(handle); };
  const intercepted = invokeOwnedStop(handle, 'inspect');
  assert.equal(intercepted, underlying, 'fallback must also preserve the original Promise');
  assert.notEqual(await intercepted, stop);
});

test('internal stop handoff shares the immutable snapshot while every public return is detached', async () => {
  const leaf = { n: -0 }, input: any = { leaf, alias: leaf, values: new Array(3) };
  input.self = input; input.values[2] = leaf;
  Object.defineProperty(input, '__proto__', { value: { safe: true }, enumerable: true });
  const { controller, handle } = create(input);
  const original = controller.state;
  assert.equal(unwrap(await invokeOwnedStop(handle, 'inspect')), original);
  const waiting = unwrap(await invokeOwnedStop(handle, 'run'));
  assert.equal(waiting.state, original);
  assert.equal(waiting.pause, 'unbound');
  const publicStop: any = unwrap(await handle.inspect());
  assert.notEqual(publicStop, original);
  assert.equal(publicStop.call.input.self, publicStop.call.input);
  assert.equal(publicStop.call.input.alias, publicStop.call.input.leaf);
  assert.equal(0 in publicStop.call.input.values, false);
  assert.equal(Object.is(publicStop.call.input.leaf.n, -0), true);
  assert.equal(Object.hasOwn(publicStop.call.input, '__proto__'), true);
  publicStop.call.input.leaf.n = 99;
  const publicRun: any = unwrap(await handle.run());
  assert.equal(Object.is(publicRun.state.call.input.leaf.n, -0), true);
  assert.notEqual(publicRun.state, original);
  unwrap(await handle.bind({ step: inputlessReply(7) }));
  const ended = unwrap(await invokeOwnedStop(handle, 'run'));
  assert.equal(ended.state, controller.state);
  assert.deepEqual(ended.state, { kind: 'done', result: 7 });
  unwrap(await handle.close());
  const closed = await invokeOwnedStop(handle, 'inspect');
  assert.equal(closed.ok, false);
});

test('interceptors, proxies and reentrant public queries cannot acquire an internal snapshot', async () => {
  const { controller, handle } = create({ n: 1 });
  const inspect = handle.inspect;
  let retained: any;
  handle.inspect = async function () {
    assert.equal(this, handle);
    const result = await inspect();
    retained = unwrap(result);
    handle.inspect = inspect;
    return result;
  };
  const intercepted: any = unwrap(await invokeOwnedStop(handle, 'inspect'));
  assert.equal(intercepted, retained);
  assert.notEqual(intercepted, controller.state);
  intercepted.call.input.n = 2;
  const proxied: any = unwrap(await invokeOwnedStop(new Proxy(handle, {}), 'inspect'));
  assert.notEqual(proxied, controller.state);
  assert.equal(proxied.call.input.n, 1);
  const apply = Reflect.apply;
  let interceptedReceiver = false;
  Reflect.apply = ((fn: Function, receiver: unknown, args: any[]) => {
    if (fn === inspect) interceptedReceiver = true;
    return apply(fn, receiver, args);
  }) as typeof Reflect.apply;
  try { assert.equal(unwrap(await invokeOwnedStop(handle, 'inspect')), controller.state); }
  finally { Reflect.apply = apply; }
  assert.equal(interceptedReceiver, false, 'a replacement intrinsic cannot retain the private receiver');
  let entered!: () => void, release!: () => void, reentrant: any;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  unwrap(await handle.bind({ step: async () => {
    reentrant = unwrap(await handle.inspect());
    reentrant.call.input.n = 3;
    entered(); await wait;
    return { kind: 'reply', value: 4 };
  } }));
  const pending = invokeOwnedStop(handle, 'run');
  await ready;
  assert.notEqual(reentrant, controller.state);
  assert.equal((unwrap(await invokeOwnedStop(handle, 'inspect')) as any).call.input.n, 1);
  const busy = await invokeOwnedStop(handle, 'run');
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.error.code, 'instance_busy');
  release();
  assert.equal(unwrap(await pending).state, controller.state);
  unwrap(await handle.close());
});

test('only the exact framework reply closure skips the unused input traversal', async () => {
  for (const wrapped of [false, true]) {
    const { controller, handle } = create({ world: Array.from({ length: 1000 }, (_, n) => ({ n })) });
    const source: any = (controller.state as any).call.input;
    const reply = inputlessReply(5);
    let received: any;
    const handler = wrapped ? async (...args: any[]) => { received = args[0].input; return reply(); } : reply;
    unwrap(await handle.bind({ step: handler }));
    const array = Array.isArray;
    let visits = 0;
    Array.isArray = ((value: unknown) => { if (value === source) visits++; return array(value); }) as typeof Array.isArray;
    let result;
    try { result = unwrap(await invokeOwnedStop(handle, 'run')); }
    finally { Array.isArray = array; }
    assert.deepEqual(result.state, { kind: 'done', result: 5 });
    if (wrapped) {
      assert.ok(visits > 0);
      assert.notEqual(received, source);
      received.world[0].n = -1;
      assert.equal(source.world[0].n, 0);
    } else assert.equal(visits, 0, 'unused world input must not be traversed');
    unwrap(await handle.close());
  }
  const { controller, handle } = create({ n: 1 });
  unwrap(await handle.bind({ step: inputlessReply(9) }));
  const aborter = new AbortController(); aborter.abort();
  const cancelled = unwrap(await invokeOwnedStop(handle, 'run', { signal: aborter.signal }));
  assert.equal(cancelled.pause, 'cancelled');
  assert.equal(cancelled.accepted, false);
  assert.equal(cancelled.state, controller.state);
  unwrap(await handle.close());
});
