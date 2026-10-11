import type { Definition } from '@bear-forge/forge-duel';
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
export type TaskResult = {
  id: string;
  input: TaskInput;
  attempt: number;
  status: 'ended' | 'fault' | 'truncated';
  result: any;
  packets: any[];
  decisions: any[];
  facts: any[];
  policy: any;
  cost: {
    milliseconds: number;
    steps: number;
    cpuMilliseconds?: number;
    processPeakRssBytes?: number;
    snapshotMilliseconds?: number;
    snapshotBytes?: number;
  };
  attempts?: {
    attempt: number;
    started: number;
    finished?: number;
    status: string;
    cost?: {
      milliseconds: number;
      steps: number;
    };
  }[];
  error?: string;
  commits?: {
    taskId: string;
    logicalStep: number;
    accepted: any;
  }[];
  lineage?: {
    rootTaskId: string;
    parentTaskId: string | null;
    kind: 'actual' | 'branch';
  };
};
export type Registration = {
  version: 1;
  game: 'forge-duel-v1';
  engine?: 'native' | 'controlled' | undefined;
  id: string;
  blocks: number;
  seed: number;
  policies: Script[];
  opponents: Script[];
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
export type ExecutionHooks = {
  point?: (stage: 'before-advance' | 'after-advance' | 'after-snapshot' | 'before-commit' | 'after-commit', taskId: string) => void | Promise<void>;
};
export type TaskSummary = Omit<TaskResult, 'packets' | 'decisions' | 'facts' | 'policy'> & {
  opportunities: Record<string, {
    carry: number;
    draw: number;
    available: number;
    play: number;
  }>;
};
