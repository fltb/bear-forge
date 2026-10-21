import type {CardStep} from './card.types.ts';
// Private lowering proof: when the predicate holds, this block only manipulates
// its own scalar locals until return. It cannot expose them to author code.
const temporaryLocals=new WeakMap<object,(state:unknown)=>boolean>();
export function temporaryLocalBlock<S>(steps:readonly CardStep<S>[],when:(state:unknown)=>boolean):readonly CardStep<S>[] {
  temporaryLocals.set(steps,when);return steps;
}
export function temporaryLocalsFor(steps:object):((state:unknown)=>boolean)|undefined{return temporaryLocals.get(steps);}
