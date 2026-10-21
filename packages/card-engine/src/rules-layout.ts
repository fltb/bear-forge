import { layoutDigest } from './rules-digest.ts';
import { expressions,definitions } from './rules-internal.ts';
import type { AnyEffect } from './rules-internal.ts';
import { staticDefinitions,authorities } from './rules-module-internal.ts';
import type { ModuleBindings } from './rules-module-internal.ts';
/** Structural identity augments, rather than replaces, the caller's frozen implementation identity. */
export function ruleLayoutIdentity(id:string,bindings:ModuleBindings,names:ReadonlyMap<AnyEffect,string>,trees:readonly unknown[],locals:ReadonlyMap<object,string>):string{
  const seen=new Map<object,number>();
  const encode=(value:any):any=>{
    if(value===undefined)return['undefined'];
    if(typeof value==='bigint')return['bigint',value.toString()];
    if(typeof value==='number'&&!Number.isFinite(value))return['number',String(value)];
    if(Object.is(value,-0))return['number','-0'];
    if(typeof value==='function')return['code',value.toString()];
    if(value===null||typeof value!=='object')return value;
    if(locals.has(value))return['local',locals.get(value)];
    if(authorities.has(value))return['authority',bindings.indices.get(authorities.get(value)!.definition)];
    if(names.has(value))return['effect',names.get(value)];
    if(bindings.indices.has(value))return['definition',bindings.indices.get(value)];
    const expression=expressions.get(value);
    if(expression)return['expression',expression.source,expression.inputs.map(encode),expression.references.map(encode)];
    if(seen.has(value))return['ref',seen.get(value)];seen.set(value,seen.size);
    if(Array.isArray(value))return['array',value.length,Object.keys(value).map(key=>[key,encode((value as any)[key])])];
    return['object',Object.keys(value).map(key=>[key,encode((value as any)[key])])];
  };
  const statics=bindings.definitions.map(definition=>{
    const metadata=staticDefinitions.get(definition)!;
    return[metadata.kind,Object.keys(metadata).filter(key=>key!=='creator'&&key!=='input'&&key!=='output'&&key!=='schema'&&key!=='config'&&key!=='setup'&&key!=='schemaPlan'&&key!=='inputPlan'&&key!=='outputPlan'&&key!=='setupPlan').map(key=>[key,encode((metadata as any)[key])]),
      metadata.kind==='entity'?encode(metadata.config):null];
  });
  const effects=[...names].map(([effect,name])=>{const metadata=definitions.get(effect)!;return[name,metadata.kind,metadata.kind==='author'?metadata.build.toString():metadata.kind==='port'?metadata.port:metadata.kind==='bound'?[metadata.bind.toString(),encode(metadata.layout)]:metadata.lower.toString()];});
  return id+'/'+layoutDigest(JSON.stringify({statics,effects,trees:trees.map(encode),lifecycles:bindings.lifecycles.map(encode)}));
}
