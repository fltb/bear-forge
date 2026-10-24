import {definitions,expression} from './rules-internal.ts';
import {resolveDefinition,staticDefinitions,type ModuleBindings} from './rules-module-internal.ts';
import type {Effect,Borrowed,Value} from './rules.types.ts';
import type {AtomRead,ComponentWrite,EventProposal} from './rules-module.types.ts';
import type {ProbabilityConstraint,ProbabilitySpace,ProbabilityEntropy,ProbabilityOutcomes,ForwardProbability,ForwardProbabilityResult} from './probability.ts';

export type AtomProbability<I,O> = {
  space(input: Borrowed<I>): ProbabilitySpace;
  /** Original ordering operation declares only what it has just revealed. */
  publication?(read:AtomRead<any>,input:Borrowed<I>,result:Borrowed<O>):unknown;
  constraints?(read:AtomRead<any>,input:Borrowed<I>,result:Borrowed<O>):readonly ProbabilityConstraint[];
  forward?:{
    plan(input:Borrowed<I>):Omit<NonNullable<ReturnType<ForwardProbability['plan']>>,'random'>|null;
    word:ForwardProbability['word'];
    project(state:unknown,input:Borrowed<I>):unknown;
    commit(read:AtomRead<any>,input:Borrowed<I>,result:ForwardProbabilityResult):ReturnType<AtomProbability<I,O>['run']>;
  };
  run(read: AtomRead<any>, input: Borrowed<I>, coordinate: bigint): {
    writes: readonly ComponentWrite<any>[];
    events: readonly EventProposal<any>[];
    result: O | Borrowed<O>;
  };
  partition?(input:Borrowed<I>,hint:unknown,maximum:number,source:ProbabilityEntropy):ProbabilityOutcomes|undefined;
  sample?(input: Borrowed<I>, source: ProbabilityEntropy): unknown;
  runSample?(read: AtomRead<any>, input: Borrowed<I>, value: unknown): ReturnType<AtomProbability<I,O>['run']>;
};
const kernels = new WeakMap<object,AtomProbability<any,any>>();
/** Internal random/sorting primitive registration. The original atom's input,
 * output, ownership checks and commit path also apply to probability results. */
export function withProbability<I,O>(effect: Effect<I,O>, kernel: AtomProbability<I,O>): Effect<I,O> {
  if (definitions.get(effect)?.kind!=='bound' || kernels.has(effect)) throw Error('Probability kernel requires an unbound atom kernel');
  kernels.set(effect,Object.freeze({...kernel})); return effect;
}
export function atomProbabilityFor(effect: object): AtomProbability<any,any> | undefined {return kernels.get(effect);}

const scheduledObservers=new WeakMap<ModuleBindings,Set<object>>();
/** Linker-only metadata: scheduled consumers also observe their event even
 * when they have no ordinary reaction registration. Never stored in Context. */
export function recordProbabilitySchedule(bindings:ModuleBindings,event:object):void {
  let targets=scheduledObservers.get(bindings);
  if(!targets){targets=new Set();scheduledObservers.set(bindings,targets);}
  targets.add(resolveDefinition(event));
}

/** A sufficient, conservative certificate for forgetting a sampled order
 * after otherwise order-equivariant operations. Callers must supply EVERY
 * extension point executed between the permutation and its concealment.
 * Any linked reaction, replacement, modifier or scheduled consumer refuses
 * the certificate, including dormant or subsequently uninstalled consumers.
 * This reads original Program metadata; it never evaluates a rule twice. */
export function unobservedRuleTargets(targets:readonly object[]):Value<boolean> {
  const references=targets.map(resolveDefinition),wanted=new Set(references);
  const known=new WeakMap<ModuleBindings,boolean>();
  return expression<boolean>(null,context=>{
    const bindings=context.bindings,cached=known.get(bindings);
    if(cached!==undefined)return cached;
    for(const target of references)if(!bindings.indices.has(target))throw Error('Unlinked probability observation target');
    const observed=bindings.definitions.some(definition=>{
      const metadata=staticDefinitions.get(definition);
      return metadata?.kind==='ability'&&wanted.has(metadata.target);
    })||references.some(target=>scheduledObservers.get(bindings)?.has(target));
    known.set(bindings,!observed);return !observed;
  },{references});
}
