import { z } from 'zod';
export const program = {
  schemas: { setup: z.null(), result: z.array(z.unknown()), ports: { step: { input: z.null(), output: z.number() } } },
  async run(_input: null, io: { call: (call: { port: 'step'; input: null }) => Promise<number> }) {
    const trace: string[] = [], key = Symbol('amount');
    const computed = { [Symbol.toPrimitive](hint: string) { trace.push(hint); return key; } };
    const method = 7;
    class Base {
      value: number;
      target: Function | undefined;
      constructor(value = (trace.push('default'), 2)) { this.value = value; this.target = new.target; }
      method() { return [method, this.value]; }
      accept(value: number) { return value; }
      static method() { return 4; }
      get [computed as any]() { return this.value; }
      set [computed as any](value: number) { this.value = value; }
    }
    for (const method of [Base.prototype.method, Base.prototype.accept, Base.method]) Object.defineProperty(method, 'apply', {
      get() { throw new Error('Unexpected super apply'); }
    });
    class Child extends Base {
      override method() { return super.method(); }
      static optional() { return super.method?.(); }
      async receive(io: { call: (call: { port: 'step'; input: null }) => Promise<number> }) {
        return super.accept(await io.call({ port: 'step', input: null }));
      }
    }
    Object.defineProperty(Child.prototype, 'constructor', { get() { trace.push('child-constructor'); return Alternate; }, configurable: true });
    Object.defineProperty(Alternate.prototype, 'constructor', { get() { trace.push('alternate-constructor'); return Base; }, configurable: true });
    const instance = new Child();
    instance.value = await instance.receive(io);
    const descriptor = Object.getOwnPropertyDescriptor(Base.prototype, key)!;
    const shapes = [Base.prototype.method, Base.method, descriptor.get!, descriptor.set!].map(fn => {
      let constructable: boolean | string;
      try { Reflect.construct(function () {}, [], fn); constructable = true; }
      catch (error) { constructable = (error as Error).name; }
      return [fn.name, fn.length, Object.hasOwn(fn, 'prototype'), constructable];
    });
    const calls: string[] = [];
    for (const C of [Base, Child]) {
      try { (C as any).call(instance); calls.push('accepted'); }
      catch (error) { calls.push((error as Error).name); }
    }
    function Alternate() {}
    const alternate = Reflect.construct(Child, [8], Alternate);
    class Retry extends Base {
      constructor() {
        super(11);
        try { super(12); } catch (error) { trace.push((error as Error).name); }
      }
    }
    const retry = new Retry();
    const values = [1, 2];
    values[Symbol.iterator] = function () {
      let index = 0;
      return { next() { return index < 2 ? { value: 7 + index++, done: false } : { value: undefined, done: true }; } } as ArrayIterator<number>;
    };
    function receive(...args: number[]) { return args; }
    Object.defineProperty(receive, 'apply', { value() { throw new Error('Unexpected apply'); } });
    const spread = [0, ...values, 9], call = receive(...values);
    const object = { value: 7, method(argument: number) { return [this.value, argument]; } };
    for (const key of ['call', 'bind']) Object.defineProperty(object.method, key, {
      get() { throw new Error('Unexpected function property'); }
    });
    const optional = [object.method?.(3), (object?.method)(4)];
    const missing: any = null;
    let invalidCall = '';
    try { (missing?.method)(trace.push('argument')); }
    catch (error) { invalidCall = (error as Error).name; }
    function convert(hint: string) { trace.push(hint); return 'field'; }
    Object.defineProperty(convert, 'call', { get() { throw new Error('Unexpected coercion call'); } });
    const fieldKey = { [Symbol.toPrimitive]: convert };
    // The coercion returns this literal; TS cannot express object-valued keys.
    const typedKey = fieldKey as unknown as 'field';
    class Box { [typedKey] = 7; }
    const { [typedKey]: picked, ...rest } = { field: 3, other: 4 };
    const keys = [Object.keys(new Box()), Object.keys(new Box()), picked, rest];
    const late = Symbol('late');
    const restSource: Record<PropertyKey, unknown> = { skip: 0, get first() { restSource[late] = 9; return 1; } };
    Object.defineProperty(restSource, '__proto__', { value: { hidden: 3 }, enumerable: true });
    const { skip, ...copied } = restSource;
    const restShape = [Object.hasOwn(copied, '__proto__'), Object.getPrototypeOf(copied) === Object.prototype,
      Object.getOwnPropertySymbols(copied).length, copied.first];
    const spreadSymbol = Symbol('spread');
    const spreadSource: Record<PropertyKey, unknown> = { get first() {
      Object.defineProperty(spreadSource, spreadSymbol, { enumerable: true }); return 1;
    } };
    Object.defineProperty(spreadSource, spreadSymbol, { value: 2, configurable: true });
    const spreadParent = { answer: 7 };
    const spreadObject = { ...spreadSource, __proto__: spreadParent, method() { return super.answer; } };
    const spreadShape = [Reflect.get(spreadObject, spreadSymbol), Object.getPrototypeOf(spreadObject) === spreadParent, spreadObject.method()];
    Object.setPrototypeOf(spreadObject, { answer: 8 });
    spreadShape.push(spreadObject.method());
    let current = 1;
    const iteratorTrace: string[] = [];
    const iterable: Iterable<number | undefined> = { [Symbol.iterator]() { let index = 0; return {
      next() { iteratorTrace.push('next'); return { value: index++ === 0 ? undefined : current, done: false }; },
      return() { iteratorTrace.push('close'); return { value: undefined, done: true }; }
    }; } };
    const [first = (iteratorTrace.push('default'), current = 3), second] = iterable;
    let failure = '';
    try { const [value = (() => { throw new Error('default'); })()] = iterable; }
    catch (error) { failure = (error as Error).message; }
    const iteratorShape = [first, second, failure, iteratorTrace];
    const assignmentTarget: { value?: number } = {};
    function assignmentReference() { iteratorTrace.push('reference'); return assignmentTarget; }
    [assignmentReference().value = (iteratorTrace.push('default'), 4)] = iterable;
    iteratorShape.push(assignmentTarget.value);
    const forTrace: string[] = []; let forIndex = 0;
    function forAcquire() { return {
      get next() { forTrace.push('next-get'); return () => ({ value: forIndex++, done: false }); },
      get return() { forTrace.push('return-get'); return () => ({ done: true, value: undefined }); }
    }; }
    Object.defineProperty(forAcquire, 'call', { get() { throw new Error('Unexpected iterator call'); } });
    for (const value of { [Symbol.iterator]: forAcquire }) { if (value === 1) break; }
    const asyncTrace: unknown[] = [];
    let asyncRead: (() => number) | undefined;
    for await (const value of (asyncRead = (): number => value, [] as number[])) {}
    try { asyncRead?.(); } catch (error) { asyncTrace.push((error as Error).name); }
    const asyncTarget = { set value(value: number) { asyncTrace.push(value); } };
    for await (asyncTarget.value of [4, 5]) {}
    const reads: (() => number)[] = [];
    outer: inner: for await (let value of [1, 2, 3]) {
      reads.push(() => value);
      try { if (value < 3) continue outer; break inner; }
      finally { asyncTrace.push(value); }
    }
    asyncTrace.push(reads.map(read => read()));
    let propertyRead: (() => string) | undefined;
    for (let property in (propertyRead = (): string => property, { a: 1, b: 2 })) asyncTrace.push(property);
    try { propertyRead?.(); } catch (error) { asyncTrace.push((error as Error).name); }
    return [trace, shapes, calls, instance.method(), instance.target === Child, alternate.value,
      alternate.target === Alternate, Object.getPrototypeOf(alternate) === Alternate.prototype, retry.value, spread, call, optional, invalidCall, Child.optional(), keys, restShape, spreadShape, iteratorShape, forTrace, asyncTrace];
  }
};
