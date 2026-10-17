import { createScript, randomInt } from '@bear-forge/policies';
import type { Policy } from '@bear-forge/policies';
import { ObservedSchema } from '../schemas.ts';
import { LearnerClient } from './client.ts';

function preplayPolicy(version: string): Policy {
  return createScript('rule', { version, score: action => {
    const value = action as { kind: string; value: number | boolean };
    if (value.kind === 'bid') return Number(value.value) > 0 ? -Number(value.value) : -100;
    return value.value === false ? 1 : 0;
  } });
}

/** Evaluation controls preplay identically; original stage-1 scripts stay intact. */
export function evaluationScript(kind: 'first' | 'last' | 'random'): Policy {
  const version = kind + '-legal@1/playing-fixed-preplay@1';
  const playing = createScript(kind, { version }), preplay = preplayPolicy(version);
  return { ...playing, async decide(input) {
    return ObservedSchema.parse(input.request.observation).observation.phase === 'playing'
      ? playing.decide(input) : preplay.decide(input);
  } };
}

export function modelPolicy(client: LearnerClient, version: string, epsilon = 0): Policy {
  if (!(epsilon >= 0 && epsilon <= 1)) throw Error('Invalid exploration probability');
  const policyVersion = 'douzero:' + version;
  const first = createScript('first');
  const preplay = preplayPolicy(policyVersion);
  return {
    version: policyVersion, encoderVersion: 'bear-competitive-2016-douzero-v1',
    async decide(input) {
      const visible = ObservedSchema.parse(input.request.observation);
      if (visible.observation.phase !== 'playing') return preplay.decide(input);
      if (input.request.options.kind !== 'exact') throw Error('Model requires exact legal candidates');
      const actions = input.request.options.values;
      const base = await first.decide(input);
      const result = await client.request({ command: 'score', observation: visible, actions });
      if (input.signal.aborted) throw Error('Cancelled');
      if (result.version !== version || result.encoder !== 'bear-competitive-2016-douzero-v1'
        || !Number.isInteger(result.index) || result.index < 0 || result.index >= actions.length) {
        throw Error('Invalid or stale learner decision');
      }
      let index = result.index, random = { ...input.random };
      // Integer threshold gives an exact, recorded sampling distribution.
      const threshold = Math.floor(epsilon * 1000000), effectiveEpsilon = threshold / 1000000;
      if (threshold > 0) {
        const explore = randomInt(random, 1000000); random = explore.random;
        if (explore.value < threshold) {
          const chosen = randomInt(random, actions.length); index = chosen.value; random = chosen.random;
        }
      }
      return { ...base, action: structuredClone(actions[index]!), nextRandom: random,
        policyVersion, encoderVersion: 'bear-competitive-2016-douzero-v1',
        logProbability: Math.log(effectiveEpsilon / actions.length + (index === result.index ? 1 - effectiveEpsilon : 0)) };
    }
  };
}
