import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { GameModule } from '@bear-forge/contracts/authoring';
import { createNativeLoader } from '@bear-forge/runtime-native';
import { createGameBinder } from '../src/index.ts';

type G = {
  setup: 'before' | 'after' | 'done' | 'event';
  ports: { ask: { kind: 'request'; input: number; output: number }; event: { kind: 'event'; input: number; output: null } };
  programResult: number; view: number; player: 'a' | 'b'; observation: number;
  actions: { pick: { request: null; action: number; description: never } };
  event: number; playerEvent: number; result: number; control: { request: number; input: number };
};
const fixture: GameModule<G> = {
  program: {
    schemas: {
      setup: z.enum(['before', 'after', 'done', 'event']), result: z.number(),
      ports: { ask: { kind: 'request', input: z.number(), output: z.number() }, event: { kind: 'event', input: z.number(), output: z.null() } }
    },
    async run(mode, io) {
      if (mode === 'before') throw new Error('before input');
      const value = await io.call({ port: 'ask', input: 0 });
      if (mode === 'after') throw new Error('after input');
      if (mode === 'event') await io.call({ port: 'event', input: value });
      return value;
    }
  },
  contract: {
    schemas: {
      view: z.number(), player: z.enum(['a', 'b']), observation: z.number(),
      event: z.number(), playerEvent: z.number(), result: z.number(),
      actions: { pick: { request: z.null(), action: z.number(), description: z.never() } }
    },
    ports: { ask: {
      kind: 'request',
      receive: view => ({ view, requests: [{ key: 'pick', player: 'a', type: 'pick', data: null }] }),
      respond: (_view, _request, action) => ({ valid: true, output: action })
    }, event: { kind: 'event', receive: event => ({ events: [event], output: null }) } },
    inputs: { pick: {
      options: z.strictObject({ kind: z.literal('exact'), values: z.array(z.number()) }),
      describe: () => ({ kind: 'exact', values: [1] })
    } },
    observe: view => view,
    projectEvent: event => ({ event }),
    finish: result => ({ view: result, result })
  }
};
function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw Error('unexpected failure');
  return result.value;
}
async function start(mode: G['setup'], contract = fixture.contract) {
  const loaded = unwrap(await createNativeLoader().load(fixture.program));
  const instance = unwrap(await loaded.core.start(mode));
  return unwrap(await createGameBinder().bind<G>({ instance, contract }));
}

test('game contract faults cannot execute thrown-value coercion while creating diagnostics', async () => {
  let calls=0;
  const thrown={toString(){calls++;throw Error('secondary');}};
  let throwing=false;
  const game=await start('done',{...fixture.contract,observe(view){if(throwing)throw thrown;return view;}});
  throwing=true;
  const result=await game.observe({player:'a'});
  assert.equal(result.ok,false);
  if(result.ok)throw Error('missing failure');
  assert.equal(result.error.code,'invalid_output');
  assert.equal(result.error.message,'Thrown object');
  assert.equal(calls,0);
  const closed=await game.inspect();
  assert.equal(closed.ok,false);
  if(!closed.ok)assert.equal(closed.error.code,'game_closed');
});

test('production binder retains initial program fault as a readable terminal game', async () => {
  const game = await start('before');
  const state = unwrap(await game.inspect());
  assert.equal(state.kind, 'fault');
  if (state.kind !== 'fault') throw Error('expected fault');
  assert.equal(state.error.code, 'program_failed');
  let callbacks = 0;
  unwrap(await game.bind({ player: 'a', onRequest: async () => { callbacks++; return { kind: 'pause' }; } }));
  const cancellation = new AbortController(); cancellation.abort();
  assert.deepEqual(unwrap(await game.run({ signal: cancellation.signal })), { state, accepted: null, pause: null });
  assert.deepEqual(await game.observe({ player: 'a' }), { ok: false, error: state.error });
  assert.equal(callbacks, 0);
  unwrap(await game.close());
  const closed = await game.inspect();
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.error.code, 'game_closed');
});

