import { ExperimentFiles as Files, createExperimentRunner, implementationIdentity } from '@bear-forge/experiments';
import type { Types } from '../game.types.ts';
import { game } from '../module.ts';
import {createCardLoader,fileSnapshotStore} from '@bear-forge/runtime-card';
import { policy } from './policy.ts';
import { RegistrationSchema } from './registration.schemas.ts';
import { createTasks } from './tasks.ts';
import { taskSummary } from './summary.ts';
import type { TaskInput, TaskResult, TaskSummary, Registration } from './experiment.types.ts';
export class ExperimentFiles extends Files<TaskResult, TaskSummary> {
  constructor(directory: string) { super(directory, taskSummary); }
}
export const { runTask, runExperiment } = createExperimentRunner<Types, TaskInput, Registration, TaskSummary>({
  contract: game.contract,
  execution: {
    identity: { kind: 'card', rule: game.definition.id },
    load: ({ controlled, stepBudget, snapshotDirectory }) => createCardLoader({ controlled, stepBudget, recordCore: true,
      ...(snapshotDirectory ? { snapshots: fileSnapshotStore(snapshotDirectory) } : {}) }).load(game.definition),
  },
  parseRegistration: value => RegistrationSchema.parse(value),
  tasks: createTasks,
  setup: task => ({ profile: 'forge-duel-v1', seed: task.seed, first: '0', decks: task.decks }),
  policies: task => ({
    '0': policy(task.seat === '0' ? task.policy : task.opponent),
    '1': policy(task.seat === '1' ? task.policy : task.opponent)
  }),
  facts: (record: any) => record.kind === 'called' && record.call.port === 'event' ? record.call.input : [],
  summarize: taskSummary,
  identity: () => implementationIdentity(['examples/forge-duel/src'], {
    rule: 'forge-duel-v1', policies: ['first-legal@1', 'last-legal@1', 'random-legal@1', 'forge-rule@1'], encoder: 'plain-request@1'
  }),
});
export { RegistrationSchema, createTasks };
export { trajectories } from './trajectory.ts';
export type { TaskInput, TaskResult, TaskSummary, Registration, Script } from './experiment.types.ts';
