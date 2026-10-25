import type {Effect,Borrowed} from './rules.types.ts';
import type {AtomRead,ComponentWrite,EventProposal} from './rules-module.types.ts';
import type {ProbabilityConstraint,ProbabilitySpace} from './probability.ts';

export type AtomProbability<I,O> = {
  space(input: Borrowed<I>): ProbabilitySpace;
  boundaryValue?(input:Borrowed<I>):unknown;
  /** Original ordering operation declares only what it has just revealed. */
  publication?(read:AtomRead<any>,input:Borrowed<I>,result:Borrowed<O>):unknown;
  constraints?(read:AtomRead<any>,input:Borrowed<I>,result:Borrowed<O>):readonly ProbabilityConstraint[];
  run(read: AtomRead<any>, input: Borrowed<I>, coordinate: bigint): {
    writes: readonly ComponentWrite<any>[];
    events: readonly EventProposal<any>[];
    result: O | Borrowed<O>;
  };
};
const kernels = new WeakMap<object,AtomProbability<any,any>>();
const independentResults = new WeakSet<object>();
/** Internal, source-reviewed proof obligation, NOT inferred from a discarded
 * return: all coordinate dependence must be confined to a total result value.
 * Component writes, emitted events and failures must be independent of it.
 * The linker separately proves its wrapper only returns that value. */
export function registerCoordinateIndependentResult(effect:object):void{
  independentResults.add(effect);
}
export function hasCoordinateIndependentEffects(effect:object):boolean{return independentResults.has(effect);}
/** Internal random/sorting primitive registration. The original atom's input,
 * output, ownership checks and commit path also apply to probability results. */
export function withProbability<I,O>(effect: Effect<I,O>, kernel: AtomProbability<I,O>): Effect<I,O> {
  kernels.set(effect,Object.freeze({...kernel})); return effect;
}
export function atomProbabilityFor(effect: object): AtomProbability<any,any> | undefined {return kernels.get(effect);}
