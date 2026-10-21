import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { isolatedDataSchema } from '../src/compiled-schema.ts';
import { readOwned, read, copyOwned, isOwned } from '../src/values.ts';

test('fixed data validators keep public parse/read outputs unbranded and mutable', () => {
  const schema = isolatedDataSchema(z.strictObject({ rows: z.array(z.strictObject({ n: z.number() })) }));
  const source = { rows: [{ n: 1 }] };
  const parsed = schema.parse(source), publicRead = read(schema, source);
  assert.equal(isOwned(parsed), false); assert.equal(isOwned(publicRead), false);
  parsed.rows[0]!.n = 2; publicRead.rows[0]!.n = 3;
  assert.equal(source.rows[0]!.n, 1);
  const owned = readOwned(schema, source);
  const repeated = readOwned(schema, owned);
  assert.equal(repeated, owned);
  const copy = copyOwned(owned); copy.rows[0]!.n = 4;
  assert.equal(owned.rows[0]!.n, 1);
  let getters = 0;
  Object.defineProperty(parsed.rows[0], 'n', { enumerable: true, get() { getters++; return 2; } });
  assert.throws(() => readOwned(schema, parsed));
  assert.equal(getters, 0, 'public parse output must undergo admission after caller edits');
});

test('fixed data results still reject changed alias/array shapes and preserve parser key order', () => {
  const leaf = z.strictObject({ n: z.number() });
  const schema = isolatedDataSchema(z.strictObject({ a: leaf, b: leaf }));
  const shared = { n: 1 };
  assert.throws(() => readOwned(schema, { a: shared, b: shared }), /changed its input/);
  const ordered = readOwned(schema, { b: { n: 2 }, a: { n: -0 } });
  assert.deepEqual(Object.keys(copyOwned(ordered)), ['a', 'b']);
  assert.equal(Object.is(ordered.a.n, -0), true);
  const array = isolatedDataSchema(z.array(z.number().optional()));
  assert.throws(() => readOwned(array, new Array(2)), /changed its input/);
  const extra: any = [1]; extra.label = 'kept';
  assert.throws(() => readOwned(array, extra), /changed its input/);
});

test('a replaced parser receives its own ordinary snapshot and full result admission', () => {
  const schema = isolatedDataSchema(z.strictObject({ child: z.strictObject({ n: z.number() }) }));
  const original = readOwned(schema, { child: { n: 1 } });
  let retained: any, calls = 0, getters = 0;
  schema.parse = ((value: any) => {
    calls++; retained = value;
    assert.equal(Object.isFrozen(value), false);
    Object.defineProperty(value.child, 'n', { enumerable: true, get() { getters++; return 1; } });
    return value;
  }) as typeof schema.parse;
  assert.throws(() => readOwned(schema, original));
  assert.equal(calls, 1); assert.equal(getters, 0);
  Object.defineProperty(retained.child, 'n', { value: 99, configurable: true, enumerable: true });
  assert.equal(original.child.n, 1);
});

test('unreviewed refinements and opaque/recursive/transforming schemas keep their original parser', () => {
  let retained: any, calls = 0;
  const custom = z.strictObject({ n: z.number() }).superRefine(value => { retained = value; calls++; });
  const unchanged = isolatedDataSchema(custom);
  assert.equal(unchanged, custom);
  const privateValue = readOwned(unchanged, { n: 1 });
  retained.n = 99;
  assert.equal(privateValue.n, 1); assert.equal(calls, 1);
  const opaque = z.strictObject({ value: z.unknown() });
  const recursive: z.ZodType = z.lazy(() => z.object({ next: recursive.optional() }));
  const transforming = z.string().transform(value => value.trim());
  const coerced = z.strictObject({ n: z.coerce.number() });
  const symbolic = z.strictObject({ [Symbol('field')]: z.number().optional() });
  const loose = z.looseRecord(z.enum(['a']), z.number());
  for (const schema of [opaque, recursive, transforming, coerced, symbolic, loose]) assert.equal(isolatedDataSchema(schema), schema);
});

test('approved refinements inspect fresh values and failure error callbacks cannot capture the private baseline', () => {
  let baseline: any, checks = 0, errorInput: any;
  const original = z.strictObject({ rows: z.array(z.strictObject({ n: z.number() })) }).superRefine(value => {
    checks++; assert.notEqual(value, baseline);
    if (baseline) { assert.notEqual(value.rows, baseline.rows); assert.notEqual(value.rows[0], baseline.rows[0]); }
  });
  const schema = isolatedDataSchema(original, [original]);
  baseline = readOwned(z.any(), { rows: [{ n: 1 }] });
  assert.equal(readOwned(schema, baseline), baseline);
  assert.equal(checks, 1);
  const invalid = readOwned(z.any(), { rows: [{ n: 1 }], extra: true });
  const previous = z.config().customError;
  z.config({ customError(issue) { if (typeof issue.input === 'object') errorInput = issue.input; return 'fixed error'; } });
  try { assert.throws(() => readOwned(schema, invalid), /fixed error/); }
  finally { z.config({ customError: previous }); }
  assert.ok(errorInput); assert.notEqual(errorInput, invalid);
  errorInput.rows[0].n = 99;
  assert.equal(invalid.rows[0].n, 1);
});

test('private nested projections retain ownership without certifying mutable public copies',()=>{
  const schema=isolatedDataSchema(z.strictObject({rows:z.array(z.strictObject({n:z.number().int()}))}));
  const first=readOwned(schema,{rows:[{n:3}]});
  const repeated=readOwned(schema,first);
  const projected=readOwned(isolatedDataSchema(z.array(z.strictObject({n:z.number().int()}))),repeated.rows);
  assert.deepEqual(projected,[{n:3}]);
  const external=copyOwned(projected);external[0]!.n=1.5;
  assert.throws(()=>readOwned(isolatedDataSchema(z.array(z.strictObject({n:z.number().int()}))),external));
  assert.equal(projected[0]!.n,3);
});

test('only the selected publication acquires reusable nested projection ownership',()=>{
  const leaf=z.strictObject({n:z.number()}), schema=isolatedDataSchema(z.strictObject({a:leaf,b:leaf}));
  for(const input of [{a:{n:1},b:{n:2}},{b:{n:2},a:{n:1}}]){
    const publication=readOwned(schema,input);
    assert.equal(isOwned(publication.a),true);assert.equal(isOwned(publication.b),true);
    assert.equal(readOwned(isolatedDataSchema(leaf),publication.a),publication.a);
    const copy=copyOwned(publication);assert.equal(isOwned(copy.a),false);
    copy.a.n=9;assert.equal(publication.a.n,1);
  }
});

test('compiled assertion-only private parsing borrows unchanged trees and separates only reordered containers',()=>{
  const leaf=z.strictObject({a:z.number(),b:z.number()}),schema=isolatedDataSchema(z.strictObject({rows:z.array(leaf)}));
  const owned=readOwned(schema,{rows:[{a:1,b:2}]});
  assert.equal(schema.parse(owned),owned);
  const reversed=readOwned(z.any(),{rows:[{b:2,a:1},{a:3,b:4}]});
  const normalized=schema.parse(reversed);
  assert.notEqual(normalized,reversed);assert.notEqual(normalized.rows,reversed.rows);
  assert.notEqual(normalized.rows[0],reversed.rows[0]);assert.equal(normalized.rows[1],reversed.rows[1]);
  assert.deepEqual(Object.keys(normalized.rows[0]!),['a','b']);
  const external={rows:[{a:1,b:2}]};assert.notEqual(schema.parse(external).rows[0],external.rows[0]);
});