test('production binder preserves accepted action and original program fault for subsequent operations', async () => {
  const game = await start('after');
  const initial = unwrap(await game.inspect());
  if (initial.kind !== 'request') throw Error('expected request');
  const request = initial.requests[0]!;
  unwrap(await game.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: 1 }) }));
  const stop = unwrap(await game.run());
  assert.equal(stop.state.kind, 'fault');
  if (stop.state.kind !== 'fault') throw Error('expected fault');
  assert.deepEqual(stop.accepted, { kind: 'action', player: 'a', reply: { requestId: request.id, type: 'pick', action: 1 } });
  const error = stop.state.error;
  for (const result of [
    await game.observe({ player: 'a' }),
    await game.describe({ requestId: request.id, type: 'pick' }),
    await game.validate({ player: 'a', reply: { requestId: request.id, type: 'pick', action: 1 } })
  ]) assert.deepEqual(result, { ok: false, error });
  // Public error values are copies, not mutable aliases of the stored fault.
  stop.state.error.message = 'changed by caller';
  const current = unwrap(await game.inspect());
  assert.equal(current.kind, 'fault');
  if (current.kind === 'fault') assert.notEqual(current.error.message, 'changed by caller');
  assert.deepEqual(unwrap(await game.run()), { state: current, accepted: null, pause: null });
  unwrap(await game.bind(null));
  unwrap(await game.close());
});

test('production binder still closes on finish adapter failure while retaining accepted input', async () => {
  const game = await start('done', { ...fixture.contract, finish() { throw Error('bad adapter'); } });
  unwrap(await game.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: 1 }) }));
  const stop = unwrap(await game.run());
  assert.equal(stop.state.kind, 'fault');
  if (stop.state.kind === 'fault') assert.equal(stop.state.error.code, 'invalid_output');
  assert.equal(stop.accepted?.kind, 'action');
  const closed = await game.inspect();
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.error.code, 'game_closed');
});

test('adapter failure cancels other waiting request callbacks and settles the active run', { timeout: 2000 }, async () => {
  let cancelled = false;
  const game = await start('done', {
    ...fixture.contract,
    ports: { ...fixture.contract.ports, ask: {
      ...fixture.contract.ports.ask,
      receive: view => ({ view, requests: [
        { key: 'fail', player: 'a', type: 'pick', data: null },
        { key: 'wait', player: 'a', type: 'pick', data: null }
      ] }),
      respond() { throw Error('bad action adapter'); }
    } }
  });
  unwrap(await game.bind({ player: 'a', onRequest: async (request, { signal }) => {
    if (request.id.key === 'fail') return { kind: 'reply', value: 1 };
    return await new Promise(resolve => {
      signal.addEventListener('abort', () => { cancelled = true; resolve({ kind: 'pause' }); }, { once: true });
    });
  } }));
  const stop = unwrap(await game.run());
  assert.equal(stop.state.kind, 'fault');
  if (stop.state.kind === 'fault') assert.equal(stop.state.error.code, 'invalid_output');
  assert.equal(stop.accepted, null);
  assert.equal(stop.pause, null);
  assert.equal(cancelled, true);
});

test('a permissive game action schema cannot admit non-JSON or cyclic actions', async () => {
  const contract={...fixture.contract,schemas:{...fixture.contract.schemas,actions:{pick:{
    ...fixture.contract.schemas.actions.pick,action:z.any()
  }}}};
  const game=await start('done',contract);
  try {
    const state=unwrap(await game.inspect());
    assert.equal(state.kind,'request');
    if(state.kind!=='request')throw Error('missing request');
    const cyclic:any={};cyclic.self=cyclic;
    for(const action of [1n,cyclic])assert.deepEqual(await game.validate({player:'a',reply:{
      requestId:state.requests[0]!.id,type:'pick',action
    } as any}),{ok:true,value:{valid:false,reason:'invalid_action'}});
  } finally {unwrap(await game.close());}
});

