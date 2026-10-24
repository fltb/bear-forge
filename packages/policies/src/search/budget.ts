import type {SearchLimits} from './search.types.ts';

export const defaultSearchLimits: Readonly<SearchLimits> = Object.freeze({
  mode: 'wall', milliseconds: 2000, simulations: 256, worlds: 8, attempts: 64,
  decisions: 64, rounds: 8, nodes: 10_000, rssBytes: 1024 ** 3,
});
export class SearchStopped extends Error {}
/** All phases share this budget, including rejected construction and cleanup. */
export class SearchBudget {
  readonly started: number;
  attempts = 0;
  rejected = 0;
  accepted = 0;
  simulations = 0;
  completed = 0;
  truncated = 0;
  advances = 0;
  nodes = 0;
  reason: string | null = null;
  private preparationMilliseconds=0;
  private preparationIncluded=false;
  private peakRssBytes = 0;
  private longestSegmentMilliseconds = 0;
  private readonly phases: Record<string,{calls:number;milliseconds:number}> = {};
  readonly limits: SearchLimits;
  readonly signal: AbortSignal;
  private readonly clock: () => number;
  private readonly rss: () => number;
  private readonly safetyMilliseconds: number;
  constructor(limits: SearchLimits, signal: AbortSignal,
    clock = () => performance.now(), rss = () => process.memoryUsage().rss, safetyMilliseconds = Infinity) {
    this.limits = limits; this.signal = signal; this.clock = clock; this.rss = rss;
    if (!(safetyMilliseconds > 0)) throw Error('Invalid search safety allowance');
    this.safetyMilliseconds = safetyMilliseconds;
    for (const [name, value] of Object.entries(limits)) {
      if (name !== 'mode' && (!Number.isSafeInteger(value) || Number(value) < 1)) throw Error('Invalid search limit: ' + name);
    }
    if (limits.mode !== 'work' && limits.mode !== 'wall') throw Error('Invalid search budget mode');
    this.started = clock();
  }
  includePreparation(cost:{milliseconds:number;nodes:number}){
    if(this.preparationIncluded||this.nodes!==0||!Number.isFinite(cost.milliseconds)||cost.milliseconds<0||!Number.isSafeInteger(cost.nodes)||cost.nodes<0)throw Error('Invalid search preparation cost');
    this.preparationIncluded=true;this.preparationMilliseconds=cost.milliseconds;this.nodes=cost.nodes;
    this.phases.preparation={calls:1,milliseconds:cost.milliseconds};
    if(this.nodes>this.limits.nodes)this.reason='node-budget';
  }
  check() {
    if (this.signal.aborted) { this.reason = 'cancelled'; throw new SearchStopped(this.reason); }
    this.peakRssBytes = Math.max(this.peakRssBytes, this.rss());
    if (this.peakRssBytes >= this.limits.rssBytes) this.reason = 'memory-budget';
    else if (this.clock() - this.started >= this.safetyMilliseconds) this.reason = 'game-search-budget';
    else if (this.limits.mode === 'wall' && this.preparationMilliseconds + this.clock() - this.started >= this.limits.milliseconds) this.reason = 'wall-budget';
    // Work mode ignores the clock, but never disables the process safety cap.
    // Resource-censored runs are labelled and excluded from work-matched claims.
    if (this.reason) throw new SearchStopped(this.reason);
  }
  /** Includes transient probability Contexts as well as retained tree nodes.
   * This is a conservative cumulative allocation cap, not just final tree size. */
  allocateNode() {
    this.check();
    if(this.nodes>=this.limits.nodes){this.reason='node-budget';throw new SearchStopped(this.reason);}
    this.nodes++;
  }
  measureSync<T>(operation:()=>T,phase:string):T {
    const start=this.clock();
    try{return operation();}
    finally{
      const elapsed=this.clock()-start;
      this.longestSegmentMilliseconds=Math.max(this.longestSegmentMilliseconds,elapsed);
      const total=this.phases[phase]??={calls:0,milliseconds:0};total.calls++;total.milliseconds+=elapsed;
    }
  }
  async segment<T>(operation: () => Promise<T>, phase = 'other'): Promise<T> {
    this.check();
    return this.measure(operation,phase);
  }
  /** Cleanup and the mandatory public projection are timed even after stop.
   * Phase durations enclose calls; nested/overlapping calls are not additive. */
  async measure<T>(operation: () => Promise<T>, phase: string): Promise<T> {
    const start = this.clock();
    try { return await operation(); }
    finally {
      const elapsed = this.clock() - start;
      this.longestSegmentMilliseconds = Math.max(this.longestSegmentMilliseconds,elapsed);
      const total = this.phases[phase] ??= {calls:0,milliseconds:0};
      total.calls++; total.milliseconds += elapsed;
    }
  }
  cost() {
    this.peakRssBytes = Math.max(this.peakRssBytes, this.rss());
    return {milliseconds: this.preparationMilliseconds + this.clock() - this.started, peakRssBytes: this.peakRssBytes,
      longestSegmentMilliseconds: this.longestSegmentMilliseconds,phases:structuredClone(this.phases)};
  }
}
