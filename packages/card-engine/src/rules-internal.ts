import type {ChoiceReplyGuard} from './rules-reply-guards.ts';
import type { ModuleBindings } from './rules-module-internal.ts';
import type { CardStep } from './card.types.ts';
import type { CardScope } from './card.types.ts';
import type { Builder, Effect, Input, Value } from './rules.types.ts';

export type AnyEffect = Effect<any, any>;
export type Owner = object;
export type ExpressionContext = {
  input: any;
  locals: Record<string, any>;
  slots: ReadonlyMap<object, string>;
  owner: Owner;
  world: unknown;
  bindings: ModuleBindings;
  identity:()=>string;
  evaluate: (input:unknown)=>any;
  entityEffect:(selector:object,entity:number)=>{program:string;effect:number;source:number;selector:number};
  lexical: ReadonlyMap<object, (context: ExpressionContext) => any>;
};
export type Expression = {
  owner: Owner | null;
  read: (context: ExpressionContext) => any;
  inputs: readonly unknown[];
  references: readonly object[];
  source:string;
  effectSelector:{kind:object;select:(config:any)=>AnyEffect}|null;
};
export type Node =
  | { kind: 'sequence'; steps: object[] }
  | { kind: 'when'; test: Input<boolean>; yes: object; no: object }
  | { kind: 'while'; test: Input<boolean>; body: object }
  | { kind: 'each'; items: Input<readonly unknown[]>; item: object; body: object }
  | { kind: 'call'; definition: AnyEffect | Value<AnyEffect>; input: unknown }
  | { kind: 'assign'; slot: object; value: unknown }
  | { kind: 'return'; value: unknown };
export type LoweringContext={bindings:ModuleBindings;names:Map<AnyEffect,string>;ensure:(effect:AnyEffect)=>string;register:(definition:object)=>number;identity:()=>string;effectName:(index:number)=>string|undefined;resolveReference:(reference:any,entities:any,allowStatic:boolean,activeSource?:number|null)=>string;ports:ReadonlySet<string>;guard:(effect:AnyEffect,guard:ChoiceReplyGuard)=>void};
export type EffectBody =
  | { kind: 'author'; build: (b: Builder<any, any>) => object }
  | { kind: 'port'; port: string }
  | {kind:'compiled';lower:(context:LoweringContext)=>readonly CardStep<any>[]}
  | { kind: 'bound'; layout?:unknown; bind: (bindings: ModuleBindings) => (scope: CardScope<any>, input: any) => any };
export const expressions = new WeakMap<object, Expression>();
export const slots = new WeakMap<object, Owner>();
export const statements = new WeakMap<object, Node>();
export const definitionCapture: { current: AnyEffect[] | null } = { current: null };
export const definitions = new WeakMap<object, EffectBody>();
const opaqueHandles=new WeakSet<object>();
export function markStaticHandle(value:object):void{opaqueHandles.add(value);}
export function isStaticHandle(value:object):boolean{return opaqueHandles.has(value);}
export function handle<T>(): T { const value=Object.freeze({});opaqueHandles.add(value);return value as T; }
export function expression<T>(owner: Owner | null, read: Expression['read'], metadata:{inputs?:readonly unknown[];references?:readonly object[];source?:string;effectSelector?:{kind:object;select:(config:any)=>AnyEffect}}={}): Value<T> {
  const value = handle<Value<T>>(); expressions.set(value, { owner, read, inputs:metadata.inputs??[], references:metadata.references??[],source:metadata.source??read.toString(),effectSelector:metadata.effectSelector??null }); return value;
}
export function readExpression(value: object, context: ExpressionContext): any {
  const item = context.lexical.get(value); if (item) return item(context);
  const expression = expressions.get(value);
  if (!expression || expression.owner !== null && expression.owner !== context.owner) throw Error('Foreign rule expression');
  return expression.read(context);
}
/** Only a rule module with declared port authority may construct this implementation effect. */
export function portEffect<I, O>(port: string): Effect<I, O> {
  const effect = handle<Effect<I, O>>(); definitions.set(effect, { kind: 'port', port }); definitionCapture.current?.push(effect); return effect;
}

/** Capture immutable expression parameters while retaining opaque definition/value references. */
export function freezeAuthorInput<T>(input:T):T{
  const seen=new Map<object,any>(),active=new Set<object>();
  const visit=(value:any):any=>{
    if(value===null||typeof value!=='object'){
      if(typeof value==='function'||typeof value==='symbol')throw Error('Rule arguments must be data');return value;
    }
    if(opaqueHandles.has(value))return value;
    if(active.has(value))throw Error('Cyclic literal rule argument');
    if(seen.has(value))return seen.get(value);
    if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype)throw Error('Rule literal must be plain data');
    const out:any=Array.isArray(value)?new Array(value.length):{};seen.set(value,out);active.add(value);
    for(const key of Object.keys(value)){
      const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
      if(!Object.hasOwn(descriptor,'value'))throw Error('Rule literals cannot contain accessors');
      Object.defineProperty(out,key,{value:visit(descriptor.value),enumerable:true});
    }
    active.delete(value);return Object.freeze(out);
  };
  return visit(input);
}
