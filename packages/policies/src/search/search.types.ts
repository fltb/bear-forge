import type {JsonValue} from '@bear-forge/contracts/game';
import type {RandomCursor} from '../policy.types.ts';
import type {SearchBudget} from './budget.ts';

/** Only the domain's player projection may cross this boundary. */
export type SearchPosition = {
  information: string;
  actions: {key: string; action: JsonValue}[];
  value: number;
  terminal: boolean;
  round: number;
};
/** A retained, independently owned current continuation, not an action prefix.
 * The search may see its public position only. The domain owns its execution state. */
export type SearchCurrent = {
  position: SearchPosition;
  close(): Promise<void>;
};
/** One complete action distribution. Probabilities are conditional on this
 * current and action and must sum to one; a partial set is never an edge. */
export type SearchSuccessor = {
  action: string;
  outcomes: {current: SearchCurrent; probability: number}[];
  representation: 'exact' | 'particles';
};
/** One search-owned entropy stream shared by all suspended next iterators.
 * Domains never seed it from a game Context. All work uses the same budget. */
export type SearchExpansion = {word():number;budget:SearchBudget};
export type CurrentSamples = {
  particles: {current: SearchCurrent; weight: number}[];
  /** Exact distribution or a finite empirical approximation; not a claim that
   * hidden variables are independent. The source owns the probability model. */
  representation: 'exact' | 'particles';
  random: RandomCursor;
  reason: string | null;
  method: string;
};
export type SearchDomain = {
  root: SearchPosition;
  baseline(position: SearchPosition): string;
  /** Supply owned current continuations. The actual current Context may be the root; never rebuild a prefix. */
  current(random: RandomCursor, budget: SearchBudget): Promise<CurrentSamples>;
  /** Called once per current. Each yielded action transfers its complete distribution.
   * Every outcome owns a distinct successor; uncertainty is generated here.
   * Yielded states remain alive until close(); iterator.return() releases only
   * unyielded resources. No reset, seek, start, or history-execution operation. */
  next(current: SearchCurrent, expansion: SearchExpansion): AsyncGenerator<SearchSuccessor, void, void>;
};
export type SearchLimits = {
  mode: 'work' | 'wall';
  milliseconds: number;
  simulations: number;
  worlds: number;
  attempts: number;
  decisions: number;
  rounds: number;
  nodes: number;
  rssBytes: number;
};
export type SearchScore = {lower: number; estimate: number; upper: number};
export type ActionEstimate = SearchScore & {
  key: string;
  expanded: boolean;
  outcomes: {probability: number; particles: number}[];
};
export type SearchEvidence = {
  algorithm: 'r0' | 'r1' | 'r2';
  solver: 'public-baseline' | 'fixed-policy-belief' | 'belief-ao';
  objective: 'finite-horizon-public-leaf-cost';
  representation: 'exact' | 'particles' | null;
  /** Bounds concern only the supplied model and configured leaf objective. */
  score: SearchScore;
  selectedUpperGap: number | null;
  method: string;
  reason: string | null;
  coverageComplete: boolean;
  actions: ActionEstimate[];
  attempts: number;
  rejected: number;
  accepted: number;
  simulations: number; // Belief-action expansions started, not sampled trajectories.
  completed: number; // Complete action edges published after all worlds advance.
  truncated: number; // Nonterminal belief leaves at the depth/round cutoff.
  advances: number;
  nodes: number;
};
export type SearchResult = {
  action: JsonValue;
  random: RandomCursor;
  evidence: SearchEvidence;
  // Timing is separate: deterministic-work evidence never includes scheduler noise.
  cost: {milliseconds: number; peakRssBytes: number; longestSegmentMilliseconds: number;
    phases: Record<string,{calls:number;milliseconds:number}>};
};
