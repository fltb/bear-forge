/** Zod 4.6.5 boundary-profile implementation. Not part of the contracts package.
 * Assumes genuine, unmodified Zod nodes created by admitted code. Callback approval
 * belongs to the trusted build/loader, never the game requesting admission. */
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';

export type SchemaPolicy = {
  /** Individually reviewed pure custom checks, bound to trusted source/artifact identity. */
  readonly checks:ReadonlySet<object>;
  /** Explicit built-in schema instances (e.g. canonical JSON, byte buffers). */
  readonly atoms:ReadonlySet<object>;
};
export const emptyPolicy:SchemaPolicy={checks:new Set(),atoms:new Set()};
const pureChecks=new Set(['less_than','greater_than','multiple_of','number_format','min_length','max_length','length_equals']);
const stringFormats=new Set(['uuid','regex']);
// Pinned library's own length predicates, not caller-supplied `when` callbacks.
const builtinWhen=new Set<unknown>([z.string().min(1),z.string().max(1),z.string().length(1)].map(s=>(s._zod.def.checks?.[0]?._zod.def as unknown as Record<string,unknown>).when));

/** Does not invoke schema parsing, arbitrary lazy getters or custom checks. */
export const assertBoundarySchema=(schema:z.ZodType,policy:SchemaPolicy=emptyPolicy):void=>{
  const visited=new Set<object>();
  const walk=(node:z.ZodType,path:string):void=>{
    if(visited.has(node))return;
    if(!(node instanceof z.ZodType))throw new Error(`${path}: unsupported schema instance`);
    visited.add(node);
    const d=node._zod.def as unknown as Record<string,unknown>;
    if(policy.atoms.has(node)&&(d.type==='lazy'||d.type==='custom'))return;
    const fail=(why:string):never=>{throw new Error(`${path}: ${why}`);};
    if(d.coerce)fail('coercion changes values');
    const hooks=(def:Record<string,unknown>):void=>{
      for(const key of ['error','when']){
        const fn=def[key];
        if(typeof fn==='function'&&!policy.checks.has(fn)&&!(key==='when'&&builtinWhen.has(fn)))fail(`unreviewed ${key} callback`);
      }
    };
    hooks(d);
    const check=(c:object):void=>{
      const def=(c as {_zod:{def:Record<string,unknown>}})._zod.def;
      if(def.check==='custom'&&policy.checks.has(c))return;
      hooks(def);
      if(pureChecks.has(String(def.check)))return;
      if(def.check==='string_format'&&stringFormats.has(String(def.format))){
        if(def.pattern instanceof RegExp&&(def.pattern.global||def.pattern.sticky))fail('stateful regexp');
        return;
      }
      fail(`unreviewed check ${String(def.check)}`);
    };
    for(const c of (d.checks??[]) as object[])check(c);
    const child=(v:unknown,label:string)=>walk(v as z.ZodType,`${path}.${label}`);
    switch(d.type){
      case 'string':
        if(d.format!==undefined)check(node);
        break;
      case 'number':case 'boolean':case 'null':case 'undefined':case 'never':case 'literal':case 'enum':break;
      case 'optional':case 'nullable':child(d.innerType,'inner');break;
      case 'array':child(d.element,'element');break;
      case 'tuple':
        (d.items as z.ZodType[]).forEach((v,i)=>child(v,String(i)));
        if(d.rest)child(d.rest,'rest');
        break;
      case 'union':(d.options as z.ZodType[]).forEach((v,i)=>child(v,String(i)));break;
      case 'object':{
        const catchall=d.catchall as z.ZodType|undefined;
        if(catchall?._zod.def.type!=='never')fail('objects must reject unknown fields');
        const property=Object.getOwnPropertyDescriptor(d,'shape');
        // Pinned Zod stores its unevaluated shape in getter.raw. Never evaluate game getters.
        const raw=property&&('value' in property?property.value:Object.getOwnPropertyDescriptor(property.get!,'raw')?.value);
        if(!raw)fail('unreviewed shape getter');
        const shape=raw as Record<string,z.ZodType>;
        for(const key of ownTableKeys(shape)){
          const value=shape[key]!;
          if(key==='__proto__')fail('Zod strips a declared __proto__ field');
          child(value,key);
        }
        break;
      }
      case 'record':{
        const key=d.keyType as z.ZodType;
        if(key._zod.def.type!=='string')fail('record keys must be value-preserving strings');
        child(key,'key');child(d.valueType,'value');break;
      }
      default:fail(`unsupported or value-changing schema ${String(d.type)}`);
    }
  };
  walk(schema,'schema');
};

