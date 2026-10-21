import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {createCardLoader} from '@bear-forge/runtime-card';
import { ExperimentFiles, runExperiment, RegistrationSchema } from '@bear-forge/forge-duel/experiment/execution';
import type { TaskResult } from '@bear-forge/forge-duel/experiment/execution';
import { analyze } from '@bear-forge/forge-duel/experiment/analysis';
import { createEvidenceServer } from '@bear-forge/forge-duel-viewer';
import { runEvaluation } from '@bear-forge/forge-duel/evaluation/execution';
import { runCardGame, replayCardGame } from './card.ts';
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
  if(args[0]==='sts'){const {runSts}=await import('./sts.ts');await runSts(args.slice(1));return;}
  const [command, ...rest] = args,
    flags = argumentsOf(rest);
  const allowed: Record<string, string[]> = {
    'build:games': [],
    'card:run': ['game', 'native', 'seed', 'records'],
    'card:replay': ['game', 'native', 'records'],
    evaluate: ['output','config','resume'],
    experiment: ['output', 'config', 'resume', 'concurrency', 'memory-mb', 'compute-steps'],
    analyze: ['output', 'experiment'],
    demo: ['output', 'concurrency', 'memory-mb', 'compute-steps'],
    serve: ['output', 'port']
  };
  for (const key of Object.keys(flags)) if (!allowed[command!]?.includes(key)) throw Error('Unknown option --' + key);
  const budgets = Object.fromEntries([['concurrency', 'concurrency'], ['memory-mb', 'memoryBudgetMB'], ['compute-steps', 'computeStepBudget']].filter(([flag]) => flags[flag!] !== undefined).map(([flag, field]) => [field, Number(flags[flag!])]));
  const directory = typeof flags.output === 'string' ? flags.output : './data/forge';
  if (command === 'card:run' || command === 'card:replay') {
    if (flags.game !== 'forge-duel' && flags.game !== 'doudizhu' && flags.game !== 'sts') throw Error('--game must be forge-duel, doudizhu or sts');
    if (flags.native !== undefined && flags.native !== true) throw Error('--native takes no value');
    const seed = flags.game === 'sts' ? String(flags.seed ?? 991) : Number(flags.seed ?? 991);
    if (typeof seed === 'number' && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) throw Error('Invalid seed');
    if (flags.records !== undefined && typeof flags.records !== 'string') throw Error('--records requires a path');
    if (command === 'card:replay') {
      if (typeof flags.records !== 'string') throw Error('--records is required');
      console.log(JSON.stringify(await replayCardGame({ game: flags.game, controlled: flags.native !== true, records: flags.records })));
      return;
    }
    console.log(JSON.stringify(await runCardGame({ game: flags.game, controlled: flags.native !== true, seed, ...(typeof flags.records === 'string' ? { records: flags.records } : {}) })));
    return;
  }
  if (command === 'build:games') {
    await mkdir('./build', {
      recursive: true
    });
    for (const name of ['doudizhu', 'forge-duel', 'sts']) {
      const outfile = resolve('build', name + '.card.mjs');
      await build({ entryPoints: [resolve('examples', name, 'src/module.ts')], outfile,
        bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external' });
      const {game} = await import(pathToFileURL(outfile).href);
      const linked = await createCardLoader({controlled:false}).load(game.definition);
      if (!linked.ok) throw Error(linked.error.message);
      console.log('Linked Card Core ' + name);
    }
    return;
  }
  if (command === 'evaluate') {
    if(flags.resume!==undefined&&flags.resume!==true)throw Error('--resume takes no value');
    if(flags.resume&&flags.config!==undefined)throw Error('Resume uses frozen evaluation config');
    if(!flags.resume&&typeof flags.config!=='string')throw Error('--config is required');
    const input=typeof flags.config==='string'?JSON.parse(await readFile(flags.config,'utf8')):undefined;
    const state=await runEvaluation(directory,input,event=>console.log(JSON.stringify(event)));
    console.log(JSON.stringify(state.result,null,2));
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
    if (flags.experiment !== undefined && typeof flags.experiment !== 'string') throw Error('--experiment requires an id');
    const files = new ExperimentFiles(directory),
      registration: any = await files.read('registration');
    if (!registration) throw Error('No registration');
    if (flags.experiment !== undefined && flags.experiment !== registration.config.id) throw Error('Experiment id does not match the registered output directory');
    if(await files.read('evaluation-state'))throw Error('Use evaluate --resume to publish the frozen evaluation analysis');
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
  throw Error('Expected build:games, evaluate, experiment, analyze, demo or serve');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
