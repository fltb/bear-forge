import { z } from 'zod';

const ScriptSchema = z.enum(['first', 'last', 'random']);
export const RegistrationSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9._-]+$/),
  engine: z.enum(['native', 'controlled']).default('native'),
  seed: z.number().int().min(0).max(4294967295).default(7),
  games: z.number().int().min(1).max(10000).default(1),
  seats: z.tuple([ScriptSchema, ScriptSchema, ScriptSchema]),
  maxSteps: z.number().int().min(1).max(10000).default(600),
  maxAttempts: z.number().int().min(1).max(20).default(1),
  concurrency: z.number().int().min(1).max(4).default(1),
  checkpointEvery: z.number().int().min(0).max(10000).default(0),
  memoryBudgetMB: z.number().int().min(32).max(32768).default(4096),
  computeStepBudget: z.number().int().min(1000).max(1000000000).default(100000000)
});