test('permissive game schemas cannot publish non-JSON or cyclic requests or choices', async () => {
  const cyclic:any={};cyclic.self=cyclic;
  const requestContract={...fixture.contract,schemas:{...fixture.contract.schemas,actions:{pick:{
    ...fixture.contract.schemas.actions.pick,request:z.any()
  }}},ports:{...fixture.contract.ports,ask:{...fixture.contract.ports.ask,
    receive:(view:number)=>({view,requests:[{key:'pick',player:'a' as const,type:'pick' as const,data:1n}]})
  }}} as any;
  const choicesContract={...fixture.contract,inputs:{pick:{
    options:z.any(),describe:()=>({kind:'exact',values:[1n]})
  }}} as any;
  const cyclicRequest={...requestContract,ports:{...requestContract.ports,ask:{...requestContract.ports.ask,
    receive:(view:number)=>({view,requests:[{key:'pick',player:'a',type:'pick',data:cyclic}]})
  }}} as any;
  const cyclicChoices={...fixture.contract,inputs:{pick:{
    options:z.any(),describe:()=>({kind:'construct',description:cyclic})
  }}} as any;
  for(const contract of [requestContract,choicesContract,cyclicRequest,cyclicChoices]) {
    const loaded=unwrap(await createNativeLoader().load(fixture.program));
    const instance=unwrap(await loaded.core.start('done'));
    const result=await createGameBinder().bind<G>({instance,contract});
    assert.equal(result.ok,false);
    if(!result.ok)assert.equal(result.error.code,'invalid_output');
  }
});

test('repeated references without a cycle remain valid JSON choices', async () => {
  const shared={value:1};
  const option={left:shared,right:shared};
  const contract={...fixture.contract,schemas:{...fixture.contract.schemas,actions:{pick:{
    ...fixture.contract.schemas.actions.pick,action:z.any()
  }}},inputs:{pick:{options:z.any(),describe:()=>({kind:'exact',values:[option]})}}} as any;
  const game=await start('done',contract);
  try {
    const state=unwrap(await game.inspect());
    assert.equal(state.kind,'request');
    if(state.kind!=='request')throw Error('missing request');
    const options=state.requests[0]!.options;
    assert.equal(options.kind,'exact');
    if(options.kind==='exact')assert.strictEqual((options.values[0] as any).left,(options.values[0] as any).right);
  } finally {unwrap(await game.close());}
});

test('a permissive player schema cannot change the public player value type', async () => {
  const contract={...fixture.contract,schemas:{...fixture.contract.schemas,player:z.any()}};
  const game=await start('done',contract);
  try {
    const bound=await game.bind({player:7,onRequest:async()=>({kind:'pause'})} as any);
    assert.equal(bound.ok,false);
    if(!bound.ok)assert.equal(bound.error.code,'invalid_argument');
  } finally {unwrap(await game.close());}
  const numericRequest={...contract,ports:{...contract.ports,ask:{...contract.ports.ask,
    receive:(view:number)=>({view,requests:[{key:'pick',player:7,type:'pick' as const,data:null}]})
  }}} as any;
  const loaded=unwrap(await createNativeLoader().load(fixture.program));
  const instance=unwrap(await loaded.core.start('done'));
  const result=await createGameBinder().bind<G>({instance,contract:numericRequest});
  assert.equal(result.ok,false);
  if(!result.ok)assert.equal(result.error.code,'invalid_output');
});

test('exact choices must satisfy their declared action schema', async () => {
  const contract={...fixture.contract,inputs:{pick:{
    options:z.any(),describe:()=>({kind:'exact',values:['not-a-number']})
  }}} as any;
  const loaded=unwrap(await createNativeLoader().load(fixture.program));
  const instance=unwrap(await loaded.core.start('done'));
  const result=await createGameBinder().bind<G>({instance,contract});
  assert.equal(result.ok,false);
  if(!result.ok)assert.equal(result.error.code,'invalid_output');
});

function expectCode(result: { ok: boolean; error?: { code: string } }, code: string) {
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, code);
}

test('reader input format, request mismatch, event and ended states follow the fixed protocol', async () => {
  const game = await start('event');
  try {
    const initial = unwrap(await game.inspect());
    if (initial.kind !== 'request') throw Error('expected request');
    const request = initial.requests[0]!;
    const reply = { requestId: request.id, type: 'pick' as const, action: 1 };
    assert.deepEqual(await game.validate({ player: 'a', reply: { ...reply, requestId: { ...request.id, key: 'missing' } } }),
      { ok: true, value: { valid: false, reason: 'request_mismatch' } });
    expectCode(await game.describe({ requestId: { ...request.id, key: 'missing' }, type: 'pick' }), 'request_mismatch');
    unwrap(await game.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: 1 }), onEvent: async () => ({ kind: 'pause' }) }));
    assert.equal(unwrap(await game.run()).state.kind, 'event');
    for (const result of [
      await game.observe({ player: 'a' }),
      await game.describe({ requestId: request.id, type: 'pick' }),
      await game.validate({ player: 'a', reply })
    ]) expectCode(result, 'view_unavailable');
    // These deliberately malformed calls cross the JS boundary without changing public types.
    expectCode(await Reflect.apply(game.observe, game, [{}]), 'invalid_input');
    expectCode(await Reflect.apply(game.describe, game, [{ requestId: request.id, type: 'unknown' }]), 'invalid_input');
    expectCode(await Reflect.apply(game.validate, game, [{ player: 'a', reply: { ...reply, type: 'unknown' } }]), 'invalid_input');
    unwrap(await game.bind({ player: 'a', onEvent: async () => ({ kind: 'reply', value: null }) }));
    assert.equal(unwrap(await game.run()).state.kind, 'ended');
    assert.equal(unwrap(await game.observe({ player: 'a' })), 1);
    expectCode(await game.describe({ requestId: request.id, type: 'pick' }), 'game_ended');
    expectCode(await game.validate({ player: 'a', reply }), 'game_ended');
  } finally { await game.close(); }
});

