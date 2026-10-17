import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { card } from '@bear-forge/card-engine';
import { createCardLoader } from '@bear-forge/runtime-card';
import { CardGraph } from '../../runtime-card/src/graph.ts';
import { createGameBinder } from '../src/index.ts';
import { Controller, type RawStop } from '../../runtime/src/instance.ts';
const unwrap = (result: any): any => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('pure adapters borrow one stable publication while parsers and public consumers remain isolated', async () => {
  let raw: RawStop = { kind: 'call', call: { port: 'ask', input: { world: Array.from({ length: 1000 }, (_, n) => ({ n })) } } };
  const controller = new Controller<null, { ask: { input: any; output: number } }, number>({
    current: () => raw, async advance(value) { raw = { kind: 'done', result: value }; }, dispose() {}
  }, { setup: z.null(), result: z.number(), ports: { ask: { input: z.any(), output: z.number() } } }, null);
  const privateStop = controller.state, privateInput = (privateStop as any).call.input;
  let stops = 0, inputs = 0;
  const views: any[] = [], parserInputs: any[] = [], viewSchema = z.any(), parse = viewSchema.parse;
  viewSchema.parse = (value: any) => { parserInputs.push(value); return parse(value); };
  const contract: any = { schemas: { view: viewSchema, player: z.literal('a'), observation: z.number(), result: z.number(), actions: { pick: { request: z.null(), action: z.number() } } },
    ports: { ask: { kind: 'request', receive(view: any) { views.push(view); return { view, requests: [{ key: 'k', player: 'a', type: 'pick', data: null }] }; }, respond: (view: any, _r: any, action: number) => { views.push(view); return { valid: true, output: action }; } } },
    inputs: { pick: { options: z.any(), describe: (view: any) => { views.push(view); return { kind: 'exact', values: [1] }; } } }, observe: (view: any) => { views.push(view); return view.world[0].n; }, finish: (result: number) => ({ view: { world: [{ n: 0 }] }, result }) };
  const array = Array.isArray;
  Array.isArray = ((value: unknown) => { if (value === privateStop) stops++; if (value === privateInput) inputs++; return array(value); }) as typeof Array.isArray;
  let game: any;
  try {
    game = unwrap(await createGameBinder().bind<any>({ instance: controller.handle(), contract }));
    assert.equal(stops, 0, 'internal inspect must not traverse the stop');
    assert.equal(parserInputs.length, 1, 'view parser still runs exactly once');
    assert.notEqual(parserInputs[0], privateInput);
    parserInputs[0].world[0].n = 99;
    assert.ok(views.every(view => view === privateInput), 'adapters borrow the same isolated published root');
    assert.equal(unwrap(await game.observe({ player: 'a' })), 0);
    const state = unwrap(await game.inspect()), request = state.requests[0];
    request.options.values.length = 0;
    assert.deepEqual(unwrap(await game.describe({ requestId: request.id, type: request.type })), { kind: 'exact', values: [1] });
    unwrap(await game.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: 1 }) }));
    inputs = 0;
    assert.deepEqual(unwrap(await game.run()).state, { kind: 'ended', result: 1 });
    assert.equal(inputs, 0, 'respond and internal advancement must not traverse the published world');
    assert.ok(views.every(view => view === privateInput));
    assert.equal(privateInput.world[0].n, 0);
  } finally {
    Array.isArray = array;
    if (game) unwrap(await game.close());
  }
});

test('pure control adapters borrow checked input while callbacks, parsers and accepted outputs stay isolated', async () => {
  let retained: any, parserInput: any;
  const source = { n: 1 }, inputSchema = z.object({ n: z.number() }), parse = inputSchema.parse;
  inputSchema.parse = (value: any) => { parserInput = value; return parse(value); };
  const definition: any = { id: 'control-ownership', schemas: { setup: z.null(), result: z.number(), ports: { ask: { kind: 'request', input: z.number(), output: z.number() } } },
    initialize: () => ({}), entry: 'main', effects: [{ id: 'main', steps: [card.request(() => ({ port: 'ask', input: 0 }), 'reply'), card.return(s => s.locals.reply)] }] };
  const contract: any = { schemas: { view: z.number(), player: z.literal('a'), observation: z.number(), result: z.number(), actions: {} },
    ports: { ask: { kind: 'request', receive: (view: number) => ({ view, requests: [] }), respond: () => ({ valid: false, reason: 'control only' }),
      session: { requestSchema: z.number(), inputSchema, request: () => 0,
        respond(_view: any, input: any) { assert.equal(Object.isFrozen(input), false); retained = input; return { valid: true, output: input.n }; } }
    } }, inputs: {}, observe: (view: number) => view, finish: (result: number) => ({ view: result, result }) };
  const loaded = unwrap(await createCardLoader().load(definition)), instance = unwrap(await loaded.core.start(null));
  const game = unwrap(await createGameBinder().bind({ instance, contract }));
  unwrap(await game.bindControl(async () => ({ kind: 'reply', value: source })));
  const step = unwrap(await game.run()); source.n = 99; parserInput.n = 100;
  assert.deepEqual(step.state, { kind: 'ended', result: 1 });
  assert.deepEqual(step.accepted.input, { n: 1 });
  step.accepted.input.n = 101;
  assert.equal(retained.n, 1);
  unwrap(await game.close()); unwrap(await loaded.capture.release(instance.id));
});

