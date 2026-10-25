import type {CardScope} from './card.types.ts';
import {type ProbabilityMass} from './probability-mass.ts';

/** Data describing elementary outcomes, never rule code or an RNG snapshot. */
export type ProbabilitySpace =
  | {kind: 'uniform'; size: bigint}
  | {kind: 'weighted'; weights: readonly number[]}
  | {kind: 'rational'; weights: readonly ProbabilityMass[]}
  // An unresolved original operation, never an approximation or a terminal.
  // No coordinate may be committed until its complete law is implemented.
  | {kind: 'unavailable'; reason: string}
  | {kind: 'boundary'; name: string};
export type ProbabilityCoordinate = bigint;
export type ProbabilityStop = {kind: 'chance'; space: ProbabilitySpace};
/** Internal scheduler boundary at the next unexecuted instruction. No draw. */
export type ProbabilityYield = {kind:'yield'};
export type ProbabilityConstraint={name:string;values:readonly (string|number|boolean)[]};
export type ProbabilityOperation<S = any> = {
  /** Linker-owned atom wrapper: only its return uses the coordinate-dependent
   * value; writes, events and publications are coordinate-independent. */
  discardedReturnEquivalent?:true;
  space(scope: CardScope<S>): ProbabilitySpace;
  /** Read an already-computed public value at a scope marker. No execution. */
  boundaryValue?(scope:CardScope<S>):unknown;
  publication?(scope:CardScope<S>,result:unknown):unknown;
  /** Necessary conditions on future PUBLIC outputs, evaluated only on a
   * candidate branch. These never reveal the actual branch's hidden draws. */
  constraints?(scope:CardScope<S>,result:unknown):readonly ProbabilityConstraint[];
  resolve(scope: CardScope<S>, coordinate: bigint): unknown;
};
// Static Program metadata. No functions are stored in a Context or checkpoint.
const operations = new WeakMap<object, ProbabilityOperation>();
export function probabilityOperation<S>(operation: object, kernel: ProbabilityOperation<S>): void {
  operations.set(operation, Object.freeze({...kernel}));
}
export function probabilityOperationFor(operation: object): ProbabilityOperation | undefined {return operations.get(operation);}

export function permutationCount(length: number): bigint {
  let count=1n; for (let i=2;i<=length;i++) count*=BigInt(i); return count;
}
/** A coordinate selects one permutation of positions. Equal values keep their
 * positional multiplicity; the kernel never inspects card identity or rules. */
export function permutationAt<T>(items: readonly T[], coordinate: bigint): T[] {
  const size=permutationCount(items.length);
  const remaining=[...items], result:T[]=[];
  let divisor=size;
  for (let length=items.length;length>0;length--) {
    divisor/=BigInt(length);
    const index=Number(coordinate/divisor); coordinate%=divisor;
    result.push(remaining.splice(index,1)[0]!);
  }
  return result;
}

/** Inverse coordinate for a permutation of distinct stable member keys. */
export function permutationCoordinate<T>(items:readonly T[],order:readonly T[]):bigint{
  const remaining=[...items];let coordinate=0n,divisor=permutationCount(items.length);
  for(const item of order){
    divisor/=BigInt(remaining.length);const index=remaining.indexOf(item);
    coordinate+=BigInt(index)*divisor;remaining.splice(index,1);
  }
  return coordinate;
}
