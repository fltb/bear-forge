import { z } from 'zod';
export const RegistrationSchema = z.strictObject({
  version: z.literal(1),
  game: z.literal('forge-duel-v1'),
  engine: z.enum(['native', 'controlled']).optional(),
  id: z.string().regex(/^[a-zA-Z0-9._-]+$/),
  blocks: z.number().int().min(1).max(10000),
  seed: z.number().int().min(0).max(4294967295),
  policies: z.array(z.enum(['first', 'last', 'random', 'rule'])).min(1).max(4),
  opponents: z.array(z.enum(['first', 'last', 'random', 'rule'])).min(1).max(4),
  checkpointEvery: z.number().int().min(0).max(10000).default(0),
  concurrency: z.number().int().min(1).max(4).default(1),
  memoryBudgetMB: z.number().int().min(32).max(32768).default(4096),
  computeStepBudget: z.number().int().min(1000).max(1000000000).default(100000000),
  maxSteps: z.number().int().min(1).max(10000),
  maxAttempts: z.number().int().min(1).max(20),
  minimumBlocks: z.number().int().min(64),
  margin: z.number().positive().max(1),
  bootstrap: z.number().int().min(2000),
  analysisSeed: z.number().int().min(0).max(4294967295)
}).refine(c => new Set(c.policies).size === c.policies.length && new Set(c.opponents).size === c.opponents.length, {
  message: 'Policy lists must contain unique versions'
});
