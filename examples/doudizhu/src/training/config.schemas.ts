import { z } from 'zod';

export const TrainingConfigSchema = z.strictObject({
  output: z.string().min(1),
  checkpoint: z.string().min(1).optional(),
  previousCheckpoint: z.string().min(1).optional(),
  pretrainedDirectory: z.string().min(1).optional(),
  pretrainedMode: z.enum(['original', 'extended']).default('extended'),
  teacherCheckpoint: z.string().min(1).optional(),
  teacherEvery: z.number().int().min(1).max(1000).default(2),
  batchSamples: z.number().int().min(1).max(10000).default(3200),
  evaluationMode: z.enum(['team', 'single', 'both']).default('team'),
  seed: z.number().int().min(0).max(4294960000).default(7),
  samples: z.number().int().min(1).max(10000000).default(20000),
  minutes: z.number().positive().max(60).default(10),
  epsilon: z.number().min(0).max(1).default(0.05),
  maxSteps: z.number().int().min(1).max(10000).default(600),
  evaluationSeeds: z.number().int().min(1).max(10000).default(300)
});
