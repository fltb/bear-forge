/** Snapshot-only admission hooks are linked metadata, never Context data. */
const admissions=new WeakMap<object,(state:unknown)=>void>();
// A Program's frozen definition copy shares the source's static metadata.
// Keep only definition identities here; no query implementation or Context.
const definitionSources=new WeakMap<object,object>();
export function inheritCardDefinition(source:object,target:object):void{definitionSources.set(target,definitionSources.get(source)??source);}
export function cardDefinitionSource(definition:object):object{return definitionSources.get(definition)??definition;}
export function attachCardAdmission(definition:{effects:object},admit:(state:unknown)=>void):void{admissions.set(definition.effects,admit);}
export function cardAdmissionFor(definition:{effects:object}):((state:unknown)=>void)|undefined{return admissions.get(definition.effects);}

/** Private value-identity admission. Neither the ownership scope nor the
 * allocation clock is game state; durable images store relative ownership. */
const identities=new WeakMap<object,number>(),contextValues=new WeakSet<object>();
let epoch=0,contextDepth=0;
export function admitCardValueIdentity(value:object,context=contextDepth>0):void{
  if(!identities.has(value)){identities.set(value,++epoch);if(context)contextValues.add(value);}
}
export const cardValueEpoch=():number=>epoch;
export const cardValueBirth=(value:object):number|undefined=>identities.get(value);
export const hasCardValueIdentity=(value:object):boolean=>identities.has(value);
export const isContextCardValue=(value:object):boolean=>contextValues.has(value);
export function inCardValueContext<T>(run:()=>T):T{contextDepth++;try{return run();}finally{contextDepth--;}}
