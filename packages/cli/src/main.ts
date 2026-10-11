import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileEntry, compileNativeEntry } from '@bear-forge/compiler';
import { ExperimentFiles, runExperiment, RegistrationSchema } from '@bear-forge/experiments';
import type { TaskResult } from '@bear-forge/experiments';
import { analyze } from '@bear-forge/analysis';
import { createEvidenceServer } from '@bear-forge/viewer';
export function argumentsOf(args: string[]) {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!key.startsWith('--')) throw Error('Unexpected argument ' + key);
    if (args[i + 1] && !args[i + 1]!.startsWith('--')) flags[key.slice(2)] = args[++i]!;else flags[key.slice(2)] = true;
  }
  return flags;
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args,
    flags = argumentsOf(rest);
  const allowed: Record<string, string[]> = {
    'build:games': [],
    experiment: ['output', 'config', 'resume', 'concurrency', 'memory-mb', 'compute-steps'],
    analyze: ['output'],
    demo: ['output', 'concurrency', 'memory-mb', 'compute-steps'],
    serve: ['output', 'port']
  };
  for (const key of Object.keys(flags)) if (!allowed[command!]?.includes(key)) throw Error('Unknown option --' + key);
  const budgets = Object.fromEntries([['concurrency', 'concurrency'], ['memory-mb', 'memoryBudgetMB'], ['compute-steps', 'computeStepBudget']].filter(([flag]) => flags[flag!] !== undefined).map(([flag, field]) => [field, Number(flags[flag!])]));
  const directory = typeof flags.output === 'string' ? flags.output : './data/forge';
  if (command === 'build:games') {
    await mkdir('./build', {
      recursive: true
    });
    for (const [name, path] of [['doudizhu', 'examples/doudizhu/src/controlled-entry.ts'], ['forge-duel', 'examples/forge-duel/src/module.ts']]) {
      const program = await compileEntry(resolve(path!), 'program');
      await writeFile('./build/' + name + '.program', program.content);
      await writeFile('./build/' + name + '.native.json', JSON.stringify(await compileNativeEntry(resolve(path!), 'program')));
      console.log('Compiled ' + name);
    }
    return;
  }
  if (command === 'experiment') {
    let config;
    if (flags.resume && Object.keys(budgets).length) throw Error('Resume uses the frozen registered budgets');
    if (!flags.resume) {
      if (typeof flags.config !== 'string') throw Error('--config is required');
      config = RegistrationSchema.parse({
        ...JSON.parse(await readFile(flags.config, 'utf8')),
        ...budgets
      });
    }
    if (config) console.log('Registered ' + config.blocks * 2 * config.policies.length * config.opponents.length * 2 * 4 + ' tasks; at most ' + config.maxSteps + ' decisions per game and ' + config.maxAttempts + ' attempts per task.');
    const run = await runExperiment(directory, config, (done, total) => {
      if (done % 16 === 0 || done === total) console.log(done + '/' + total);
    });
    console.log('Saved ' + run.results.length + ' tasks in ' + directory);
    return;
  }
  if (command === 'analyze') {
    const files = new ExperimentFiles(directory),
      registration: any = await files.read('registration');
    if (!registration) throw Error('No registration');
    const result = analyze(registration.config, await files.summaries());
    await files.write('analysis', result);
    console.log(JSON.stringify({
      experiment: result.experimentId,
      candidates: result.candidates,
      relations: result.relations.length,
      cost: result.cost
    }, null, 2));
    return;
  }
  if (command === 'demo') {
    await main(['build:games']);
    const files = new ExperimentFiles(directory);
    if (await files.read('registration')) throw Error('Demo requires an empty output directory; use experiment --resume to continue');
    const config = RegistrationSchema.parse({
      ...budgets,
      version: 1,
      game: 'forge-duel-v1',
      id: 'demo',
      blocks: 2,
      seed: 713,
      policies: ['first', 'last', 'random', 'rule'],
      opponents: ['first', 'rule'],
      maxSteps: 1000,
      maxAttempts: 2,
      minimumBlocks: 64,
      margin: 0.05,
      bootstrap: 2000,
      analysisSeed: 91
    });
    const run = await runExperiment(directory, config, (done, total) => {
      if (done % 16 === 0) console.log(done + '/' + total);
    });
    const result = analyze(config, run.results);
    await files.write('analysis', result);
    console.log('Demo complete: ' + result.cost.tasks + ' real games. Two blocks are a smoke demonstration; statistical conclusions remain unknown.');
    return;
  }
  if (command === 'serve') {
    const port = flags.port === undefined ? 4173 : Number(flags.port);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
    const server = createEvidenceServer(directory);
    server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port));
    return;
  }
  throw Error('Expected build:games, experiment, analyze, demo or serve');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
