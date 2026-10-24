import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { bindRuleSchema } from '../src/rules-schema.ts';

test('internal plans keep number constraints and format checks after erasing TS shape checks', () => {
  const schemas: z.ZodType[] = [z.int32(), z.number().min(-3).max(5), z.number().int().nonnegative(), z.string().min(2), z.email()];
  const samples: unknown[][] = [[0, -2147483648, 2147483647, 2147483648, 1.5, NaN, Infinity], [-3, 5, 6, NaN], [0, 4, -1, 1.2], ['', 'ab'], ['a@b.com', 'broken']];
  schemas.forEach((schema, index) => {
    const plan = bindRuleSchema(schema);
    for (const sample of samples[index]!) {
      const expected = schema.safeParse(sample);
      if (expected.success) assert.deepEqual(plan.apply(sample as never), expected.data);
      else assert.throws(() => plan.apply(sample as never), z.ZodError);
    }
  });
});

test('normalization, defaults, transformations and refinement ordering retain schema semantics', () => {
  const log: string[] = [];
  const schema = z.object({
    value: z.number().transform(n => { log.push('transform'); return n * 2; }),
    label: z.string().default('default'),
  }).superRefine((value, context) => { log.push('refine:' + value.value); if (value.value > 6) context.addIssue({ code: 'custom', message: 'too large' }); });
  const plan = bindRuleSchema(schema);
  for (const value of [2, 4]) {
    const input = { value, label: undefined, removed: true };
    log.length = 0; const expected = schema.safeParse(input), order = [...log];
    log.length = 0;
    if (expected.success) assert.deepEqual(plan.apply(input as unknown as z.output<typeof schema>), expected.data);
    else assert.throws(() => plan.apply(input as unknown as z.output<typeof schema>), z.ZodError);
    assert.deepEqual(log, order);
    assert.deepEqual(input, { value, label: undefined, removed: true });
  }
});

test('structurally assignable extra fields still obey strip, strict and catchall behavior', () => {
  for (const schema of [z.object({ value: z.number() }), z.strictObject({ value: z.number() }), z.object({ value: z.number() }).catchall(z.number().min(0))]) {
    const plan = bindRuleSchema(schema);
    for (const extra of [2, -1]) {
      const input = { value: 1, extra }, expected = schema.safeParse(input);
      if (expected.success) assert.deepEqual(plan.apply(input), expected.data);
      else assert.throws(() => plan.apply(input), z.ZodError);
    }
  }
});

test('opaque schema callbacks run exactly once against an isolated input', () => {
  let calls = 0;
  const schema = { parse(input: unknown) { calls++; const value = input as { n: number }; value.n++; return value; } };
  const input = { n: 1 }, plan = bindRuleSchema(schema);
  assert.equal(bindRuleSchema(schema), plan);
  assert.deepEqual(plan.apply(input), { n: 2 }); assert.equal(calls, 1); assert.deepEqual(input, { n: 1 });
});

test('type-only internal plans never call the structural parser',()=>{
  const schema=z.strictObject({enabled:z.boolean(),label:z.string(),mode:z.enum(['a','b'])});
  schema.parse=()=>{throw Error('Internal structural parser must not run');};
  const plan=bindRuleSchema(schema);
  assert.deepEqual(plan.apply({enabled:true,label:'name',mode:'a'}),{enabled:true,label:'name',mode:'a'});
});

test('owned values pass pure plans by reference while writable ingress stays isolated', async () => {
  const { ownRuleValue, readRuleValue, detachRuleValue } = await import('../src/rules-values.ts');
  const schema = z.strictObject({ rows: z.array(z.strictObject({ n: z.number().int().nonnegative() })) });
  const plan = bindRuleSchema(schema), source = { rows: [{ n: 1 }] };
  const first = plan.own(source);
  assert.notEqual(first, source); assert.notEqual(first.rows, source.rows);
  source.rows[0]!.n = 9;
  assert.equal(first.rows[0]!.n, 1);
  assert.equal(readRuleValue(first), first);
  assert.equal(plan.own(first), first);
  assert.equal(plan.own(first), first);
  const next = plan.own({ rows: [...first.rows, { n: 2 }] });
  assert.equal(next.rows[0], first.rows[0]);
  assert.equal(first.rows.length, 1);
  const mutable = detachRuleValue(ownRuleValue({ a: first, b: first }));
  assert.equal(mutable.a, mutable.b); assert.notEqual(mutable.a, first);
  assert.throws(() => plan.own({ rows: [{ n: -1 }] }), z.ZodError);
});

