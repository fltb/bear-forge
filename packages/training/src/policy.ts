import { createScript, randomInt } from '@bear-forge/policies';
import type { Policy, RandomCursor } from '@bear-forge/policies';
import type { Encode } from './training.types.ts';
import { ProcessClient } from './client.ts';

/** Sample the exact dyadic weights represented by finite IEEE-754 exp(logit). */
export function categorical(logits: number[], cursor: RandomCursor, stochastic = true) {
  if (!logits.length || logits.some(x => !Number.isFinite(x))) throw Error('Invalid candidate logits');
  let best = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i]! > logits[best]!) best = i;
  if (!stochastic) return { index: best, random: { ...cursor }, logProbability: 0 };
  const maximum = logits[best]!, view = new DataView(new ArrayBuffer(8));
  const components = logits.map(value => {
    view.setFloat64(0, Math.exp(Math.max(-30, value - maximum)));
    const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
    return { mantissa: (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n),
      exponent: exponent ? exponent - 1023 - 52 : -1074 };
  });
  const exponent = Math.min(...components.map(x => x.exponent));
  const weights = components.map(x => x.mantissa << BigInt(x.exponent - exponent));
  const total = weights.reduce((a, b) => a + b, 0n);
  const bits = (total - 1n).toString(2).length, words = Math.ceil(bits / 32), mask = (1n << BigInt(bits)) - 1n;
  let random = { ...cursor }, value: bigint;
  do {
    value = 0n;
    for (let i = 0; i < words; i++) {
      const next = randomInt(random, 4294967296); random = next.random;
      value = (value << 32n) | BigInt(next.value);
    }
    value &= mask;
  } while (value >= total);
  let index = 0;
  while (value >= weights[index]!) value -= weights[index++]!;
  return { index, random, logProbability: Math.log(Number(weights[index]!)) - Math.log(Number(total)) };
}

export function transformerPolicy(client: ProcessClient, version: string, encode: Encode, stochastic = true): Policy {
  const base = createScript('first');
  return {
    version: 'ppo:' + version, encoderVersion: 'card-features-v1',
    async decide(input) {
      if (input.request.options.kind !== 'exact') throw Error('Transformer requires exact legal candidates');
      const features = encode(input.request);
      if (features.actions.length !== input.request.options.values.length) throw Error('Encoder changed legal action count');
      const response = await client.request({ command: 'score', features });
      if (input.signal.aborted) throw Error('Cancelled');
      if (response.version !== version || response.logits.length !== features.actions.length) throw Error('Stale or incomplete model result');
      const selected = categorical(response.logits, input.random, stochastic);
      const proposal = await base.decide(input);
      return { ...proposal, action: structuredClone(input.request.options.values[selected.index]!),
        nextRandom: selected.random, logProbability: selected.logProbability,
        policyVersion: 'ppo:' + version, encoderVersion: 'card-features-v1' };
    }
  };
}
