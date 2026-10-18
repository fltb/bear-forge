import { ExperimentFiles } from './files.ts';
import { withWriter } from './lock.ts';
import type { BatchState, BatchTransition } from './batches.types.ts';

/** Persists the next batch before executing it. Execution must use the existing idempotent runner. */
export async function runBatches<B, R>(options: {
  directory: string;
  initialize: () => Promise<B>;
  verify: () => Promise<void>;
  execute: (batch: B) => Promise<void>;
  advance: (completed: B[]) => Promise<BatchTransition<B, R>>;
  publish: (state: BatchState<B, R>) => Promise<void>;
}) {
  return withWriter(options.directory, async () => {
    const files = new ExperimentFiles(options.directory, (x: { id: string }) => x);
    await options.verify();
    let state = await files.read<BatchState<B, R>>('evaluation-state');
    if (!state) {
      state = { pending: await options.initialize(), completed: [], result: null };
      await files.write('evaluation-state', state);
    }
    await options.publish(state);
    while (state.pending !== null) {
      await options.execute(state.pending);
      const completed: B[] = [...state.completed, state.pending];
      const { next, result } = await options.advance(completed);
      state = { pending: next, completed, result };
      await files.write('evaluation-state', state);
      await options.publish(state);
    }
    return state;
  });
}
