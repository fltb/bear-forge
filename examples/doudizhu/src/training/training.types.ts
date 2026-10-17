import type { Task } from '../experiment/experiment.types.ts';
import type { Seat, Observed, Action } from '../schemas.ts';

export type ModelTask = Task & {
  model: { players: Seat[]; version: string; epsilon: number };
  opponentModelVersion?: string;
};
export type LearningRow = { observation: Observed; action: Action; return: number };

export type OwnTask = Task & { model: { players: string[]; version: string; stochastic: boolean; playingOnly?: boolean }; opponent: string };
