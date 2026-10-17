import { RegistrationSchema, runExperiment } from '../src/experiment/execution.ts';

let advances = 0;
await runExperiment(process.argv[2]!, RegistrationSchema.parse({
  id: 'recovery', seats: ['random', 'random', 'random'], engine: 'controlled',
  seed: 7, checkpointEvery: 10, maxAttempts: 3
}), undefined, { point(stage) {
  if (stage === 'before-advance' && ++advances === 11) process.kill(process.pid, 'SIGKILL');
} });