test('borrowing advertised values as schema baselines preserves every custom check and its isolation', async () => {
  const retained: any[] = [];
  const action = z.object({ n: z.number() }).superRefine(value => { retained.push(value); });
  const definition: any = { id: 'advertised-baseline', schemas: { setup: z.null(), result: z.number(), ports: { ask: { kind: 'request', input: z.number(), output: z.number() } } },
    initialize: () => ({}), entry: 'main', effects: [{ id: 'main', steps: [card.request(() => ({ port: 'ask', input: 0 }), 'reply'), card.return(s => s.locals.reply)] }] };
  const contract: any = { schemas: { view: z.number(), player: z.literal('a'), observation: z.number(), result: z.number(), actions: { pick: { request: z.null(), action, description: z.never() } } },
    ports: { ask: { kind: 'request', receive: (view: number) => ({ view, requests: [{ key: 'k', player: 'a', type: 'pick', data: null }] }), respond: (_v: any, _r: any, value: any) => ({ valid: true, output: value.n }) } },
    inputs: { pick: { options: z.any(), describe: () => ({ kind: 'exact', values: [{ n: 1 }] }) } }, observe: (view: number) => view, finish: (result: number) => ({ view: result, result })
  };
  const loaded = unwrap(await createCardLoader().load(definition)), instance = unwrap(await loaded.core.start(null));
  const game = unwrap(await createGameBinder().bind({ instance, contract }));
  assert.equal(retained.length, 1);
  retained[0].n = 99;
  const request = unwrap(await game.inspect()).requests[0];
  assert.deepEqual(request.options.values, [{ n: 1 }]);
  request.options.values[0].n = 77;
  assert.deepEqual(unwrap(await game.describe({ requestId: request.id, type: 'pick' })).values, [{ n: 1 }]);
  unwrap(await game.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: { n: 1 } }) }));
  assert.deepEqual(unwrap(await game.run()).state, { kind: 'ended', result: 1 });
  assert.equal(retained.length, 2, 'one advertisement check plus one submitted-action check');
  unwrap(await game.close()); unwrap(await loaded.capture.release(instance.id));
});

test('a stop interceptor cannot claim ownership by restoring the original method before it returns', async () => {
  let getters = 0;
  const definition: any = { id: 'intercepted-stop', schemas: { setup: z.null(), result: z.null(), ports: { ask: { kind: 'request', input: z.any(), output: z.null() } } },
    initialize: () => ({}), entry: 'main', effects: [{ id: 'main', steps: [card.request(() => ({ port: 'ask', input: { n: 1 } }))] }] };
  const loaded = unwrap(await createCardLoader().load(definition)), instance = unwrap(await loaded.core.start(null));
  const transfer = instance.transfer;
  instance.transfer = async () => {
    const moved = await transfer();
    const handle = unwrap(moved), inspect = handle.inspect;
    handle.inspect = async () => {
      const reply = await inspect();
      Object.defineProperty(reply.value.call.input, 'n', { get() { getters++; return 1; }, enumerable: true });
      handle.inspect = inspect;
      return reply;
    };
    return moved;
  };
  const result = await createGameBinder().bind({ instance, contract: { ports: { ask: { kind: 'request', receive: () => { throw Error('must reject before receive'); } } } } as any });
  assert.equal(result.ok, false);
  assert.equal(getters, 0);
});

