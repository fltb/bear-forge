/** Snapshot-only admission hooks are linked metadata, never Context data. */
const admissions=new WeakMap<object,(state:unknown)=>void>();
export function attachCardAdmission(definition:{effects:object},admit:(state:unknown)=>void):void{admissions.set(definition.effects,admit);}
export function cardAdmissionFor(definition:{effects:object}):((state:unknown)=>void)|undefined{return admissions.get(definition.effects);}
