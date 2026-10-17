import type { PolicyRequest } from '@bear-forge/policies';
export type Features = { tokens: number[][]; actions: number[][] };
export type Encode = (request: PolicyRequest) => Features;
export type Sample = Features & {
  index: number; logProbability: number; return: number;
  player: string; phase: string; requestId: string; version: string; teacherIndex?: number;
};
export type LearnerSettings = {
  rolloutSamples: number; minibatch: number; epochs: number; learningRate: number;
  clip: number; entropy: number; valueCoefficient: number; teacherCoefficient: number;
  gradientClip: number; dimension: number; layers: number;
};
