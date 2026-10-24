import {search, SearchBudget, defaultSearchLimits, type Policy, type SearchLimits, type SearchResult} from '@bear-forge/policies';
import type {JsonValue} from '@bear-forge/contracts/game';
import type {GameHandle} from '@bear-forge/contracts/loading';
import type {StsTypes} from '../contract.ts';
import {createStsProbabilityContinuation} from './probability-current.ts';
import {publicDecision, publicData,readVisibleEvents} from './information.ts';
import {position, baseline, evaluationVersion} from './evaluation.ts';
import {openStsSearchBudget} from './resources.ts';
import {ActionSchema} from '../game.schemas.ts';

export type StsSearchOptions = {
  character: 'ironclad' | 'volibear';
  algorithm: 'r0' | 'r1' | 'r2';
  limits?: Partial<SearchLimits>;
  /** Host forks the actual waiting Context; no reconstruction or masking. */
  forkCurrent?: () => Promise<GameHandle<StsTypes>>;
  // The experiment host persists this independently of accepted policy memory.
  account?: {milliseconds: number};
  onEvidence?: (result: SearchResult) => void;
};
export function createSearchPolicy(options: StsSearchOptions): Policy {
  const limits = {...defaultSearchLimits, ...options.limits};
  const version = 'sts-player-' + options.algorithm + '@4';
  let consumedMilliseconds = 0;
  return {version, encoderVersion: evaluationVersion,
    async decide(input) {
      // Missing host ownership is a configuration error even after exhaustion.
      if (options.algorithm !== 'r0' && !options.forkCurrent) throw Error('STS search requires the actual current Context from its host');
      const started = performance.now();
      consumedMilliseconds = Math.max(consumedMilliseconds, options.account?.milliseconds ?? 0);
      if (limits.mode === 'wall' && input.memory && typeof input.memory === 'object' && !Array.isArray(input.memory) &&
          typeof input.memory.searchMilliseconds === 'number') consumedMilliseconds = Math.max(consumedMilliseconds, input.memory.searchMilliseconds);
      let resources:Awaited<ReturnType<typeof openStsSearchBudget>>|undefined;
      try {
        resources=options.forkCurrent?await openStsSearchBudget(options.forkCurrent,limits,input.signal,consumedMilliseconds,started):undefined;
        const remaining = resources?.remaining??Math.max(0, 60_000 - consumedMilliseconds);
        const algorithm = remaining === 0 ? 'r0' : options.algorithm;
        const budget = resources?.budget??new SearchBudget({...limits, milliseconds: Math.max(1, Math.min(limits.milliseconds, Math.floor(remaining)))},
          input.signal, undefined, undefined, algorithm === 'r0' ? Infinity : remaining);
        if (input.signal.aborted) throw Error('Search cancelled');
        const {root,publicPosition} = await budget.measure(async()=>{
          const root=publicDecision(input.request,input.visibleHistory);
          return {root,publicPosition:position(root)};
        },'projection');
        const continuation = createStsProbabilityContinuation();
        const result = await search({root: publicPosition, baseline,
          current: async random => {
            if (!options.forkCurrent) throw Error('STS search requires the actual current Context from its host');
            const current = await continuation.take(options.forkCurrent, readVisibleEvents(input.visibleHistory),budget);
            budget.accepted++;
            return {particles:[{current,weight:1}],representation:continuation.representation(current),random,reason:null,method:'actual-current'};
          },
          next: continuation.next}, algorithm, input.random, budget);
        if (algorithm !== options.algorithm) result.evidence.reason = 'game-search-budget';
        if (input.signal.aborted) throw Error('Search cancelled');
        options.onEvidence?.(structuredClone(result));
        const action = ActionSchema.parse(result.action);
        // Only accepted proposals commit evidence and the policy random cursor.
        const nextMemory: JsonValue = publicData({version: 'sts-belief-search@1', evidence: result.evidence,
          ...(limits.mode === 'wall' ? {searchMilliseconds: (resources?.accountMilliseconds??consumedMilliseconds) + performance.now() - started} : {})});
        return {action, nextMemory, nextRandom: result.random, policyVersion: version,
          encoderVersion: evaluationVersion, logProbability: null};
      } finally {
        // Includes discarded candidates in the live worker's total cost.
        consumedMilliseconds = resources?resources.close():consumedMilliseconds+performance.now()-started;
        if (options.account) options.account.milliseconds = consumedMilliseconds;
      }
    },
  };
}