test('a later observation projection failure is a contract fault and closes the game', async () => {
  let broken = false;
  const game = await start('done', { ...fixture.contract, observe(view) {
    if (broken) throw Error('broken observation');
    return view;
  } });
  broken = true;
  expectCode(await game.observe({ player: 'a' }), 'invalid_output');
  expectCode(await game.inspect(), 'game_closed');
});

test('control adapter failures fault and close; bad host replies only pause', async () => {
  for (const failure of ['request', 'respond', 'host', 'input', 'none'] as const) {
    const game = await start('done', {
      ...fixture.contract,
      ports: { ...fixture.contract.ports, ask: {
        ...fixture.contract.ports.ask,
        session: {
          requestSchema: z.number(), inputSchema: z.number(),
          request(view) { if (failure === 'request') throw Error('request adapter'); return view; },
          respond(_view, value) { if (failure === 'respond') throw Error('response adapter'); return { valid: true, output: value }; }
        }
      } }
    });
    assert.ok(game.bindControl);
    let called = 0;
    unwrap(await game.bindControl(async () => {
      called++;
      if (failure === 'host') throw Error('host failure');
      return { kind: 'reply', value: failure === 'input' ? NaN : 1 };
    }));
    const stop = unwrap(await game.run());
    if (failure === 'request' || failure === 'respond') {
      assert.equal(stop.state.kind, 'fault', failure);
      if (stop.state.kind === 'fault') assert.equal(stop.state.error.code, 'invalid_output');
      assert.equal(stop.accepted, null);
      assert.equal(stop.pause, null);
      expectCode(await game.inspect(), 'game_closed');
    } else {
      assert.equal(stop.pause, failure === 'host' ? 'handler_failed' : failure === 'input' ? 'invalid_reply' : null);
      assert.equal(stop.state.kind, failure === 'none' ? 'ended' : 'request');
      assert.equal(stop.accepted?.kind ?? null, failure === 'none' ? 'control' : null);
      unwrap(await game.close());
    }
    assert.equal(called, failure === 'request' ? 0 : 1);
  }
});

test('a contract fault discovered by a reader cancels an already waiting run', { timeout: 2000 }, async () => {
  let broken = false;
  const game = await start('done', { ...fixture.contract, observe(view) {
    if (broken) throw Error('observation failed while waiting');
    return view;
  } });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let cancelled = false;
  unwrap(await game.bind({ player: 'a', onRequest: async (_request, { signal }) => {
    entered();
    return await new Promise(resolve => signal.addEventListener('abort', () => {
      cancelled = true; resolve({ kind: 'pause' });
    }, { once: true }));
  } }));
  const running = game.run();
  await ready;
  broken = true;
  expectCode(await game.observe({ player: 'a' }), 'invalid_output');
  const stop = unwrap(await running);
  assert.equal(stop.state.kind, 'fault');
  assert.equal(stop.accepted, null);
  assert.equal(stop.pause, null);
  assert.equal(cancelled, true);
});

