import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { copy, read, keys, admitSchema } from '../src/index.ts';
test('isolation preserves aliases, holes and numeric edge values', () => {
  const shared = {
    value: -0
  };
  const value: any = {
    a: shared,
    b: shared,
    array: [, NaN, undefined]
  };
  value.self = value;
  const result = copy(value);
  assert.notEqual(result, value);
  assert.equal(result.a, result.b);
  assert.equal(result.self, result);
  assert.equal(0 in result.array, false);
  assert.ok(Object.is(result.a.value, -0));
  assert.ok(Number.isNaN(result.array[1]));
});
test('rejects getters without invoking them and functions/resources', () => {
  let calls = 0;
  const getter = {
    get x() {
      calls++;
      return 1;
    }
  };
  assert.throws(() => copy(getter));
  assert.equal(calls, 0);
  for (const value of [() => 0, new Map(), new Date(), Object.create({
    x: 1
  })]) assert.throws(() => copy(value));
  assert.throws(() => keys({
    [Symbol('x')]: 1
  }));
});
test('schema values are preserved irrespective of source property order', () => {
  assert.deepEqual(read(z.strictObject({
    a: z.number(),
    b: z.string()
  }), {
    b: 'x',
    a: 2
  }), {
    a: 2,
    b: 'x'
  });
  assert.throws(() => read(z.object({
    x: z.number()
  }), {
    x: 2,
    hidden: true
  }));
  assert.throws(() => read(z.string().transform(x => x.toUpperCase()), 'x'));
  assert.throws(() => admitSchema(z.coerce.number()));
  assert.throws(() => admitSchema(z.number().default(1)));
});
