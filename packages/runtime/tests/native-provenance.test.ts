import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programCapabilities } from '../src/program-code.ts';
import { checkAccessor, checkNativeEntry } from '../src/native-policy.ts';
import { createOperations } from '../src/operations.ts';

const symbolReceiver = Symbol('x');
const admittedPrototypeProfiles: [object, () => unknown][] = [
  [Object.prototype, () => ({})], [Array.prototype, () => [1, 2, 3]],
  [Map.prototype, () => new Map([['x', 1]])], [Set.prototype, () => new Set([1, 2])],
  [WeakMap.prototype, () => new WeakMap()], [WeakSet.prototype, () => new WeakSet()],
  [RegExp.prototype, () => /x/g], [Error.prototype, () => new Error('x')],
  [Function.prototype, () => function f() { return 1; }],
  [ArrayBuffer.prototype, () => new ArrayBuffer(8)],
  [DataView.prototype, () => new DataView(new ArrayBuffer(8))],
  [Object.getPrototypeOf(Uint8Array.prototype), () => new Uint8Array([1, 2, 3])],
  [String.prototype, () => 'abc'], [Number.prototype, () => 3],
  [Boolean.prototype, () => true], [BigInt.prototype, () => 3n],
  [Symbol.prototype, () => symbolReceiver],
];

function completion(run: () => unknown) {
  try {
    const value = run();
    return value === null || typeof value !== 'object' && typeof value !== 'function'
      ? { kind: 'return', value } : { kind: 'return' };
  } catch (error) {
    return {kind: 'throw', name: (error as Error).name, message: (error as Error).message};
  }
}

test('admitted prototype methods preserve V8 primitive-receiver completion', () => {
  const operations = createOperations();
  const receivers = [null, undefined, 1, 'x', true, Symbol('s')];
  let methods = 0;
  for (const [prototype] of admittedPrototypeProfiles) for (const key of Reflect.ownKeys(prototype)) {
    const method = Object.getOwnPropertyDescriptor(prototype, key)?.value;
    if (typeof method !== 'function' || key === 'constructor') continue;
    try { checkNativeEntry(method); } catch { continue; }
    methods++;
    for (const receiver of receivers) {
      assert.deepEqual(completion(() => operations.invoke(method, receiver, [])),
        completion(() => Reflect.apply(method, receiver, [])),
        `${prototype.constructor?.name}.${String(key)} on ${String(receiver)}`);
    }
  }
  assert.ok(methods >= 180, `Primitive receiver comparison reached only ${methods} admitted methods`);
});

test('admitted prototype methods preserve V8 completion on ordinary receivers', () => {
  const operations = createOperations();
  let cases = 0;
  for (const [prototype, receiver] of admittedPrototypeProfiles) for (const key of Reflect.ownKeys(prototype)) {
    const method = Object.getOwnPropertyDescriptor(prototype, key)?.value;
    if (typeof method !== 'function' || key === 'constructor') continue;
    try { checkNativeEntry(method); } catch { continue; }
    for (const args of [[], [0], ['x']]) {
      cases++;
      assert.deepEqual(completion(() => operations.invoke(method, receiver(), args)),
        completion(() => Reflect.apply(method, receiver(), args)),
        `${prototype.constructor?.name}.${String(key)} with ${JSON.stringify(args)}`);
    }
  }
  assert.ok(cases >= 540, `Ordinary receiver comparison reached only ${cases} admitted calls`);
});

