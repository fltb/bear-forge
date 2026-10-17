import type { TaskInput } from '../experiment/experiment.types.ts';
export type OwnTask = TaskInput & { model: { players: string[]; version: string; stochastic: boolean } };
