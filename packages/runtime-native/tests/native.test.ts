import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createNativeLoader } from '../src/index.ts';
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
const program = {
  schemas: {
    setup: z.number(),
    result: z.number(),
    ports: {
      input: {
        input: z.number(),
        output: z.number()
      }
    }
  },
  async run(n: number, io: any) {
    const a = await io.call({
      port: 'input',
      input: n
    });
    const b = await io.call({
      port: 'input',
      input: a
    });
    return a + b;
  }
};
test('trusted direct ProgramModule executes its host closure as ordinary JS', async () => {
  let clockReads = 0;
  const readClock = () => { clockReads++; return Date.now(); };
  const direct = {
    schemas: { setup: z.null(), result: z.number(), ports: {} },
    async run() { return readClock(); }
  };
  const { core } = unwrap(await createNativeLoader().load(direct));
  const instance = unwrap(await core.start(null));
  const stop = unwrap(await instance.inspect());
  assert.equal(clockReads, 1);
  assert.equal(stop.kind, 'done');
  if (stop.kind === 'done') assert.equal(typeof stop.result, 'number');
  await instance.close();
});
test('native execution accepts exactly one return and isolates boundary values', async () => {
  const {
    core
  } = unwrap(await createNativeLoader().load(program));
  const x = unwrap(await core.start(2));
  let calls = 0;
  unwrap(await x.bind({
    input: async () => ({
      kind: 'reply',
      value: ++calls
    })
  }));
  const one = unwrap(await x.run());
  assert.equal(one.accepted, true);
  assert.equal(one.state.kind, 'call');
  assert.equal(calls, 1);
  const two = unwrap(await x.run());
  assert.deepEqual(two.state, {
    kind: 'done',
    result: 3
  });
  assert.equal(unwrap(await x.run()).accepted, false);
});
test('cancellation discards a late callback; ownership transfer invalidates old handle', async () => {
  const {
    core
  } = unwrap(await createNativeLoader().load(program));
  const x = unwrap(await core.start(0));
  let late!: (x: any) => void;
  let begin!: () => void;
  const began = new Promise<void>(r => {
    begin = r;
  });
  unwrap(await x.bind({
    input: async () => {
      begin();
      return new Promise(r => {
        late = r;
      });
    }
  }));
  const cancel = new AbortController(),
    running = x.run({
      signal: cancel.signal
    });
  await began;
  const snapshot = unwrap(await x.inspect());
  assert.equal(snapshot.kind, 'call');
  assert.equal((await x.bind(null)).ok, false);
  cancel.abort();
  assert.equal(unwrap(await running).pause, 'cancelled');
  late({
    kind: 'reply',
    value: 99
  });
  assert.deepEqual(unwrap(await x.inspect()), snapshot);
  const transferred = unwrap(await x.transfer());
  assert.equal((await x.inspect()).ok, false);
  assert.equal(unwrap(await transferred.run()).pause, 'unbound');
});
test('protocol fault cannot be caught into a successful return', async () => {
  const p = {
    schemas: program.schemas,
    async run(_n: number, io: any) {
      try {
        await io.call({
          port: 'unknown',
          input: 0
        });
      } catch {}
      return 3;
    }
  };
  const {
    core
  } = unwrap(await createNativeLoader().load(p));
  const x = unwrap(await core.start(0));
  const state = unwrap(await x.inspect());
  assert.equal(state.kind, 'fault');
  if (state.kind === 'fault') assert.equal(state.error.code, 'invalid_output');
  assert.equal((await core.start('bad' as never)).ok, false);
});
test('capture pagination, original boundary records and release lifecycle are strict', async () => {
  const loaded = unwrap(await createNativeLoader().load(program)),
    x = unwrap(await loaded.core.start(4));
  assert.equal((await loaded.capture!.read(x.id, {
    after: null,
    limit: 0
  })).ok, false);
  assert.equal((await loaded.capture!.release(x.id)).ok, false);
  unwrap(await x.bind({
    input: async () => ({
      kind: 'reply',
      value: 2
    })
  }));
  unwrap(await x.run());
  unwrap(await x.run());
  const records: any[] = [];
  let after: number | null = null;
  do {
    const page: any = unwrap(await loaded.capture!.read(x.id, {
      after,
      limit: 2
    }));
    records.push(...page.records);
    after = page.next;
  } while (after !== null);
  assert.deepEqual(records.map(r => r.kind), ['started', 'called', 'returned', 'called', 'returned', 'completed']);
  assert.equal((await loaded.capture!.read(x.id, {
    after: 1000,
    limit: 1
  })).ok, false);
  unwrap(await x.close());
  unwrap(await loaded.capture!.release(x.id));
  unwrap(await loaded.capture!.release(x.id));
  assert.equal((await loaded.capture!.read(x.id, {
    after: null,
    limit: 1
  })).ok, false);
});
