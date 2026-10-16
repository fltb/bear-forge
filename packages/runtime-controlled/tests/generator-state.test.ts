import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJavaScript } from '@bear-forge/compiler';
import { ProgramExecution, decode } from '../src/execution.ts';

async function compare(run: (input: any, io: any) => Promise<any>, input: unknown = null) {
  const artifact = decode(compileJavaScript(`export const program={schemas:{},run:${run}}`).content);
  const parent = new ProgramExecution(artifact); parent.start(input);
  if (parent.result.status) {
    assert.equal(parent.result.status, 1, String(parent.result.value));
    assert.deepEqual(parent.result.value, await run(input, {})); return;
  }
  const restored = parent.fresh(); restored.restore(parent.snapshot());
  for (const [index, instance] of [parent, parent.fork(), restored].entries()) {
    const reply = index + 3, expected = await run(input, { call: async () => reply });
    instance.resume(reply);
    assert.equal(instance.result.status, 1, String(instance.result.value));
    assert.deepEqual(instance.result.value, expected, ['parent', 'fork', 'restore'][index]!);
  }
}

test('sync generator completion states never restart the body or execute an unstarted finally', async () => {
  for (const first of ['next', 'throw', 'return']) await compare(async function run(first, io) {
    const log: unknown[] = [];
    function* values() { try { log.push('start'); yield 1; return 2; } finally { log.push('finally'); } }
    const iterator: any = values(), results: unknown[] = [];
    try { results.push(iterator[first](8)); } catch (error) { results.push(['error', error]); }
    await io.call({ port: 'step', input: null });
    for (const method of ['next', 'next', 'throw', 'return', 'next']) {
      try { results.push(iterator[method](9)); } catch (error) { results.push(['error', error]); }
    }
    return [results, log];
  }, first);
});

test('sync reentrant requests reject before modifying the running continuation', async () => {
  for (const method of ['next', 'throw', 'return']) await compare(async function run(method) {
    const log: unknown[] = []; let iterator: any;
    function* values() {
      try { iterator[method](9); } catch (error) { log.push((error as Error).name); }
      log.push('after'); yield 1; log.push('finish'); return 2;
    }
    iterator = values(); return [iterator.next(), iterator.next(), iterator.next(), log];
  }, method);
});

test('async completion states settle requests without reentering finished code', async () => {
  for (const first of ['next', 'throw', 'return']) await compare(async function run(first, io) {
    const log: unknown[] = [];
    async function* values() { try { log.push('start'); yield 1; return 2; } finally { log.push('finally'); } }
    const iterator: any = values(), results: unknown[] = [];
    try { results.push(await iterator[first](8)); } catch (error) { results.push(['error', error]); }
    await io.call({ port: 'step', input: null });
    for (const method of ['next', 'next', 'throw', 'return', 'next']) {
      try { results.push(await iterator[method](9)); } catch (error) { results.push(['error', error]); }
    }
    try { results.push(await iterator.return(Promise.reject(10))); } catch (error) { results.push(['error', error]); }
    return [results, log];
  }, first);
});

test('async queued requests survive IO fork and settle in request order', async () => {
  await compare(async function run(input, io) {
    const log: unknown[] = [];
    async function* values() {
      try { const reply = await io.call({ port: 'step', input: null }); yield reply; yield reply + 1; return reply + 2; }
      finally { log.push('finally'); }
    }
    const iterator = values();
    const results = await Promise.allSettled([iterator.next(), iterator.next(), iterator.return(9), iterator.throw(10), iterator.next()]);
    return [results, log];
  });
});


test('async queued requests settle the current failure before dispatching later requests', async () => {
  for (const mode of ['normal', 'throw', 'return', 'reject-return']) await compare(async function run(mode, io) {
    const log: unknown[] = [];
    async function* values(): AsyncGenerator<number, number, unknown> {
      try { const reply = await io.call({ port: 'step', input: null }); yield reply; throw 'body-error'; }
      finally { log.push('finally'); }
    }
    const iterator = values();
    const first = iterator.next();
    const second = mode === 'throw' ? iterator.throw('injected-error') :
      mode === 'return' ? iterator.return(9) :
      mode === 'reject-return' ? iterator.return(Promise.reject('return-error')) : iterator.next();
    return [await Promise.allSettled([first, second, iterator.next(), iterator.throw('after'), iterator.return(11)]), log];
  }, mode);
});