test('a retained writable stop from an Instance wrapper is isolated before pure adapters borrow it', async () => {
  let retained: any, published: any;
  const controller = new Controller<null, { ask: { input: { n: number }; output: number } }, number>({
    current: () => ({ kind: 'call', call: { port: 'ask', input: { n: 1 } } }), async advance() {}, dispose() {}
  }, { setup: z.null(), result: z.number(), ports: { ask: { input: z.object({ n: z.number() }), output: z.number() } } }, null);
  const instance = controller.handle(), transfer = instance.transfer;
  instance.transfer = async () => {
    const moved = unwrap(await transfer()), inspect = moved.inspect;
    moved.inspect = async () => { const result = await inspect(); retained = unwrap(result).call.input; return result; };
    return { ok: true, value: moved };
  };
  const contract: any = { schemas: { view: z.any(), player: z.literal('a'), observation: z.number(), result: z.number(), actions: { pick: { request: z.null(), action: z.number() } } },
    ports: { ask: { kind: 'request', receive(view: any) { published = view; return { view, requests: [{ key: 'k', player: 'a', type: 'pick', data: null }] }; }, respond: () => ({ valid: true, output: 1 }) } },
    inputs: { pick: { options: z.any(), describe: () => ({ kind: 'exact', values: [1] }) } }, observe: (view: any) => view.n, finish: (result: number) => ({ view: { n: result }, result }) };
  const game = unwrap(await createGameBinder().bind<any>({ instance, contract }));
  assert.notEqual(published, retained); retained.n = 99;
  assert.equal(unwrap(await game.observe({ player: 'a' })), 1);
  unwrap(await game.close());
});

test('BaseGame forks reuse private derived graphs, replace credentials and inherit no player bindings', async () => {
  let projections = 0;
  const definition: any = { id: 'thin-game', schemas: { setup: z.number(), result: z.number(), ports: {
    ask: { kind: 'request', input: z.any(), output: z.number() }
  } }, initialize: (size: number) => ({ world: Array.from({ length: size }, (_, n) => ({ n })) }), entry: 'main', effects: [{ id: 'main', steps: [
    card.request<any>(s => ({ port: 'ask', input: s.state }), 'reply'), card.return<any>(s => s.locals.reply)
  ] }] };
  const contract: any = { schemas: { view: z.any(), player: z.literal('a'), observation: z.number(), event: z.never(), playerEvent: z.never(), result: z.number(), actions: {
    pick: { request: z.null(), action: z.number(), description: z.never() }
  } }, ports: { ask: { kind: 'request', receive(view: any) { projections++; return { view, requests: [{ key: 'k', player: 'a', type: 'pick', data: null }] }; }, respond: (_v: any, _r: any, action: number) => ({ valid: true, output: action }) } },
    observe(view: any) { projections++; assert.equal(Object.isFrozen(view), false); return view.world.length; },
    inputs: { pick: { options: z.any(), describe() { projections++; return { kind: 'exact', values: [1, 2] }; } } },
    finish: (result: number) => ({ view: { world: [] }, result })
  };
  const loaded = unwrap(await createCardLoader().load(definition));
  const instance = unwrap(await loaded.core.start(20_000));
  const parent = unwrap(await createGameBinder().bind({ instance, contract }));
  const initial = unwrap(await parent.inspect());
  unwrap(await parent.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: 1 }) }));
  const before = projections, original = CardGraph.prototype.export;
  CardGraph.prototype.export = () => { throw Error('fork may not export the world'); };
  let child: any;
  try { child = unwrap(await parent.fork()); } finally { CardGraph.prototype.export = original; }
  assert.equal(projections, before, 'fork must not recompute view, observation or legal actions');
  const forked = unwrap(await child.inspect());
  assert.notEqual(forked.requests[0].id.instanceId, initial.requests[0].id.instanceId);
  assert.equal(forked.requests[0].id.callId, initial.requests[0].id.callId);
  assert.deepEqual(unwrap(await child.validate({ player: 'a', reply: { requestId: initial.requests[0].id, type: 'pick', action: 1 } })), { valid: false, reason: 'request_mismatch' });
  assert.equal(unwrap(await child.run()).pause, 'unbound');
  forked.requests[0].options.values.length = 0;
  assert.deepEqual(unwrap(await parent.inspect()), initial);
  unwrap(await parent.close());
  unwrap(await child.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: 2 }) }));
  assert.deepEqual(unwrap(await child.run()).state, { kind: 'ended', result: 2 });
  unwrap(await child.close());
  unwrap(await loaded.capture.release(parent.id)); unwrap(await loaded.capture.release(child.id));
});