test('admitted prototype methods preserve V8 hook order on ordinary receivers', () => {
  const operations = createOperations();
  const sources: ((trace: string[]) => object)[] = [
    trace => ({[Symbol.toPrimitive](hint: string) { trace.push('primitive:' + hint); return '2'; },
      valueOf() { trace.push('valueOf'); return 2; }, toString() { trace.push('toString'); return '2'; }}),
    trace => ({get [Symbol.iterator]() { trace.push('iterator-get'); return function() {
      trace.push('iterator-call'); let done = false;
      return {get next() { trace.push('next-get'); return function() {
        trace.push('next-call'); if (done) return {done: true}; done = true; return {done: false, value: 1};
      }; }};
    }; }, get length() { trace.push('length'); return 1; }, get 0() { trace.push('zero'); return 1; }}),
    trace => ({get length() { trace.push('length'); return 1; }, get 0() { trace.push('zero'); return 1; },
      [Symbol.toPrimitive](hint: string) { trace.push('primitive:' + hint); return 2; }}),
    trace => ({get [Symbol.toPrimitive]() { trace.push('primitive-get'); throw new Error('coercion'); },
      get [Symbol.iterator]() { trace.push('iterator-get'); throw new Error('iterator'); },
      get length() { trace.push('length'); throw new Error('length'); }}),
  ];
  const run = (method: Function, receiver: () => unknown, make: (trace: string[]) => object, guarded: boolean) => {
    const trace: string[] = [];
    const result = completion(() => guarded
      ? operations.invoke(method, receiver(), [make(trace)])
      : Reflect.apply(method, receiver(), [make(trace)]));
    return {result, trace};
  };
  let methods = 0, cases = 0;
  for (const [prototype, receiver] of admittedPrototypeProfiles) for (const key of Reflect.ownKeys(prototype)) {
    const method = Object.getOwnPropertyDescriptor(prototype, key)?.value;
    if (typeof method !== 'function' || key === 'constructor') continue;
    try { checkNativeEntry(method); } catch { continue; }
    methods++;
    for (const make of sources) {
      cases++;
      assert.deepEqual(run(method, receiver, make, true), run(method, receiver, make, false),
        `${prototype.constructor?.name}.${String(key)}`);
    }
  }
  assert.ok(methods >= 180 && cases >= 720,
    `Hook comparison reached only ${methods} methods and ${cases} calls`);
});

test('admitted native method callbacks re-enter the guarded invocation path', () => {
  const owners = [Object, Array, Number, String, BigInt, Symbol, Math, JSON, Reflect,
    Map, ArrayBuffer, Object.getPrototypeOf(Uint8Array), Error];
  let cases = 0, invoked = 0;
  function check(owner: string, key: PropertyKey, method: Function, receiver: () => unknown): void {
    for (const position of [0, 1, 2]) {
      let calls = 0, guardedCalls = 0;
      const callback = () => { calls++; return 1; };
      const operations = createOperations({
        apply(fn, self, args) {
          if (fn === callback) guardedCalls++;
          return Reflect.apply(fn, self, args);
        },
      });
      const args = position === 0 ? [callback]
        : position === 1 ? [{}, callback] : [callback, callback];
      completion(() => operations.invoke(method, receiver(), args));
      cases++;
      invoked += calls;
      assert.equal(guardedCalls, calls,
        `${owner}.${String(key)} invoked callback outside guarded operations (position ${position})`);
    }
  }
  for (const [prototype, receiver] of admittedPrototypeProfiles) for (const key of Reflect.ownKeys(prototype)) {
    const method = Object.getOwnPropertyDescriptor(prototype, key)?.value;
    if (typeof method !== 'function' || key === 'constructor') continue;
    try { checkNativeEntry(method); } catch { continue; }
    check(prototype.constructor?.name ?? 'prototype', key, method, receiver);
  }
  for (const owner of owners) for (const key of Reflect.ownKeys(owner)) {
    const method = Object.getOwnPropertyDescriptor(owner, key)?.value;
    if (typeof method !== 'function' || key === 'prototype') continue;
    try { checkNativeEntry(method); } catch { continue; }
    check(owner.name, key, method, () => owner);
  }
  assert.ok(cases >= 800 && invoked >= 100,
    `Callback ingress comparison reached only ${cases} calls and ${invoked} callbacks`);
});

