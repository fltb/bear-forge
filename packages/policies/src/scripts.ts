import { copy } from '@bear-forge/boundary';
import type { JsonValue } from '@bear-forge/contracts/game';
import type { Policy, PolicyRequest, RandomCursor, ConstructAdapter } from './policy.types.ts';
export function randomInt(cursor: RandomCursor, maximum: number) {
  const next = {
      ...cursor
    },
    limit = Math.floor(4294967296 / maximum) * maximum;
  let value;
  do {
    next.state = Math.imul(next.state, 1664525) + 1013904223 >>> 0;
    next.position++;
    value = next.state;
  } while (value >= limit);
  return {
    value: value % maximum,
    random: next
  };
}
export function createScript(kind: 'first' | 'last' | 'random' | 'rule', options: {
  score?: (action: JsonValue, request: PolicyRequest) => number;
  construct?: ConstructAdapter;
  version?: string;
} = {}): Policy {
  const version = options.version ?? kind + '-legal@1';
  return {
    version,
    encoderVersion: 'plain-request@1',
    async decide(input) {
      if (input.signal.aborted) throw Error('Cancelled');
      const request = copy(input.request);
      let action: JsonValue,
        random = {
          ...input.random
        },
        logProbability: number | null = null;
      if (request.options.kind === 'construct' && kind === 'random') {
        const sample = options.construct!.sample(request, random);
        action = sample.action;
        random = sample.random;
        logProbability = sample.logProbability;
      } else {
        const actions = request.options.kind === 'exact' ? request.options.values : options.construct!.ordered(request);
        if (kind === 'first') action = actions[0]!;else if (kind === 'last') action = actions.at(-1)!;else if (kind === 'random') {
          const sampled = randomInt(random, actions.length);
          random = sampled.random;
          action = actions[sampled.value]!;
          logProbability = -Math.log(actions.length);
        } else {
          let best = -Infinity;
          action = actions[0]!;
          for (const candidate of actions) {
            const score = options.score!(copy(candidate), request);
            if (score > best) {
              best = score;
              action = candidate;
            }
          }
        }
      }
      const old = typeof input.memory === 'object' && input.memory !== null && !Array.isArray(input.memory) ? input.memory : {};
      return {
        action: copy(action),
        nextMemory: {
          ...copy(old),
          decisions: typeof old.decisions === 'number' ? old.decisions + 1 : 1
        },
        nextRandom: random,
        policyVersion: version,
        encoderVersion: 'plain-request@1',
        logProbability
      };
    }
  };
}
