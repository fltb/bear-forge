import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

async function differential(run: (input: any, io: any) => Promise<any>, input: unknown = null) {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run.toString()}};`).content);
  const parent = new ProgramExecution(artifact); parent.start(input);
  if (parent.result.status) {
    assert.equal(parent.result.status, 1, String(parent.result.value));
    assert.deepEqual(parent.result.value, await run(input, {})); return;
  }
  const branch = parent.fork(), restored = new ProgramExecution(artifact); restored.restore(parent.snapshot());
  for (const [index, current] of [parent, branch, restored].entries()) {
    const reply = index + 3;
    const expected = await run(input, { call: async () => reply });
    current.resume(reply);
    assert.equal(current.result.status, 1, String(current.result.value));
    assert.deepEqual(current.result.value, expected, ['parent', 'fork', 'restore'][index]!);
  }
}

test('delegation records retain cached next and original yielded-result identity through fork/restore', async () => {
  await differential(async function run(n, io) {
    let gets = 0, calls = 0;
    const yielded = { value: 1, done: false, extra: 'preserved' };
    const source: any = { [Symbol.iterator]() { return this; }, get next() {
      gets++;
      return function(...args: unknown[]) {
        calls++; Object.defineProperty(source, 'next', { value: () => ({ done: true, value: 99 }), configurable: true });
        return calls < 3 ? yielded : { done: true, value: args[0] };
      };
    } };
    function* values(): Generator<any, unknown, unknown> { return yield* source; }
    const iterator = values(), first = iterator.next();
    const reply = await io.call({ port: 'step', input: first.value });
    const second = iterator.next(5), last = iterator.next(reply);
    return [first === yielded, second === yielded, gets, calls, last];
  });
});

test('each acquisition retains its own next method even when the iterable returns itself', async () => {
  await differential(async function run(n, io) {
    let acquisitions = 0;
    const source = { [Symbol.iterator]() { return this; }, get next() {
      const id = ++acquisitions;
      return () => ({ value: id, done: false });
    } };
    function* values() { yield* source; }
    const a = values(), b = values(), first = [a.next().value, b.next().value];
    await io.call({ port: 'step', input: first });
    return [first, a.next().value, b.next().value, acquisitions];
  });
});

test('delegated throw and return getters run once and receive the requested completion', async () => {
  await differential(async function run(n, io) {
    const log: unknown[] = [];
    const source = { [Symbol.iterator]() { return this; }, next(...args: unknown[]) { log.push(['next', args]); return { done: false, value: 1 }; },
      get throw() { log.push('get throw'); return (...args: unknown[]) => { log.push(['throw', args]); return { done: false, value: 2 }; }; },
      get return() { log.push('get return'); return (...args: unknown[]) => { log.push(['return', args]); return { done: true, value: args[0] }; }; } };
    function* values(): Generator<any, unknown, unknown> { return yield* source; }
    const iterator = values(), first = iterator.next();
    await io.call({ port: 'step', input: first.value });
    const raised = iterator.throw('reason'), result = iterator.return(7);
    return [first, raised, result, log];
  });
});

test('missing throw closes once without a value argument and then throws TypeError', async () => {
  await differential(async function run() {
    const log: unknown[] = [];
    const source: any = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; },
      get throw() { log.push('get throw'); return undefined; },
      get return() { log.push('get return'); return (...args: unknown[]) => { log.push(args); return { done: false, value: 2 }; }; } };
    function* values() { yield* source; }
    const iterator = values(); iterator.next();
    try { iterator.throw(9); } catch (error) { log.push((error as Error).name); }
    return log;
  });
});

test('primitive next/throw/return results fail without an extra iterator close', async () => {
  for (const mode of ['next', 'throw', 'return']) await differential(async function run(mode) {
    const log: string[] = [];
    const source: any = { [Symbol.iterator]() { return this; }, next() { log.push('next'); return mode === 'next' ? 1 : { done: false, value: 1 }; },
      throw() { log.push('throw'); return 1; }, return() { log.push('return'); return 1; } };
    function* values() { yield* source; }
    const iterator = values();
    try { iterator.next(); if (mode === 'throw') iterator.throw(1); if (mode === 'return') iterator.return(); }
    catch (error) { log.push((error as Error).name); }
    return log;
  }, mode);
});

test('async iteration awaits synchronous iterator values and preserves continuation state', async () => {
  await differential(async function run(n, io) {
    const first = await io.call({ port: 'step', input: 0 }), output: unknown[] = [];
    for await (const item of [Promise.resolve(first), Promise.resolve(first + 1)]) output.push(item);
    async function* values() { return yield* [Promise.resolve(first + 2), Promise.resolve(first + 3)]; }
    const iterator = values(); output.push(await iterator.next(), await iterator.next(), await iterator.next());
    return output;
  });
});

test('async iterator factories and next accessors are acquired once', async () => {
  await differential(async function run(n, io) {
    const log: string[] = []; let index = 0;
    const source = { get [Symbol.asyncIterator]() { log.push('factory getter'); return function() { return source; }; },
      get next() { log.push('next getter'); return async () => { log.push(`next ${index}`); return { done: index >= 2, value: index++ }; }; } };
    async function* values() { yield* source; }
    const iterator = values(), first = await iterator.next();
    await io.call({ port: 'step', input: first.value });
    return [first, await iterator.next(), await iterator.next(), log];
  });
});

test('delegation can yield during return and accept another abrupt completion before outer finally', async () => {
  await differential(async function run(n, io) {
    const log: unknown[] = [];
    const source = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; },
      return(value: unknown) { log.push(['return', value]); return { done: false, value }; },
      throw(value: unknown) { log.push(['throw', value]); return { done: true, value }; } };
    function* values(): Generator<any, unknown, unknown> { try { return yield* source; } finally { log.push('finally'); } }
    const iterator = values(), first = iterator.next(), second = iterator.return(2);
    const reply = await io.call({ port: 'step', input: second.value });
    return [first, second, iterator.return(4), iterator.throw(reply), log];
  });
});

test('delegate failures propagate to the outer catch without closing the delegate', async () => {
  await differential(async function run() {
    const log: string[] = [];
    const source: any = { [Symbol.iterator]() { return this; }, next() { throw 7; },
      return() { log.push('return'); return { done: true }; }, throw() { log.push('throw'); return { done: true }; } };
    function* values() { try { yield* source; } catch (error) { log.push(String(error)); } finally { log.push('finally'); } }
    const iterator = values(); return [iterator.next(), log];
  });
});

test('earlier expression operands are evaluated before later mutations', async () => {
  await differential(async function run(n, io) {
    let index = 0;
    function step() { return [{ prior: index >= 1, value: index++ }, [index + 1, index++], (index < 4) === (index++ < 4)]; }
    const first = step(); await io.call({ port: 'step', input: first });
    return [first, step(), index];
  });
});

test('async delegated return receives the awaited completion and preserves outer finally', async () => {
  await differential(async function run(n, io) {
    const log: unknown[] = [];
    const source = { [Symbol.asyncIterator]() { return this; }, async next() { return { done: false, value: 1 }; },
      async return(value: unknown) { log.push(value); return { done: true, value }; } };
    async function* values(): AsyncGenerator<any, unknown, unknown> { try { return yield* source; } finally { log.push('finally'); } }
    const iterator = values(), first = await iterator.next();
    const reply = await io.call({ port: 'step', input: first.value });
    return [first, await iterator.return(Promise.resolve(reply)), log];
  });
});

test('lexical and property updates perform numeric conversion exactly once', async () => {
  await differential(async function run(n, io) {
    const calls: unknown[] = [];
    let text: any = '1', big: any = 3n;
    let value: any = { [Symbol.toPrimitive](hint: string) { calls.push(hint); return '7'; } };
    const first = [text++, text, big--, big, ++value, value];
    await io.call({ port: 'step', input: null });
    const holder: any = { value: { valueOf() { calls.push('valueOf'); return 9n; } } };
    return [first, holder.value++, holder.value, calls];
  });
});