for (const controlled of [false, true]) test(`read-only publications stay ordinary, isolated and stable across advancement, controlled ${controlled}`, async () => {
  let live: any;
  const publications: any[] = [];
  const definition: any = { id: 'readonly-publication', schemas: { setup: z.null(), result: z.number(), ports: { ask: { input: z.any(), output: z.number() } } },
    initialize() { const shared = Object.assign(Object.create(null), { n: 0 }); live = { n: 0, shared, alias: shared, values: [, 3n, -0] }; return live; },
    entry: 'main', effects: [{ id: 'main', steps: [card.request<any>(s => ({ port: 'ask', input: s.state }), 'reply'),
      card.operation<any>(s => { s.state.n++; s.state.shared.n++; }), card.request<any>(s => ({ port: 'ask', input: s.state }), 'reply'), card.return<any>(s => s.state.n)] }] };
  const samePublication = (view: any) => { assert.equal(view, publications.at(-1)); };
  const contract: any = { schemas: { view: z.any(), player: z.literal('a'), observation: z.object({ n: z.number(), leaf: z.number() }), result: z.number(), actions: { pick: { request: z.null(), action: z.number() } } },
    ports: { ask: { kind: 'request', receive(view: any) { publications.push(view); return { view, requests: [{ key: 'k', player: 'a', type: 'pick', data: null }] }; },
      respond(view: any, _request: any, action: number) { samePublication(view); return { valid: true, output: action }; } } },
    inputs: { pick: { options: z.any(), describe(view: any) { samePublication(view); return { kind: 'exact', values: [1] }; } } },
    observe(view: any) { samePublication(view); return { n: view.n, leaf: view.shared.n }; }, finish: (result: number) => ({ view: { n: result, shared: { n: result } }, result }) };
  const loaded = unwrap(await createCardLoader({ controlled }).load(definition)), instance = unwrap(await loaded.core.start(null));
  const game = unwrap(await createGameBinder().bind({ instance, contract }));
  const first = publications[0];
  assert.notEqual(first, live); assert.notEqual(first.shared, live.shared);
  assert.equal(Object.getPrototypeOf(first), Object.prototype); assert.equal(Object.getPrototypeOf(first.shared), Object.prototype);
  assert.equal(Object.isFrozen(first), false); assert.equal(first.shared, first.alias);
  assert.deepEqual(Object.getOwnPropertyDescriptor(first.shared, 'n'), { value: 0, enumerable: true, writable: true, configurable: true });
  assert.equal(Object.hasOwn(first.values, 0), false); assert.equal(first.values[1], 3n); assert.equal(Object.is(first.values[2], -0), true);
  unwrap(await game.bind({ player: 'a', onRequest: async (request: any) => {
    request.observation.n = 99; request.options.values.length = 0; return { kind: 'reply', value: 1 };
  } }));
  const next = unwrap(await game.run());
  assert.equal(next.state.kind, 'request'); assert.equal(next.state.requests[0].observation.n, 1);
  assert.notEqual(publications[1], first); assert.equal(publications[1].shared.n, 1);
  assert.equal(first.n, 0); assert.equal(first.shared.n, 0);
  next.state.requests[0].observation.leaf = 99;
  assert.deepEqual(unwrap(await game.observe({ player: 'a' })), { n: 1, leaf: 1 });
  assert.deepEqual(unwrap(await game.run()).state, { kind: 'ended', result: 1 });
  assert.equal(first.shared.n, 0);
  unwrap(await game.close()); if (loaded.capture) unwrap(await loaded.capture.release(instance.id));
});

for (const controlled of [false, true]) test(`a fixed action does not traverse unrelated published nodes, controlled ${controlled}`, async () => {
  const definition: any = { id: 'readonly-growth', schemas: { setup: z.number(), result: z.number(), ports: { ask: { input: z.any(), output: z.number() } } },
    initialize: (size: number) => ({ n: 0, hidden: Array.from({ length: size }, (_, n) => ({ n })) }), entry: 'main',
    effects: [{ id: 'main', steps: [card.request<any>(s => ({ port: 'ask', input: s.state }), 'reply'), card.return<any>(s => s.locals.reply)] }] };
  const loaded = unwrap(await createCardLoader({ controlled }).load(definition));
  for (const size of [32, 4096, 32768]) {
    let published: any;
    const contract: any = { schemas: { view: z.any(), player: z.literal('a'), observation: z.number(), result: z.number(), actions: { pick: { request: z.null(), action: z.number() } } },
      ports: { ask: { kind: 'request', receive(view: any) { published = view; return { view, requests: [{ key: 'k', player: 'a', type: 'pick', data: null }] }; },
        respond: (view: any, _request: any, action: number) => ({ valid: view.n === 0, output: action }) } },
      inputs: { pick: { options: z.any(), describe: () => ({ kind: 'exact', values: [1] }) } }, observe: (view: any) => view.n, finish: (result: number) => ({ view: null, result }) };
    const instance = unwrap(await loaded.core.start(size)), game = unwrap(await createGameBinder().bind({ instance, contract }));
    unwrap(await game.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: 1 }) }));
    const array = Array.isArray, hidden = published.hidden;
    Array.isArray = ((value: unknown) => {
      if (value === published || value === hidden) throw Error('unexpected full publication traversal');
      return array(value);
    }) as typeof Array.isArray;
    try { assert.deepEqual(unwrap(await game.run()).state, { kind: 'ended', result: 1 }, `world size ${size}`); }
    finally { Array.isArray = array; unwrap(await game.close()); if (loaded.capture) unwrap(await loaded.capture.release(instance.id)); }
  }
});