test('generator methods validate their own receiver kind and async failures reject promises', async () => {
  await compare(async function run() {
    function* sync() { yield 1; }
    async function* asyncValues() { yield 2; }
    const a = sync(), b = asyncValues(), log: unknown[] = [];
    for (const method of ['next', 'throw', 'return']) {
      try { (a as any)[method].call(b, 3); } catch (error) { log.push(['sync', (error as Error).name]); }
      let promise;
      try { promise = (b as any)[method].call(a, 4); } catch (error) { log.push(['unexpected-sync-throw', (error as Error).name]); }
      try { await promise; } catch (error) { log.push(['async', (error as Error).name]); }
    }
    return [log, a.next(), await b.next()];
  });
});

test('lowered generator parameters retain callable kind, eager effects, prototype aliases and named self across IO', async () => {
  await compare(async function run(_input, io) {
    const trace: unknown[] = [];
    let value = 2;
    function initial() { trace.push(['parameter', value]); return value; }
    function* values(this: any, x = initial()) { trace.push(['body', value]); yield [x, this.tag, arguments.length]; return value; }
    async function* asyncValues(this: any, x = initial()) { trace.push(['async body', value]); yield [x, this.tag, arguments.length]; return value; }
    const named = function* self(x: any = self): Generator<any> { yield [x === named, self === named]; };
    const asyncNamed = async function* self(x: any = self): AsyncGenerator<any> { yield [x === asyncNamed, self === asyncNamed]; };
    const object = { *method({ x } = { x: initial() }) { yield [x, this === object]; },
      async *asyncMethod({ x } = { x: initial() }) { yield [x, this === object]; } };
    const syncBase = Object.getPrototypeOf((function*() {}).prototype), asyncBase = Object.getPrototypeOf((async function*() {}).prototype);
    const functions = [values, asyncValues, named, asyncNamed, object.method, object.asyncMethod];
    const kinds = functions.map((fn, index) => {
      let constructible = false;
      try { Reflect.construct(Object, [], fn); constructible = true; } catch {}
      const descriptor = Object.getOwnPropertyDescriptor(fn, 'prototype')!;
      return [constructible, descriptor.writable, descriptor.configurable, descriptor.enumerable,
        Object.getPrototypeOf(fn.prototype) === (index % 2 ? asyncBase : syncBase)];
    });
    const originalPrototype: any = values.prototype;
    const customPrototype: any = Object.create(originalPrototype);
    customPrototype.marker = 7;
    (values as any).prototype = customPrototype;
    const iterator = values.call({ tag: 'sync' }), asyncIterator = asyncValues.call({ tag: 'async' });
    const selfIterator = named(), asyncSelfIterator = asyncNamed(), methodIterator = object.method(), asyncMethodIterator = object.asyncMethod();
    const before = trace.slice();
    value = await io.call({ port: 'step', input: before });
    customPrototype.marker += value;
    const aliases = [Object.getPrototypeOf(iterator) === customPrototype, Object.getPrototypeOf(iterator) === values.prototype,
      Object.getPrototypeOf(asyncIterator) === asyncValues.prototype, (iterator as any).marker];
    const results = [iterator.next(), await asyncIterator.next(), selfIterator.next(), await asyncSelfIterator.next(),
      methodIterator.next(), await asyncMethodIterator.next(), iterator.next(), await asyncIterator.next()];
    (values as any).prototype = null; (asyncValues as any).prototype = 1;
    const fallback = [Object.getPrototypeOf(values.call({ tag: 'fallback' })) === syncBase,
      Object.getPrototypeOf(asyncValues.call({ tag: 'fallback' })) === asyncBase];
    const errors: unknown[] = [];
    function* broken(x = (() => { throw 'sync default'; })()) { yield x; }
    async function* asyncBroken(x = (() => { throw 'async default'; })()) { yield x; }
    try { broken(); errors.push('missed sync'); } catch (error) { errors.push(error); }
    try { asyncBroken(); errors.push('missed async'); } catch (error) { errors.push(error); }
    return { before, trace, kinds, aliases, results, fallback, errors };
  });
});