test('empty player requests require a declared control session', async () => {
  const contract = { ...fixture.contract, ports: { ...fixture.contract.ports, ask: {
    ...fixture.contract.ports.ask, receive: (view: number) => ({ view, requests: [] })
  } } };
  const loaded = unwrap(await createNativeLoader().load(fixture.program));
  const instance = unwrap(await loaded.core.start('done'));
  expectCode(await createGameBinder().bind<G>({ instance, contract }), 'invalid_output');
  const game = await start('done', { ...contract, ports: { ...contract.ports, ask: {
    ...contract.ports.ask,
    session: { requestSchema: z.number(), inputSchema: z.number(), request: view => view,
      respond: (_view, value) => ({ valid: true, output: value }) }
  } } });
  assert.equal(unwrap(await game.run()).pause, 'unbound');
  unwrap(await game.close());
});

test('event delivery follows source order across players and restarts the same batch on retry', async () => {
  const game = await start('event', { ...fixture.contract, ports: { ...fixture.contract.ports,
    event: { kind: 'event', receive: event => ({ events: [event, event + 1], output: null }) }
  } });
  const seen: string[] = [];
  let pause = true;
  for (const player of ['b', 'a'] as const) unwrap(await game.bind({ player,
    onRequest: async () => ({ kind: 'reply', value: 1 }),
    onEvent: async delivery => {
      seen.push(`${player}:${delivery.event}:${delivery.id.index}`);
      return pause && player === 'a' && delivery.event === 2 ? { kind: 'pause' } : { kind: 'reply', value: null };
    }
  }));
  assert.equal(unwrap(await game.run()).pause, 'requested');
  assert.deepEqual(seen, ['a:1:0', 'b:1:0', 'a:2:1']);
  pause = false;
  assert.equal(unwrap(await game.run()).state.kind, 'ended');
  assert.deepEqual(seen.slice(3), ['a:1:0', 'b:1:0', 'a:2:1', 'b:2:1']);
  unwrap(await game.close());
});

test('adapter result envelopes reject undeclared fields at each projection boundary', async () => {
  const loaded = unwrap(await createNativeLoader().load(fixture.program));
  const instance = unwrap(await loaded.core.start('done'));
  expectCode(await createGameBinder().bind<G>({ instance, contract: {
    ...fixture.contract, ports: { ...fixture.contract.ports, ask: {
      ...fixture.contract.ports.ask,
      receive: view => ({ view, requests: [{ key: 'pick', player: 'a', type: 'pick', data: null }], extra: true })
    } }
  } }), 'invalid_output');
  const contracts: GContract[] = [
    { ...fixture.contract, finish: result => ({ view: result, result, extra: true }) },
    { ...fixture.contract, ports: { ...fixture.contract.ports,
      event: { kind: 'event', receive: event => ({ events: [event], output: null, extra: true }) }
    } },
    { ...fixture.contract, projectEvent: event => ({ event, extra: true }) }
  ];
  for (const contract of contracts) {
    const game = await start('event', contract);
    unwrap(await game.bind({ player: 'a', onRequest: async () => ({ kind: 'reply', value: 1 }),
      onEvent: async () => ({ kind: 'reply', value: null }) }));
    const stop = unwrap(await game.run());
    assert.equal(stop.state.kind, 'fault');
    if (stop.state.kind === 'fault') assert.equal(stop.state.error.code, 'invalid_output');
    assert.equal(stop.accepted?.kind, 'action');
    expectCode(await game.inspect(), 'game_closed');
  }
});
type GContract = GameModule<G>['contract'];

test('hidden events leave no gaps in each players visible event sequence', async () => {
  const game = await start('event', { ...fixture.contract,
    ports: { ...fixture.contract.ports, event: { kind: 'event', receive: () => ({ events: [0, 1, 2], output: null }) } },
    projectEvent: (event, player) => event === 0 && player === 'a' ? null : { event }
  });
  const seen: Record<string, number[][]> = { a: [], b: [] };
  for (const player of ['a', 'b'] as const) unwrap(await game.bind({ player,
    onRequest: async () => ({ kind: 'reply', value: 1 }),
    onEvent: async delivery => { seen[player]!.push([delivery.event, delivery.id.index]); return { kind: 'reply', value: null }; }
  }));
  assert.equal(unwrap(await game.run()).state.kind, 'ended');
  assert.deepEqual(seen, { a: [[1, 0], [2, 1]], b: [[0, 0], [1, 1], [2, 2]] });
  unwrap(await game.close());
});

