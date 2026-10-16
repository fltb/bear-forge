import { createOperations, protectIntrinsics } from './operations.ts';

/** Shared intrinsic identities and fresh globals; this factory retains no Instance data. */
export function programEnvironment(tick: () => void, unavailable: () => never) {
  const intrinsics = Object.freeze({ Object, Array, Number, String, Boolean, BigInt, Symbol,
    JSON, Map, Set, WeakMap, WeakSet, Reflect, RegExp, Error, TypeError, RangeError, AggregateError, ...(typeof SuppressedError==='function'?{SuppressedError}:{}), ReferenceError, SyntaxError, EvalError, URIError,
    Promise, ArrayBuffer, DataView, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array, Uint32Array, Int32Array,
    Float32Array, Float64Array, BigInt64Array, BigUint64Array, Uint8Array, Math, Function, Date,
    Proxy });
  function globals(promise: unknown = Promise, overrides: Record<string, unknown> = {}) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ ...intrinsics, Promise: promise, ...overrides, undefined, NaN, Infinity })) {
      const constant = key === 'undefined' || key === 'NaN' || key === 'Infinity';
      Object.defineProperty(result, key, { value, enumerable: false, writable: !constant, configurable: !constant });
    }
    Object.defineProperty(result, 'globalThis', { value: result, writable: true, configurable: true });
    return result;
  }
  protectIntrinsics(intrinsics);
  return {
    intrinsics,
    globals,
    tick,
    Math,
    Function,
    unavailable
  };
}

/** Native instances need an operation table bound to their own global object. */
export function programCapabilities(tick: () => void, unavailable: () => never) {
  const environment = programEnvironment(tick, unavailable);
  let activeGlobal: ReturnType<typeof environment.globals>;
  return {
    ...environment,
    globals(promise?: unknown, overrides?: Record<string, unknown>) {
      activeGlobal = environment.globals(promise, overrides);
      return activeGlobal;
    },
    operations: createOperations({ tick, global: () => activeGlobal, violation: unavailable })
  };
}
