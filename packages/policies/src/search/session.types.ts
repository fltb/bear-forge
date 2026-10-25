import type {CycleSearchSnapshot} from './cycles.ts';
import type {JsonValue} from '@bear-forge/contracts/game';
import type {ProbabilityMass} from '../../../card-engine/src/probability-mass.ts';

/** Measured work, independent of scheduling and of the represented space. */
export type SearchCost={milliseconds:number;peakRssBytes:number;longestSegmentMilliseconds:number;
  phases:Record<string,{calls:number;milliseconds:number}>};

/** A lexicographic vector of nonnegative terminal rewards. Components and
 * upper bounds are supplied by the domain, never by a depth cutoff. */
export type TerminalValue=ProbabilityMass[];
/** null denotes positive infinity, never a guessed finite cutoff. */
export type TerminalBound=(ProbabilityMass|null)[];
export type ExactPosition={information:string;actions:{key:string;action:JsonValue}[];priority:number;
  /** Public domain heuristics, used only by local scheduling/selection.
   * Original actions and chance laws remain retained; never an exact proof. */
  localExclusions?:{key:string;reason:string}[];
  /** Public strategy preference used only after all local value/risk ties.
   * It never changes probability mass, utility or exact proof bounds. */
  localTiePreferences?:Record<string,number>;
  /** Optional normalized local utility, distinct from work-order priority. */
  utility?:number;terminal:TerminalValue|null};
export type ExactOutcome<C>={current:C;mass:ProbabilityMass};
export type ExactExpansion<C,E>={
  readonly complete:boolean;
  readonly delivered:ProbabilityMass;
  /** Heuristic public-prefix values of untransferred mass, not successors or
   * terminal bounds. Reading must not execute or choose any original action. */
  localFrontier?():{mass:ProbabilityMass;utility:number}[];
  step():boolean;
  take():ExactOutcome<C>|undefined;
  save():E;
  close():void;
};
export type ExactDomain<C,S,E>={
  /** Componentwise upper bounds on every reachable terminal reward, with a
   * domain proof. Unfinished states receive no heuristic terminal reward. */
  upper:TerminalBound;
  position(current:C):ExactPosition;
  /** Sufficient proof of the same future action/observation law under this
   * domain. Must include control, aliases and hidden conditional state; equal
   * observations alone are NOT a proof. False negatives only miss reuse.
   * Pure: no advance, projection callbacks with effects or ownership changes. */
  equivalent?(left:C,right:C):boolean;
  next(current:C,action:string):ExactExpansion<C,E>;
  save(current:C):S;
  restore(saved:S):C;
  restoreExpansion(saved:E):ExactExpansion<C,E>;
  close(current:C):void;
};
export type ValueInterval={lower:TerminalValue;upper:TerminalBound};
export type ExecutionSnapshot<S,E>={current:S;identified?:boolean;equivalentTo?:number|null;edges:{action:string;complete:boolean;outcomes:{execution:number;mass:ProbabilityMass}[];expansion:E|null}[]};
/** parent is the original discovery parent, not the complete set of incoming
 * graph edges. Published outcomes may share a posterior or return to self. */
export type BeliefSnapshot={worlds:{execution:number;mass:ProbabilityMass}[];parent:number|null;edges:{action:string;nextWorld:number;published:boolean;outcomes:{belief:number;mass:ProbabilityMass}[]}[]};
export type SearchSessionSnapshot<S,E>={version:1;root:number;upper:TerminalBound;executions:ExecutionSnapshot<S,E>[];beliefs:BeliefSnapshot[];queue:{belief:number;action:string}[];steps:bigint;schedule?:{mode?:'exact'|'local';localRemaining:bigint;rootCursor?:bigint;localGroupCursor?:bigint;preferred:{belief:number;action:string}|null;prepared?:{execution:number;action:string}|null};cycles?:CycleSearchSnapshot[];cycleCursor?:bigint;preferCycle?:boolean};