test('admitted native operations preserve callback-result hooks across the catalogue', () => {
  const owners = [Object, Array, Number, String, BigInt, Symbol, Math, JSON, Reflect,
    Map, ArrayBuffer, Object.getPrototypeOf(Uint8Array), Error];
  let cases = 0;
  function compare(label: string, method: Function, receiver: () => unknown): void {
    for (const shape of [0, 1, 2]) {
      const run = (guarded: boolean) => {
        const trace: string[] = [];
        const resultValue = {
          get [Symbol.toPrimitive]() { trace.push('primitive-get'); return (hint: string) => {
            trace.push(`primitive-call:${hint}`); return '1';
          }; },
          get [Symbol.iterator]() { trace.push('iterator-get'); return function*() {
            trace.push('iterator-call'); yield 1;
          }; },
          get length() { trace.push('length'); return 1; },
          get 0() { trace.push('zero'); return 1; },
        };
        const callback = () => { trace.push('callback'); return resultValue; };
        const args = shape === 0 ? [callback] : shape === 1 ? [resultValue, callback] : [callback, resultValue];
        const result = completion(() => guarded
          ? createOperations().invoke(method, receiver(), args) : Reflect.apply(method, receiver(), args));
        return {result, trace};
      };
      cases++;
      assert.deepEqual(run(true), run(false), `${label} shape ${shape}`);
    }
  }
  for (const [prototype, receiver] of admittedPrototypeProfiles) for (const key of Reflect.ownKeys(prototype)) {
    const method = Object.getOwnPropertyDescriptor(prototype, key)?.value;
    if (typeof method !== 'function' || key === 'constructor') continue;
    try { checkNativeEntry(method); } catch { continue; }
    compare(`${prototype.constructor?.name}.${String(key)}`, method, receiver);
  }
  for (const owner of owners) for (const key of Reflect.ownKeys(owner)) {
    const method = Object.getOwnPropertyDescriptor(owner, key)?.value;
    if (typeof method !== 'function' || key === 'prototype') continue;
    try { checkNativeEntry(method); } catch { continue; }
    compare(`${owner.name}.${String(key)}`, method, () => owner);
  }
  assert.ok(cases >= 800, `Callback-result comparison reached only ${cases} calls`);
});

test('admitted static methods preserve V8 completion on basic arguments', () => {
  const operations = createOperations();
  const owners = [Object, Array, Number, String, BigInt, Symbol, Math, JSON, Reflect,
    Map, ArrayBuffer, Object.getPrototypeOf(Uint8Array), Error];
  let methods = 0, cases = 0;
  for (const owner of owners) for (const key of Reflect.ownKeys(owner)) {
    const method = Object.getOwnPropertyDescriptor(owner, key)?.value;
    if (typeof method !== 'function' || key === 'prototype') continue;
    try { checkNativeEntry(method); } catch { continue; }
    methods++;
    for (const args of [[], [0], ['x'], [null]]) {
      cases++;
      assert.deepEqual(completion(() => operations.invoke(method, owner, args)),
        completion(() => Reflect.apply(method, owner, args)),
        `${owner.name}.${String(key)} with ${JSON.stringify(args)}`);
    }
  }
  assert.ok(methods >= 90 && cases >= 360,
    `Static comparison reached only ${methods} methods and ${cases} calls`);
});

test('admitted constructors preserve V8 completion on basic arguments', () => {
  const operations = createOperations();
  const constructors = [Object, Array, Number, String, Boolean, BigInt, Symbol,
    Map, Set, WeakMap, WeakSet, RegExp, Error, TypeError, RangeError, AggregateError,
    SyntaxError, ReferenceError, EvalError, URIError, ArrayBuffer, DataView,
    Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array,
    Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array,
    BigUint64Array, Promise];
  let cases = 0;
  for (const constructor of constructors) for (const args of [[], [0], ['x'], [null], [{}]]) {
    cases++;
    assert.deepEqual(completion(() => operations.construct(constructor, args)),
      completion(() => Reflect.construct(constructor, args)),
      `${constructor.name} with ${String(args[0])}`);
  }
  assert.ok(constructors.length >= 30 && cases >= 150,
    `Constructor comparison reached only ${constructors.length} constructors and ${cases} calls`);
});