test('the first valid reply wins before any later reply can invoke its adapter', async () => {
  const converted: string[] = [];
  const game = await start('done', {
    ...fixture.contract,
    ports: { ...fixture.contract.ports, ask: {
      ...fixture.contract.ports.ask,
      receive: view => ({ view, requests: [
        { key: 'first', player: 'a', type: 'pick', data: null },
        { key: 'second', player: 'b', type: 'pick', data: null }
      ] }),
      respond(_view, request, action) {
        converted.push(request.key);
        if (request.key === 'second') throw Error('losing adapter must never run');
        return { valid: true, output: action };
      }
    } }
  });
  for (const player of ['a', 'b'] as const) unwrap(await game.bind({ player,
    onRequest: async () => ({ kind: 'reply', value: 1 })
  }));
  const stop = unwrap(await game.run());
  assert.deepEqual(converted, ['first']);
  assert.equal(stop.state.kind, 'ended');
  assert.equal(stop.accepted?.kind, 'action');
  if (stop.accepted?.kind === 'action') assert.equal(stop.accepted.player, 'a');
  unwrap(await game.close());
});

test('action and control replies compete by completion order without source priority', async () => {
  for (const first of ['action', 'control'] as const) {
    const converted: string[] = [];
    const game = await start('done', { ...fixture.contract, ports: { ...fixture.contract.ports, ask: {
      ...fixture.contract.ports.ask,
      respond(_view, _request, action) { converted.push('action'); return { valid: true, output: action }; },
      session: {
        requestSchema: z.number(), inputSchema: z.number(), request: view => view,
        respond(_view, value) { converted.push('control'); return { valid: true, output: value }; }
      }
    } } });
    type Reply = { kind: 'reply'; value: number };
    let resolveAction!: (reply: Reply) => void, resolveControl!: (reply: Reply) => void;
    const action = new Promise<Reply>(resolve => { resolveAction = resolve; });
    const control = new Promise<Reply>(resolve => { resolveControl = resolve; });
    let actionReady!: () => void, controlReady!: () => void;
    const ready = Promise.all([
      new Promise<void>(resolve => { actionReady = resolve; }),
      new Promise<void>(resolve => { controlReady = resolve; })
    ]);
    unwrap(await game.bind({ player: 'a', onRequest: async () => { actionReady(); return await action; } }));
    assert.ok(game.bindControl);
    unwrap(await game.bindControl(async () => { controlReady(); return await control; }));
    const running = game.run();
    await ready;
    if (first === 'action') {
      resolveAction({ kind: 'reply', value: 1 });
      resolveControl({ kind: 'reply', value: 2 });
    } else {
      resolveControl({ kind: 'reply', value: 2 });
      resolveAction({ kind: 'reply', value: 1 });
    }
    const stop = unwrap(await running);
    assert.equal(stop.accepted?.kind, first);
    assert.deepEqual(converted, [first]);
    assert.deepEqual(stop.state, { kind: 'ended', result: first === 'action' ? 1 : 2 });
    unwrap(await game.close());
  }
});

test('an invalid candidate leaves other replies eligible; cancellation before selection accepts nothing', async () => {
  for (const cancel of [false, true]) {
    const cancellation = new AbortController();
    const converted: string[] = [];
    const game = await start('done', { ...fixture.contract, ports: { ...fixture.contract.ports, ask: {
      ...fixture.contract.ports.ask,
      receive: view => ({ view, requests: [
        { key: 'first', player: 'a', type: 'pick', data: null },
        { key: 'second', player: 'b', type: 'pick', data: null }
      ] }),
      respond(_view, request, action) {
        converted.push(request.key);
        if (request.key === 'first') {
          if (cancel) cancellation.abort();
          return { valid: false, reason: '' };
        }
        return { valid: true, output: action };
      }
    } } });
    const before = unwrap(await game.inspect());
    for (const player of ['a', 'b'] as const) unwrap(await game.bind({ player, onRequest: async () => ({ kind: 'reply', value: 1 }) }));
    const stop = unwrap(await game.run({ signal: cancellation.signal }));
    if (cancel) {
      assert.deepEqual(converted, ['first']);
      assert.deepEqual(stop, { state: before, accepted: null, pause: 'cancelled' });
    } else {
      assert.deepEqual(converted, ['first', 'second']);
      assert.equal(stop.accepted?.kind, 'action');
      if (stop.accepted?.kind === 'action') assert.equal(stop.accepted.player, 'b');
    }
    unwrap(await game.close());
  }
});