/** Host data cannot smuggle getters/prototypes through the copying step. */
const assertBoundaryData=(value:unknown,active=new Set<object>(),seen=new Set<object>()):void=>{
  if(value===null||['string','boolean','undefined','number','bigint'].includes(typeof value))return;
  if(typeof value!=='object')throw new Error('unsupported boundary data');
  if(active.has(value))throw new Error('cyclic boundary data');
  if(seen.has(value))return;
  const prototype=Object.getPrototypeOf(value);
  const array=Array.isArray(value),bytes=value instanceof Uint8Array;
  if(bytes&&!(value.buffer instanceof ArrayBuffer))throw new Error('shared boundary bytes');
  if(prototype!==(array?Array.prototype:bytes?Uint8Array.prototype:Object.prototype))throw new Error('unsupported boundary prototype');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const keys=Reflect.ownKeys(descriptors);
  active.add(value);
  for(const key of keys){
    if(typeof key!=='string')throw new Error('symbol boundary property');
    const d=descriptors[key]!;
    if(array&&key==='length')continue;
    if(!('value' in d)||!d.enumerable)throw new Error('boundary properties must be enumerable data');
    if((array||bytes)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=(value as unknown[]|Uint8Array).length))throw new Error('extra sequence property');
    assertBoundaryData(d.value,active,seen);
  }
  if(array&&keys.length!==value.length+1)throw new Error('sparse boundary array');
  active.delete(value);seen.add(value);
};

/** Successful validation implies value equality. Copies isolate caller and validator.
 * The runtime must also apply controlled-data admission before accepting host values. */
export const parseBoundary=<T>(schema:z.ZodType<T>,value:unknown,policy:SchemaPolicy=emptyPolicy):T=>{
  assertBoundarySchema(schema,policy);
  assertBoundaryData(value);
  const before=structuredClone(value),candidate=structuredClone(before);
  if(!isDeepStrictEqual(value,before))throw new Error('boundary copying changed the value');
  const parsed=schema.parse(candidate);
  if(!isDeepStrictEqual(before,candidate)||!isDeepStrictEqual(before,parsed))throw new Error('boundary validation changed the value');
  // Schema acceptance plus equality proves the isolated value has T; keep its aliases.
  return before as T;
};

/** Key tables are module data, not arbitrary JS objects with executable property access. */
export const ownTableKeys=(table:unknown):string[]=>{
  if(typeof table!=='object'||table===null||Array.isArray(table))throw new Error('table must be a plain object');
  const proto=Object.getPrototypeOf(table);
  if(proto!==null&&proto!==Object.prototype)throw new Error('inherited table');
  const descriptors=Object.getOwnPropertyDescriptors(table);
  const keys=Reflect.ownKeys(descriptors);
  for(const key of keys){
    if(typeof key!=='string')throw new Error('symbol table key');
    const descriptor=descriptors[key]!;
    if(!('value' in descriptor)||!descriptor.enumerable)throw new Error('table entries must be enumerable data properties');
  }
  // JS already converts numeric object keys to strings; source-level guards reject numeric declarations.
  return keys as string[];
};
export const assertMatchingTables=(templates:unknown,handlers:unknown):void=>{
  if(!isDeepStrictEqual(ownTableKeys(templates).sort(),ownTableKeys(handlers).sort()))throw new Error('template/handler key mismatch');
};
