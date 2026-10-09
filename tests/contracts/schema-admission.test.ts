import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { assertBoundarySchema, parseBoundary, assertMatchingTables, ownTableKeys } from '../../tools/schema_admission.ts';
import type { SchemaPolicy } from '../../tools/schema_admission.ts';

test('schema profile rejects value changes, stripping and unknown nested constructors',()=>{
  const cases=[z.number().transform(n=>n+1),z.preprocess(Number,z.number()),z.coerce.number(),z.number().default(1),z.number().prefault(1),z.number().catch(1),z.object({x:z.number()}),z.looseObject({x:z.number()}),z.string().trim(),z.string().toLowerCase(),z.number().overwrite(n=>n+1),z.any(),z.unknown(),z.promise(z.number()),z.lazy(()=>z.number()),z.string().regex(/x/g),z.url(),z.record(z.enum(['x']),z.number()),z.custom(()=>true)];
  for(const schema of cases){
    assert.throws(()=>assertBoundarySchema(schema));
    assert.throws(()=>assertBoundarySchema(z.strictObject({nested:z.array(schema.optional())})));
  }
});
test('approved structural schemas preserve values over repeated validation',()=>{
  const schema=z.strictObject({id:z.uuid(),n:z.number().int().min(0),choice:z.union([z.literal('yes'),z.null()]),items:z.array(z.tuple([z.string(),z.boolean()])),dictionary:z.record(z.string(),z.number()),optional:z.string().optional()});
  const value={id:'00000000-0000-4000-8000-000000000000',n:3,choice:null,items:[['x',true]],dictionary:{x:1}};
  const once=parseBoundary(schema,value),twice=parseBoundary(schema,once);
  assert.deepEqual(once,value);assert.deepEqual(twice,once);assert.notEqual(once,value);
  assert.throws(()=>parseBoundary(schema,{...value,extra:1}));
});
test('custom checks require explicit trusted approval; equality guard rejects mutation anyway',()=>{
  const pure=z.number().refine(n=>n>0);
  assert.throws(()=>assertBoundarySchema(pure));
  const policy:SchemaPolicy={checks:new Set(pure._zod.def.checks??[]),atoms:new Set()};
  assert.equal(parseBoundary(pure,2,policy),2);assert.throws(()=>parseBoundary(pure,-1,policy));
  const mutating=z.strictObject({n:z.number()}).superRefine(v=>{v.n++;});
  const badApproval:SchemaPolicy={checks:new Set(mutating._zod.def.checks??[]),atoms:new Set()};
  const value={n:1};
  assert.throws(()=>parseBoundary(mutating,value,badApproval),/changed the value/);
  assert.deepEqual(value,{n:1});
});
test('F4 original transform is rejected before parsing; parser edge cases cannot silently change data',()=>{
  const changing=z.number().int().transform(n=>n+1);
  assert.throws(()=>parseBoundary(changing,0),/unsupported/);
  const record=z.record(z.string(),z.number());
  // Pinned Zod strips this property; the equality guard must reject that result.
  assert.throws(()=>parseBoundary(record,JSON.parse('{"__proto__":1}')),/changed the value/);
});
test('module key registries reject symbols, accessors, inheritance and mismatched handlers',()=>{
  assert.deepEqual(ownTableKeys({left:1,right:2}),['left','right']);
  assertMatchingTables({},{});assertMatchingTables({left:1},{left:2});
  assert.throws(()=>assertMatchingTables({left:1},{right:2}));
  assert.throws(()=>ownTableKeys({[Symbol('x')]:1}));
  let getterCalls=0;
  const getter=Object.defineProperty({},'x',{enumerable:true,get(){getterCalls++;return 1;}});
  assert.throws(()=>ownTableKeys(getter));assert.equal(getterCalls,0);
  assert.throws(()=>ownTableKeys(Object.create({x:1})));
  assert.throws(()=>ownTableKeys(Object.defineProperty({},'x',{value:1,enumerable:false})));
});

test('boundary copying does not invoke getters or silently strip host properties',()=>{
  const schema=z.strictObject({x:z.number()});let calls=0;
  const getter=Object.defineProperty({},'x',{enumerable:true,get(){calls++;return 1;}});
  assert.throws(()=>parseBoundary(schema,getter),/data/);assert.equal(calls,0);
  assert.throws(()=>parseBoundary(schema,{x:1,[Symbol('hidden')]:2}),/symbol/);
  assert.throws(()=>parseBoundary(schema,Object.defineProperty({x:1},'hidden',{value:2})),/enumerable/);
  assert.throws(()=>parseBoundary(z.array(z.number().optional()),Array(1)),/sparse/);
});

test('schema inspection does not execute lazy or object-shape getters',()=>{
  let calls=0;
  const lazy=z.lazy(()=>{calls++;return z.number();});
  const accessor=z.strictObject({get x(){calls++;return z.number();}});
  assert.throws(()=>assertBoundarySchema(lazy));
  assert.throws(()=>assertBoundarySchema(accessor));
  assert.equal(calls,0);
});

test('accepted boundary copies preserve aliases while isolating the caller',()=>{
  const child=z.strictObject({n:z.number()}),schema=z.strictObject({a:child,b:child});
  const shared={n:1},value={a:shared,b:shared};
  const parsed=parseBoundary(schema,value);
  assert.equal(parsed.a,parsed.b);assert.notEqual(parsed.a,shared);
  parsed.a.n=9;assert.equal(parsed.b.n,9);assert.equal(shared.n,1);
});

test('trusted approvals cannot override excluded transform and overwrite constructors',()=>{
  const transform=z.number().transform(n=>n+1),overwrite=z.number().overwrite(n=>n+1);
  assert.throws(()=>assertBoundarySchema(transform,{checks:new Set(),atoms:new Set([transform])}));
  assert.throws(()=>assertBoundarySchema(overwrite,{checks:new Set(overwrite._zod.def.checks??[]),atoms:new Set()}));
});

test('diagnostic callbacks are subject to admission too',()=>{
  let calls=0;
  const schema=z.number({error:()=>{calls++;return 'failed';}});
  assert.throws(()=>assertBoundarySchema(schema),/unreviewed error/);
  assert.equal(calls,0);
});

test('byte boundary copies cannot retain shared mutable backing storage',()=>{
  const schema=z.instanceof(Uint8Array),policy:SchemaPolicy={checks:new Set(),atoms:new Set([schema])};
  assert.throws(()=>parseBoundary(schema,new Uint8Array(new SharedArrayBuffer(1)),policy),/shared/);
  const original=new Uint8Array([1]),copy=parseBoundary(schema,original,policy);
  original[0]=9;assert.equal(copy[0],1);
});
