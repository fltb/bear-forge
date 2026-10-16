import { ExperimentFiles, runTask } from '@bear-forge/forge-duel/experiment/execution';
const files = new ExperimentFiles(process.argv[2]!);
const registration: any = await files.read('registration');
let snapshots = 0;
await runTask(registration.tasks[0], registration.config, 1, files, {
  point(stage) {
    if (stage === 'after-snapshot' && ++snapshots === 3) process.exit(27);
  }
});
