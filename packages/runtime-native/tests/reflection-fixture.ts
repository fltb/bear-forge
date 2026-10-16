import { z } from 'zod';

export const program = {
  schemas: { setup: z.number(), ports: { step: { input: z.unknown(), output: z.number() } }, result: z.unknown() },
  async run(input: number, io: any) {
    let count = input;
    const trace: unknown[] = [String(hoisted)];
    function hoisted(x = 2) { /* source identity */ return count + x; }
    const arrow = (x = 1) => count + x;
    async function asynchronous(x = count) { var x = x + 1; return x; }
    const namedAsync = async function self(x: any = self): Promise<unknown> { var x = x; return [x === self, self === namedAsync]; };
    const asyncArrow = async (x = count) => { var x = x + 2; return x; };
    function* generator(x = (trace.push('sync parameter'), count)) { trace.push('sync body'); yield x; }
    async function* asyncGenerator(x = (trace.push('async parameter'), count)) { trace.push('async body'); yield x; }
    const namedGenerator = function* self(x = count): Generator<unknown> { yield [x, self === namedGenerator]; };
    const asyncNamedGenerator = async function* self(x = count): AsyncGenerator<unknown> { yield [x, self === asyncNamedGenerator]; };
    const generatorObject = { *method(x = count) { yield [x, this === generatorObject]; } };
    const key = 'item', symbol = Symbol('method');
    const object = {
      namedArrow: (x = 3) => count + x,
      ['computedArrow']: (x = 4) => count + x,
      async asynchronous(x = count) { var x = x + 3; return [x, this === object]; },
      [key](x = 3) { return count + x; },
      [symbol]() { return count; },
      get value() { return count; },
      set value(next: number) { count = next; }
    };
    class Base {
      method() { return count; }
      async asynchronous(x = count) { var x = x + 4; return [x, this instanceof Base]; }
      static /* static is outside method source */ get value() { return count; }
    }
    class Explicit extends Base { constructor() { super(); } method() { return super.method(); } }
    class Implicit extends Base {}
    const chosen = input ? () => count : function named() { return count; };
    function makeArrow(this: { tag: string }, value: number) {
      return (next = count) => [this.tag, arguments[0], new.target === undefined, next];
    }
    const lexical = makeArrow.call({ tag: 'original receiver' }, input + 2);
    let constructRejected = false;
    try { Reflect.construct(Object, [], lexical); } catch (error) { constructRejected = error instanceof TypeError; }
    switch (input) {
      case (trace.push(String(inSwitch)), 0):
        trace.push(String(inSwitch));
        break;
      default:
        trace.push(String(inSwitch));
        function inSwitch() { return count; }
    }
    switch (input) {
      default:
        trace.push(String(defaultOnly));
        function defaultOnly() { return count; }
    }
    switch (input) {
      case 0:
        // @ts-expect-error ECMAScript function bindings are mutable; TS disallows this assignment.
        reassigned = () => count + 4;
      default:
        trace.push(String(reassigned));
        function reassigned() { return count; }
    }
    const descriptor = Object.getOwnPropertyDescriptor(object, 'value')!;
    const callables = [hoisted, arrow, asynchronous, namedAsync, asyncArrow, object.asynchronous, Base.prototype.asynchronous,
      generator, asyncGenerator, object.item, object[symbol], object.namedArrow, object.computedArrow,
      descriptor.get!, descriptor.set!, Base, Base.prototype.method,
      Object.getOwnPropertyDescriptor(Base, 'value')!.get!, Explicit, Explicit.prototype.method, Implicit, chosen, hoisted.bind(null)];
    const reflect = () => callables.map(fn => [fn.toString(), Function.prototype.toString.call(fn),
      String(fn), [fn].join(''), '' + fn, `${fn}`, fn.name, fn.length, Object.hasOwn(fn, 'prototype')]);
    const before = reflect();
    const asyncPrototype = Object.getPrototypeOf(async function() {});
    const asyncKinds = [asynchronous, namedAsync, asyncArrow, object.asynchronous, Base.prototype.asynchronous].map(fn => {
      let constructible = false;
      try { Reflect.construct(Object, [], fn); constructible = true; } catch {}
      return [constructible, Object.hasOwn(fn, 'prototype'), Object.getPrototypeOf(fn) === asyncPrototype];
    });
    const generatorKind = [generator, asyncGenerator, namedGenerator, generatorObject.method].map(fn => {
      let constructible = false;
      try { Reflect.construct(Object, [], fn); constructible = true; } catch {}
      return [constructible, Object.getOwnPropertyDescriptor(fn, 'prototype')?.writable];
    });
    const waiting = generator(), waitingAsync = asyncGenerator();
    const eager = trace.slice();
    const samePrototype = Object.getPrototypeOf(waiting) === generator.prototype && Object.getPrototypeOf(waitingAsync) === asyncGenerator.prototype;
    const syncBase = Object.getPrototypeOf(generator.prototype), asyncBase = Object.getPrototypeOf(asyncGenerator.prototype);
    const customPrototype = Object.create(generator.prototype);
    (generator as any).prototype = customPrototype;
    count = await io.call({ port: 'step', input: before });
    const custom = Object.getPrototypeOf(generator()) === customPrototype;
    (generator as any).prototype = null; (asyncGenerator as any).prototype = 0;
    const fallback = [Object.getPrototypeOf(generator()) === syncBase, Object.getPrototypeOf(asyncGenerator()) === asyncBase];
    const failures: unknown[] = [];
    function* broken(x = (() => { throw 'sync parameter'; })()) { yield x; }
    async function* asyncBroken(x = (() => { throw 'async parameter'; })()) { yield x; }
    try { broken(); failures.push('missed sync'); } catch (error) { failures.push(error); }
    try { asyncBroken(); failures.push('missed async'); } catch (error) { failures.push(error); }
    const pending = asynchronous().then(value => { trace.push('async fulfilled'); return value; });
    const queued = Promise.resolve().then(() => { trace.push('queued'); });
    await queued;
    const lookup: Record<string, number> = { [arrow as any]: count };
    return { before, after: reflect(), trace, count: hoisted(), names: Object.keys(lookup),
      found: Object.hasOwn(lookup, arrow as any), equal: (arrow as any) == String(arrow),
      lexical: lexical.call({ tag: 'different receiver' }), constructRejected,
      generatorKind, eager, samePrototype, custom, fallback, failures, asyncKinds,
      asyncResult: await pending, asyncSelf: await namedAsync(), asyncArrow: await asyncArrow(),
      asyncMethod: await object.asynchronous(), asyncClass: await new Base().asynchronous(),
      waiting: waiting.next(), waitingAsync: await waitingAsync.next(), named: namedGenerator().next(), asyncNamed: await asyncNamedGenerator().next(), method: generatorObject.method().next(),
      value: new Explicit().method(), iterator: generator().next().value };
  }
};
