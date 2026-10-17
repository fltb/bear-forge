import type { TaskResult } from '@bear-forge/experiments';
import type { Encode, Sample } from './training.types.ts';

/** Only accepted requests become on-policy samples; each player has its own terminal utility. */
export function acceptedSamples(row: TaskResult, players: string[], version: string, encode: Encode,
  returns: Record<string, number>, phase: (observation: any) => string): Sample[] {
  if (row.status !== 'ended') return [];
  const requests = new Map(row.packets.filter(p => p.kind === 'request').map(p => [JSON.stringify(p.value.id), p.value]));
  const seen = new Set<string>(), samples: Sample[] = [];
  for (const decision of row.decisions) {
    const player = decision.accepted.player;
    if (!players.includes(player)) continue;
    const id = JSON.stringify(decision.accepted.reply.requestId), request = requests.get(id);
    if (!request || request.player !== player || seen.has(id)) throw Error('Missing or duplicate accepted request');
    seen.add(id);
    if (decision.proposal.policyVersion !== 'ppo:' + version || decision.proposal.encoderVersion !== 'card-features-v1') throw Error('Mixed rollout policy or encoder');
    if (request.options.kind !== 'exact') throw Error('Expected complete legal candidates');
    const index = request.options.values.findIndex((action: unknown) => JSON.stringify(action) === JSON.stringify(decision.accepted.reply.action));
    const probability = decision.proposal.logProbability;
    if (index < 0 || typeof probability !== 'number' || !Number.isFinite(probability) || probability > 0) throw Error('Invalid accepted action probability');
    const utility = returns[player];
    if (utility === undefined || !Number.isFinite(utility) || Math.abs(utility) > 1) throw Error('Missing player terminal utility');
    samples.push({ ...encode(request), index, logProbability: probability, return: utility,
      player, requestId: id, version, phase: phase(request.observation) });
  }
  return samples;
}