test('admitted constructors preserve V8 hook order in both argument positions', () => {
  const operations = createOperations();
  const constructors = [Object, Array, Number, String, Boolean, BigInt, Symbol,
    Map, Set, WeakMap, WeakSet, RegExp, Error, TypeError, RangeError, AggregateError,
    SyntaxError, ReferenceError, EvalError, URIError, ArrayBuffer, DataView,
    Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array,
    Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array,
    BigUint64Array, Promise];
  const sources: ((trace: string[]) => object)[] = [
    trace => ({[Symbol.toPrimitive](hint: string) { trace.push('primitive:' + hint); return '2'; },
      valueOf() { trace.push('valueOf'); return 2; }, toString() { trace.push('toString'); return '2'; }}),
    trace => ({get [Symbol.iterator]() { trace.push('iterator-get'); return function() {
      trace.push('iterator-call'); let done = false;
      return {get next() { trace.push('next-get'); return function() {
        trace.push('next-call'); if (done) return {done: true}; done = true;
        return {done: false, value: 1};
      }; }};
    }; }, get length() { trace.push('length'); return 1; }, get 0() { trace.push('zero'); return 1; }}),
    trace => ({get [Symbol.toPrimitive]() { trace.push('primitive-get'); throw new Error('primitive'); },
      get [Symbol.iterator]() { trace.push('iterator-get'); throw new Error('iterator'); },
      get length() { trace.push('length'); throw new Error('length'); }}),
  ];
  let cases = 0;
  for (const constructor of constructors) for (const source of sources) for (const position of [0, 1]) {
    const run = (guarded: boolean) => {
      const trace: string[] = [];
      const value = source(trace), args = position === 0 ? [value] : [0, value];
      const result = completion(() => guarded
        ? operations.construct(constructor, args) : Reflect.construct(constructor, args));
      return {result, trace};
    };
    cases++;
    assert.deepEqual(run(true), run(false), `${constructor.name} argument ${position}`);
  }
  assert.ok(cases >= 200, `Constructor hook comparison reached only ${cases} calls`);
});

test('admitted native accessors preserve V8 completion on basic receivers', () => {
  const operations = createOperations();
  const owners: [object, () => unknown][] = [
    [Object.prototype, () => ({})], [ArrayBuffer.prototype, () => new ArrayBuffer(8)],
    [DataView.prototype, () => new DataView(new ArrayBuffer(8))],
    [Object.getPrototypeOf(Uint8Array.prototype), () => new Uint8Array([1])],
    [Map.prototype, () => new Map()], [Set.prototype, () => new Set()],
    [RegExp.prototype, () => /x/g], [Symbol.prototype, () => Symbol('x')],
    [Array, () => Array], [ArrayBuffer, () => ArrayBuffer],
    [RegExp, () => RegExp], [Promise, () => Promise],
    [Object.getPrototypeOf(Uint8Array), () => Object.getPrototypeOf(Uint8Array)],
  ];
  let cases = 0;
  for (const [owner, valid] of owners) for (const key of Reflect.ownKeys(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    for (const kind of ['get', 'set'] as const) {
      const accessor = descriptor?.[kind];
      if (typeof accessor !== 'function') continue;
      try { checkAccessor(accessor, kind); } catch { continue; }
      for (const [receiverIndex, receiver] of [null, undefined, 1, valid()].entries()) {
        cases++;
        const args = kind === 'set' ? [null] : [];
        assert.deepEqual(completion(() => operations.invoke(accessor, receiver, args)),
          completion(() => Reflect.apply(accessor, receiver, args)),
          `${String(key)} ${kind} receiver ${receiverIndex}`);
      }
    }
  }
  assert.ok(cases >= 110, `Accessor comparison reached only ${cases} admitted calls`);
});

test('JavaScript-implemented methods reachable from instance globals need explicit admission', () => {
  const { intrinsics } = programCapabilities(() => {}, () => { throw Error('unavailable'); });
  const seen = new Set<object>();
  let visited = 0;

  function visit(value: unknown, path: string): void {
    if (value === null || typeof value !== 'object' && typeof value !== 'function' || seen.has(value)) return;
    seen.add(value);
    if (typeof value === 'function') {
      visited++;
      const source = Function.prototype.toString.call(value);
      if (!/\{\s*\[native code\]\s*\}$/.test(source)) {
        assert.throws(() => checkNativeEntry(value), /not whitelisted/, path);
      }
    }
    visit(Object.getPrototypeOf(value), path + '.[[Prototype]]');
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if ('value' in descriptor) visit(descriptor.value, path + '.' + String(key));
      else {
        visit(descriptor.get, path + '.get ' + String(key));
        visit(descriptor.set, path + '.set ' + String(key));
      }
    }
  }

  for (const [name, value] of Object.entries(intrinsics)) visit(value, name);
  assert.ok(visited > 100, 'The visible callable graph was not traversed');
  for (const value of [atob,btoa,URL.revokeObjectURL])
    assert.throws(() => checkNativeEntry(value), /not whitelisted/);
});
