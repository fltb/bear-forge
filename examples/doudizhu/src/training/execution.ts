import type { TaskResult } from '@bear-forge/experiments';
import { createDoudizhuRunner } from '../experiment/execution.ts';
import { ActionSchema, ObservedSchema, ResultSchema, seats } from '../schemas.ts';
import type { ModelTask, LearningRow } from './training.types.ts';
import { modelPolicy, evaluationScript } from './policy.ts';
import { LearnerClient } from './client.ts';

export function createModelRunner(client: LearnerClient, opponentModel?: { client: LearnerClient; version: string }) {
  return createDoudizhuRunner<ModelTask>({
    policies: task => {
      if (task.opponentModelVersion !== opponentModel?.version) throw Error('Opponent model version mismatch');
      return Object.fromEntries(seats.map((seat, index) => [seat,
      task.model.players.includes(seat) ? modelPolicy(client, task.model.version, task.model.epsilon)
        : opponentModel ? modelPolicy(opponentModel.client, opponentModel.version, 0) : evaluationScript(task.seats[index]!)]));
    },
    // Model tasks are supplied one at a time at a frozen policy version.
    tasks: () => { throw Error('Use model tasks with an explicit frozen policy version'); },
    identity: async () => ({ rule: 'competitive-2016-bear-1', backend: 'douzero' })
  }).runTask;
}

/** Join only accepted actions to the observation actually delivered at that time. */
export function learningRows(row: TaskResult<ModelTask>): LearningRow[] {
  if (row.status !== 'ended') return [];
  const result = ResultSchema.parse(row.result);
  const requests = new Map(row.packets.filter(packet => packet.kind === 'request')
    .map(packet => [JSON.stringify(packet.value.id), packet.value]));
  const rows: LearningRow[] = [];
  for (const decision of row.decisions) {
    if (!row.input.model.players.includes(decision.accepted.player)) continue;
    const request = requests.get(JSON.stringify(decision.accepted.reply.requestId));
    if (!request || request.player !== decision.accepted.player) throw Error('Accepted decision has no player observation');
    const observation = ObservedSchema.parse(request.observation);
    if (observation.observation.phase !== 'playing') continue;
    if (decision.proposal.policyVersion !== 'douzero:' + row.input.model.version) throw Error('Episode mixed model versions');
    const action = ActionSchema.parse(decision.accepted.reply.action);
    const landlord = request.player === result.landlord;
    rows.push({ observation, action, return: (result.winningSide === 'landlord') === landlord ? 1 : -1 });
  }
  return rows;
}
