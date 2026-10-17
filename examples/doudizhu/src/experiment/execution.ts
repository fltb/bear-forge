import { RegistrationSchema } from './registration.schemas.ts';
import type { Registration, Task } from './experiment.types.ts';
import { createExperimentRunner, implementationIdentity } from '@bear-forge/experiments';
import type { TaskResult, ExperimentDefinition } from '@bear-forge/experiments';
import { createScript } from '@bear-forge/policies';
import { createCardLoader, fileSnapshotStore } from '@bear-forge/runtime-card';
import { game } from '../module.ts';
import type { DouDizhuTypes } from '../types.ts';

export { RegistrationSchema } from './registration.schemas.ts';
export type { Registration, Task } from './experiment.types.ts';
export function createTasks(config: Registration): Task[] {
  return Array.from({ length: config.games }, (_, index) => ({
    id: config.id + '-' + index, seed: (config.seed + index) >>> 0, seats: [...config.seats]
  }));
}
export function summarize(row: TaskResult<Task>) {
  return { id: row.id, seed: row.input.seed, seats: row.input.seats, status: row.status,
    result: row.result, decisions: row.decisions.length, cost: row.cost,
    error: row.error ?? null };
}
/** Game-specific wiring; callers can supply model policies to the same runner. */
export function createDoudizhuRunner<T extends Task = Task>(overrides?: Pick<
  ExperimentDefinition<DouDizhuTypes, T, Registration, ReturnType<typeof summarize>>, 'policies' | 'identity' | 'tasks'>) {
return createExperimentRunner<DouDizhuTypes, T, Registration, ReturnType<typeof summarize>>({
  contract: game.contract,
  execution: {
    identity: { kind: 'card', rule: game.definition.id },
    load: ({ controlled, stepBudget, snapshotDirectory }) => createCardLoader({
      controlled, stepBudget, recordCore: true,
      ...(snapshotDirectory ? { snapshots: fileSnapshotStore(snapshotDirectory) } : {})
    }).load(game.definition)
  },
  parseRegistration: value => RegistrationSchema.parse(value),
  tasks: overrides?.tasks ?? (createTasks as (config: Registration) => T[]),
  setup: task => ({ seed: task.seed, game: {
    profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0
  } }),
  policies: overrides?.policies ?? (task => Object.fromEntries(task.seats.map((kind, seat) => [String(seat), createScript(kind)]))),
  facts: () => [],
  summarize,
  identity: overrides?.identity ?? (() => implementationIdentity(['examples/doudizhu/src'], {
    rule: game.definition.id, policies: ['first-legal@1', 'last-legal@1', 'random-legal@1'], encoder: 'plain-request@1'
  }))
});
}
export const { runTask, runExperiment } = createDoudizhuRunner();
