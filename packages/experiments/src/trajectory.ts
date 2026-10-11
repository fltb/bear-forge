import type { TaskResult } from './experiment.types.ts';
/** Records the accepted candidate itself; never reverse-engineers actions from IO. */
export function trajectories(row: TaskResult) {
  return Object.fromEntries(['0', '1'].map(player => {
    const transitions = row.decisions.filter(d => d.accepted.player === player).map((d, i, all) => ({
      requestId: d.accepted.reply.requestId,
      type: d.accepted.reply.type,
      action: d.accepted.reply.action,
      policyVersion: d.proposal.policyVersion,
      encoderVersion: d.proposal.encoderVersion,
      logProbability: d.proposal.logProbability,
      reward: row.status === 'ended' && i === all.length - 1 ? row.result.scores[player] : 0,
      terminal: row.status === 'ended' && i === all.length - 1,
      step: d.step
    }));
    return [player, {
      transitions,
      packets: row.packets.filter(p => p.player === player),
      terminalReward: row.status === 'ended' ? row.result.scores[player] : null,
      outcome: row.status
    }];
  }));
}
