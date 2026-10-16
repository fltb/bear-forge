import type { TaskResult as ExperimentTaskResult } from '@bear-forge/experiments';
import type { Definition } from '../index.ts';
export type Script = 'first' | 'last' | 'random' | 'rule';
export type TaskInput = {
  id: string;
  phase: 'discovery' | 'confirmation';
  block: number;
  seed: number;
  seat: '0' | '1';
  policy: Script;
  opponent: Script;
  replacement: 0 | 1;
  support: 0 | 1;
  decks: Record<'0' | '1', Definition[]>;
};
export type TaskResult = ExperimentTaskResult<TaskInput>;
export type Registration = {
  version: 1;
  game: 'forge-duel-v1';
  engine?: 'native' | 'controlled' | undefined;
  id: string;
  blocks: number;
  seed: number;
  policies: Script[];
  opponents: Script[];
  /** 0 commits only the complete task; positive values checkpoint every N decisions. */
  checkpointEvery?: number;
  concurrency?: number;
  memoryBudgetMB?: number;
  computeStepBudget?: number;
  maxSteps: number;
  maxAttempts: number;
  minimumBlocks: number;
  margin: number;
  bootstrap: number;
  analysisSeed: number;
};
export type TaskSummary = Omit<TaskResult, 'packets' | 'decisions' | 'facts' | 'policy'> & {
  opportunities: Record<string, {
    carry: number;
    draw: number;
    available: number;
    play: number;
  }>;
};
