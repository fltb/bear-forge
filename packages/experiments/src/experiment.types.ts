import type { GameModule, GameTypes } from '@bear-forge/contracts/authoring';
import type { Policy } from '@bear-forge/policies';
export type TaskInput = { id: string; seed: number };
export type Registration = {
  id: string;
  engine?: 'native' | 'controlled' | undefined;
  checkpointEvery?: number;
  concurrency?: number;
  memoryBudgetMB?: number;
  computeStepBudget?: number;
  maxSteps: number;
  maxAttempts: number;
};
export type TaskResult<T extends TaskInput = TaskInput> = {
  id: string;
  input: T;
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
export type ExecutionHooks = {
  point?: (stage: 'before-advance' | 'after-advance' | 'after-snapshot' | 'before-commit' | 'after-commit', taskId: string) => void | Promise<void>;
};

/** Outer experiment composition; game execution still uses the frozen GameModule. */
export type ExperimentDefinition<G extends GameTypes, T extends TaskInput, C extends Registration, S extends { id: string }> = {
  module: GameModule<G>;
  parseRegistration: (value: unknown) => C;
  tasks: (config: C) => T[];
  setup: (task: T) => G['setup'];
  policies: (task: T) => Record<string, Policy>;
  facts: (record: unknown) => unknown[];
  summarize: (result: TaskResult<T>) => S;
  identity: () => Promise<unknown>;
  artifacts: { controlled: string; native: string };
};
