import { z } from 'zod';
export const OwnTrainingSchema = z.strictObject({
  game:z.enum(['doudizhu','forge-duel']),output:z.string().min(1),checkpoint:z.string().min(1).optional(),
  previousCheckpoint:z.string().min(1).optional(),teacherCheckpoint:z.string().min(1).optional(),
  teacher:z.boolean().default(false),opponentEvery:z.number().int().min(1).max(1000).default(4),
  seed:z.number().int().min(0).max(4294950000).default(30000),samples:z.number().int().min(1).max(10000000).default(20000),
  minutes:z.number().positive().max(60).default(10),maxSteps:z.number().int().min(1).max(10000).default(1000),
  reward:z.enum(['score','win']).default('score'),engine:z.enum(['native','controlled']).default('native'),
  evaluationSeeds:z.number().int().min(1).max(10000).default(100),evaluationScope:z.enum(['all','playing','both']).default('both'),
  checkpointEvery:z.number().int().min(1).max(10000).default(50),
  learner:z.strictObject({
    rolloutSamples:z.number().int().min(1).max(100000).default(1024),minibatch:z.number().int().min(1).max(256).default(32),
    epochs:z.number().int().min(1).max(20).default(4),learningRate:z.number().positive().max(.1).default(.0003),
    clip:z.number().positive().max(1).default(.2),entropy:z.number().nonnegative().max(1).default(.01),
    valueCoefficient:z.number().nonnegative().max(10).default(.5),teacherCoefficient:z.number().nonnegative().max(10).default(.2),
    gradientClip:z.number().positive().max(100).default(.5),dimension:z.union([z.literal(32),z.literal(48),z.literal(64)]).default(48),
    layers:z.number().int().min(1).max(4).default(2)
  }).prefault({})
});
