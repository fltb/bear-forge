import type {LoadedCore, GameHandle} from '@bear-forge/contracts/loading';
import type {Outcome} from '@bear-forge/contracts/instance';
import type { GameModule, GameTypes, GameContract } from '@bear-forge/contracts/authoring';
import type { Policy } from '@bear-forge/policies';
export type TaskInput = { id: string; seed: number };
/** Host accounting is separate from accepted-only policy memory. It includes
 * discarded work and is checkpointed alongside, never inside, the proposal. */
export type PolicyResources = Record<string, {
  milliseconds: number;
  reservedMilliseconds?: number;
  costs: {milliseconds: number; peakRssBytes: number; longestSegmentMilliseconds: number;
    phases?: Record<string,{calls:number;milliseconds:number}>}[];
}>;
export type Registration = {
  id: string;
  engine?: 'native' | 'controlled' | undefined;
  checkpointEvery?: number;
  concurrency?: number;
  memoryBudgetMB?: number;
  computeStepBudget?: number;
  taskMilliseconds?: number;
  batchMilliseconds?: number;
  stopOnFault?: boolean;
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
  policyResources?: PolicyResources;
  cost: {
    milliseconds: number;
    reservedMilliseconds?: number;
    steps: number;
    cpuMilliseconds?: number;
    processPeakRssBytes?: number;
    snapshotMilliseconds?: number;
    snapshotBytes?: number;
    /** Added in the published summary/attempt record to the immutable task's
     * execution cost. Includes publication retries and recovery downtime;
     * sampled before the final accounting records are written. */
    publicationMilliseconds?: number;
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
  signal?: AbortSignal;
  deadline?: number;
  point?: (stage: 'before-advance' | 'after-advance' | 'after-snapshot' | 'before-commit' | 'after-commit', taskId: string) => void | Promise<void>;
  /** Latest live work has not been published durably. The task stays alive
   * and retries persistence only, including after cancellation. */
  persistenceWait?: (state:{taskId:string;stage:string;failures:number;error:string})=>void|Promise<void>;
};

/** Composition dependency, outside the frozen execution protocols. */
export type ExecutionProvider<G extends GameTypes> = {
  identity: unknown;
  load: (options: { controlled: boolean; stepBudget: number; snapshotDirectory?: string }) => Promise<Outcome<LoadedCore<G['setup'], G['ports'], G['programResult']>>>;
};
/** Both authoring backends produce the same LoadedCore consumed by the runner. */
export type ExperimentDefinition<G extends GameTypes, T extends TaskInput, C extends Registration, S extends { id: string }> = {
  parseRegistration: (value: unknown) => C;
  tasks: (config: C) => T[];
  setup: (task: T) => G['setup'];
  /** Prepare these policies while the actual game is idle at its request.
   * Other policies retain the normal concurrent BaseGame callback path. */
  requiresCurrent?: (task: T) => boolean;
  /** Budgets schedule durable unfinished search work, not terminal task
   * truncation. A new invocation continues the same checkpoint and attempt. */
  retainedSearch?:boolean;
  /** forkCurrent copies the actual waiting Context, including its continuation.
   * The caller owns the returned game. requiresCurrent enables acquisition from
   * policy decisions without changing the frozen BaseGame busy semantics. */
  policies: (task: T, resources: PolicyResources, forkCurrent: () => Promise<GameHandle<G>>) => Record<string, Policy>;
  /** Incremental enclosing checkpoint cost. It is sampled before the durable
   * checkpoint write and settled afterwards, including failed writes. */
  checkpointCost?: (task:T,resources:PolicyResources,forkCurrent:()=>Promise<GameHandle<G>>)=>Promise<(milliseconds:number)=>void>;
  facts: (record: unknown) => unknown[];
  summarize: (result: TaskResult<T>) => S;
  identity: () => Promise<unknown>;
} & ({ module: GameModule<G>; artifacts: { controlled: string; native: string } } | { contract: GameContract<G>; execution: ExecutionProvider<G> });