test('refinements may mutate and retain their private input without changing borrowed versions', async () => {
  const { ownRuleValue } = await import('../src/rules-values.ts');
  let retained: { n: number } | undefined, calls = 0;
  const schema = z.object({ child: z.unknown() }).superRefine(value => {
    calls++; retained = value.child as { n: number }; retained.n++;
  });
  const plan = bindRuleSchema(schema), input = ownRuleValue({ child: { n: 1 } });
  const result = plan.own(input);
  assert.deepEqual(result, { child: { n: 2 } }); assert.equal(input.child.n, 1);
  retained!.n = 77; assert.deepEqual(result, { child: { n: 2 } });
  assert.deepEqual(plan.own(input), result); assert.equal(calls, 2);
});

test('pure normalization retains schema key order and strips extras without touching the source', async () => {
  const { ownRuleValue } = await import('../src/rules-values.ts');
  const input = ownRuleValue({ b: 2, a: 1, extra: true });
  const plan = bindRuleSchema(z.object({ a: z.number(), b: z.number() }));
  const result = plan.own(input);
  assert.deepEqual(Object.keys(result), ['a', 'b']);
  assert.deepEqual(Object.keys(input), ['b', 'a', 'extra']);
  assert.equal(plan.own(result), result);
});

test('pure schema normalization copies only changed containers and preserves array shape semantics', async () => {
  const {ownRuleValue}=await import('../src/rules-values.ts');
  const item=z.object({a:z.number(),b:z.number().optional()}),plan=bindRuleSchema(z.array(item));
  const unchanged=ownRuleValue({a:1}),reordered=ownRuleValue({b:3,a:2});
  const input=ownRuleValue([unchanged,reordered]),output=plan.own(input);
  assert.notEqual(output,input);assert.equal(output[0],unchanged);assert.notEqual(output[1],reordered);
  assert.deepEqual(Object.keys(output[1]!),['a','b']);assert.equal(plan.own(output),output);
  const sparse=ownRuleValue(Object.assign(new Array<number|undefined>(2),{1:1,extra:2}));
  const numbers=bindRuleSchema(z.array(z.number().optional())).own(sparse);
  assert.deepEqual(Object.keys(numbers),['0','1']);assert.equal(numbers[0],undefined);assert.equal(numbers[1],1);
  const unknown=bindRuleSchema(z.unknown());assert.equal(unknown.own(input),input);
});


test('pure string records share owned children while retaining normalization, key order and rejection', async () => {
  const {ownRuleValue}=await import('../src/rules-values.ts');
  const schema=z.record(z.string(),z.object({n:z.number().int().min(0),optional:z.number().optional()})),plan=bindRuleSchema(schema);
  const shared={n:2},input=ownRuleValue({a:shared,b:shared,constructor:{n:3}});
  const output=plan.own(input);
  assert.equal(output,input);assert.equal(output.a,output.b);assert.equal(plan.own(input),output);
  const source=ownRuleValue({a:{extra:true,n:1},b:input.b,['__proto__']:{n:-1},constructor:input.constructor});
  const normalized=plan.own(source);
  assert.deepEqual(normalized,schema.parse(source));assert.deepEqual(Object.keys(normalized),['a','b','constructor']);
  assert.notEqual(normalized.a,source.a);assert.equal(normalized.b,source.b);assert.ok(Object.hasOwn(source,'__proto__'));
  assert.throws(()=>plan.own({bad:{n:-1}}),error=>error instanceof z.ZodError&&error.issues[0]?.path.join('.')==='bad.n');
  const mutable={a:{n:1}},owned=plan.own(mutable);mutable.a.n=9;assert.equal(owned.a!.n,1);
});

test('record key semantics and value callbacks stay on their isolated original parser', async () => {
  const {ownRuleValue}=await import('../src/rules-values.ts');
  for(const schema of [z.record(z.enum(['a','b']),z.number()),z.record(z.string().regex(/^a/),z.number()),z.record(z.email(),z.number()),z.record(z.string().transform(key=>key.toUpperCase()),z.number())]){
    const plan=bindRuleSchema(schema),source={a:1,b:2},expected=schema.safeParse(source);
    if(expected.success)assert.deepEqual(plan.own(source),expected.data);else assert.throws(()=>plan.own(source),z.ZodError);
  }
  let retained:{n:number}|undefined,calls=0;
  const schema=z.record(z.string(),z.unknown().transform(value=>{calls++;retained=value as {n:number};retained.n++;return retained;}));
  const plan=bindRuleSchema(schema),source=ownRuleValue({a:{n:1}}),first=plan.own(source);
  assert.equal(first.a!.n,2);assert.equal(source.a.n,1);retained!.n=9;assert.equal(first.a!.n,2);
  const second=plan.own(source);assert.equal(calls,2);assert.equal(second.a!.n,2);
});
