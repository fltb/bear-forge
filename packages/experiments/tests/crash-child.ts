import { runExperiment } from '../src/index.ts';
await runExperiment(process.argv[2]!, undefined, undefined, {
  point(stage) {
    if (stage === process.argv[3]) process.exit(27);
  }
});
