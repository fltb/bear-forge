import { readFile, mkdir, copyFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { bootstrap } from '@bear-forge/analysis';
import { withWriter } from '@bear-forge/experiments';
import { TrainingConfigSchema } from './config.schemas.ts';
import { RegistrationSchema } from '../experiment/registration.schemas.ts';
import { seats, ResultSchema } from '../schemas.ts';
import { LearnerClient } from './client.ts';
import { createModelRunner, learningRows } from './execution.ts';
import type { ModelTask } from './training.types.ts';

const [command, configPath, ...extra] = process.argv.slice(2);
if (!configPath || extra.length || !['init', 'train', 'resume', 'eval'].includes(command ?? '')) {
  throw Error('Usage: npm run doudizhu:training -- init|train|resume|eval CONFIG.json');
}
const config = TrainingConfigSchema.parse(JSON.parse(await readFile(configPath, 'utf8')));
if (['resume', 'eval'].includes(command!) && !config.checkpoint) throw Error('resume/eval requires checkpoint');
if (['train', 'init'].includes(command!) && config.checkpoint) throw Error('Use resume to continue a checkpoint');
if (command === 'init' && !config.pretrainedDirectory) throw Error('init requires pretrainedDirectory');
if (config.checkpoint && config.pretrainedDirectory) throw Error('Cannot combine checkpoint and pretrainedDirectory');
if (command === 'train' && config.pretrainedMode === 'original') throw Error('Train requires extended model');
const output = resolve(config.output);
await mkdir(output, { recursive: true });
await withWriter(output, async () => {
if (command === 'train' || command === 'init') {
  let exists = false;
  try { await access(join(output, 'model.pt')); exists = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (exists) throw Error('Output already contains a model; use resume or a new directory');
}
const client = new LearnerClient(config.seed);
let previousClient: LearnerClient | undefined;
let teacherClient: LearnerClient | undefined;
const runTask = createModelRunner(client);
const budget = RegistrationSchema.parse({ id: 'model', seats: ['first', 'first', 'first'], maxSteps: config.maxSteps });
let stopping = false;
const stop = () => { stopping = true; };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const started = performance.now();
let playMilliseconds = 0, acceptedDecisions = 0, gcMilliseconds = 0, gcCount = 0;
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) { gcMilliseconds += entry.duration; gcCount++; }
});
observer.observe({ entryTypes: ['gc'] });

async function rotate(source: string, target: string) {
  try { await copyFile(source, target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

try {
  let status = await client.request({ command: 'status' });
  let metadata = { rule: 'competitive-2016-bear-1', initialSeed: config.seed, nextSeed: config.seed,
    episodes: 0, truncated: 0, epsilon: config.epsilon, maxSteps: config.maxSteps,
    teacherGames: 0, batchSamples: config.batchSamples, teacherVersion: null as string | null, teacherEvery: config.teacherEvery };
  if (config.checkpoint) {
    const restored = await client.request({ command: 'load', path: resolve(config.checkpoint) });
    status = restored;
    metadata = restored.metadata;
    if (metadata.rule !== 'competitive-2016-bear-1') throw Error('Checkpoint rule mismatch');
    if (command === 'resume' && metadata.batchSamples !== undefined && metadata.batchSamples !== config.batchSamples) throw Error('Resume batch size mismatch');
    metadata.teacherGames ??= 0;
    if (command === 'resume' && (metadata.epsilon !== config.epsilon || metadata.maxSteps !== config.maxSteps)) {
      throw Error('Resume must preserve the sampling configuration');
    }
  }
  if (config.pretrainedDirectory) {
    status = await client.request({ command: 'import-pretrained', directory: resolve(config.pretrainedDirectory), mode: config.pretrainedMode });
  }
  let teacher: any;
  if (config.teacherCheckpoint) {
    teacherClient = new LearnerClient(config.seed);
    teacher = await teacherClient.request({ command: 'load', path: resolve(config.teacherCheckpoint) });
    if (teacher.metadata.rule !== metadata.rule) throw Error('Teacher rule mismatch');
  }
  if (command === 'train' || command === 'resume') {
    if (status.modelKind !== 'extended') throw Error('Original baseline is frozen; initialize an extended model');
    if (command === 'resume' && ((metadata.teacherVersion ?? null) !== (teacher?.version ?? null)
        || (metadata.teacherVersion && metadata.teacherEvery !== config.teacherEvery))) throw Error('Resume teacher mismatch');
    await client.request({ command: 'configure', batchSamples: config.batchSamples });
    metadata.batchSamples = config.batchSamples;
    metadata.teacherVersion = teacher?.version ?? null;
    metadata.teacherEvery = config.teacherEvery;
  }
  const teacherRun = teacher ? createModelRunner(client, { client: teacherClient!, version: teacher.version }) : undefined;
  const initialSamples = status.samples;
  const initialUpdates = { ...status.updates };
  if (command === 'eval') {
    if (config.seed < metadata.nextSeed && config.seed + config.evaluationSeeds > metadata.initialSeed) {
      throw Error('Evaluation seeds overlap the training seed interval');
    }
    const results: { opponent: string; mode: string; seed: number; seat: string; role: string; win: number; score: number }[] = [];
    let previous: any;
    if (config.previousCheckpoint) {
      previousClient = new LearnerClient(config.seed);
      previous = await previousClient.request({ command: 'load', path: resolve(config.previousCheckpoint) });
      if (previous.metadata.rule !== metadata.rule) throw Error('Previous checkpoint rule mismatch');
      if (previous.version === status.version) throw Error('Previous opponent must be a different model version');
      if (config.seed < previous.metadata.nextSeed && config.seed + config.evaluationSeeds > previous.metadata.initialSeed) {
        throw Error('Evaluation seeds overlap previous model training seeds');
      }
    }
    const opponents = ['first', 'last', 'random', ...(previous ? ['previous'] : [])];
    const counts = { ended: 0, truncated: 0, fault: 0 };
    for (const opponent of opponents) {
      const evaluate = opponent === 'previous' ? createModelRunner(client, { client: previousClient!, version: previous.version }) : runTask;
      const script = opponent === 'previous' ? 'first' : opponent as 'first' | 'last' | 'random';
      for (let offset = 0; offset < config.evaluationSeeds && !stopping; offset++) {
        const groups = [
          ...(config.evaluationMode !== 'single' ? [
            { mode: 'team', players: ['2'] as typeof seats[number][], role: 'landlord' },
            { mode: 'team', players: ['0', '1'] as typeof seats[number][], role: 'peasants' }
          ] : []),
          ...(config.evaluationMode !== 'team' ? seats.map(player => ({ mode: 'single', players: [player], role: '' })) : [])
        ];
        for (const group of groups) {
          if (stopping) break;
          const seed = config.seed + offset;
          const row = await evaluate({ id: `eval-${opponent}-${group.mode}-${seed}-${group.players.join('-')}`, seed,
            seats: [script, script, script], model: { players: group.players, version: status.version, epsilon: 0 },
            ...(opponent === 'previous' ? { opponentModelVersion: previous.version } : {}) }, budget);
          counts[row.status]++;
          playMilliseconds += row.cost.milliseconds; acceptedDecisions += row.decisions.length;
          if (row.status === 'fault') throw Error(row.error ?? 'Evaluation fault');
          if (row.status === 'ended') {
            const result = ResultSchema.parse(row.result);
            if (result.landlord !== '2') throw Error('Fixed preplay landlord changed; evaluation seat mapping is invalid');
            const player = group.players[0]!;
            const distance = (Number(player) - Number(result.landlord) + 3) % 3;
            results.push({ opponent, mode: group.mode, seed, seat: group.players.join('+'),
              role: group.role || ['landlord', 'landlord_down', 'landlord_up'][distance]!,
              win: Number((result.winningSide === 'landlord') === (player === result.landlord)),
              score: group.players.reduce((sum, seat) => sum + result.scores[seat], 0) });
          }
        }
      }
      console.log(JSON.stringify({ event: 'evaluation-progress', opponent, ...counts }));
    }
    const summaries = [];
    for (const opponent of opponents) for (const mode of ['team', 'single']) {
      for (const group of mode === 'team' ? ['landlord', 'peasants', 'overall'] : ['landlord', 'landlord_down', 'landlord_up']) {
        const rows = results.filter(row => row.opponent === opponent && row.mode === mode && (group === 'overall' || row.role === group));
        if (!rows.length) continue;
        const clusters = new Map<number, number[]>();
        for (const row of rows) clusters.set(row.seed, [...(clusters.get(row.seed) ?? []), row.win]);
        const means = [...clusters.values()].map(values => values.reduce((a, b) => a + b, 0) / values.length);
        const rate = means.reduce((a, b) => a + b, 0) / means.length;
        // Each side has one Bernoulli outcome per seed; Wilson stays non-degenerate at 0/1.
        const n = means.length, z = 1.959963984540054, denom = 1 + z * z / n;
        const center = (rate + z * z / (2 * n)) / denom;
        const radius = z * Math.sqrt(rate * (1 - rate) / n + z * z / (4 * n * n)) / denom;
        summaries.push({ opponent, mode, dimension: mode === 'team' ? 'side' : 'role', group, games: rows.length, seeds: n,
          seedMeanWinRate: rate,
          seedMeanWinRate95: means.length > 1 ? bootstrap(means, config.seed, 2000, 0.025) : null,
          wilson95: group === 'overall' ? null : [Math.max(0, center - radius), Math.min(1, center + radius)],
          meanScore: rows.reduce((sum, row) => sum + row.score, 0) / rows.length });
      }
    }
    const final = await client.request({ command: 'status' });
    const previousStatus = previousClient ? await previousClient.request({ command: 'status' }) : null;
    console.log(JSON.stringify({ event: 'evaluation-complete', version: status.version, ...counts,
      evaluationMode: config.evaluationMode, preplay: 'lowest-positive-bid-no-double@1', previousVersion: previousStatus?.version ?? null,
      stopped: stopping, milliseconds: performance.now() - started, summaries,
      playMilliseconds, acceptedDecisions, learner: final.metrics, roundTripMilliseconds: client.timings,
      previousLearner: previousStatus?.metrics ?? null,
      gcMilliseconds, gcCount, processPeakRssBytes: process.resourceUsage().maxRSS * 1024 }));
  } else {
    const save = async () => {
      await rotate(join(output, 'previous-1.pt'), join(output, 'previous-2.pt'));
      await rotate(join(output, 'model.pt'), join(output, 'previous-1.pt'));
      await client.request({ command: 'save', path: join(output, 'model.pt'), metadata });
    };
    // Save a recoverable initial boundary before collecting any episodes.
    await save();
    while (command !== 'init' && !stopping && status.samples - initialSamples < config.samples && performance.now() - started < config.minutes * 60000) {
      if (metadata.nextSeed > 4294967295) throw Error('Training seed range exhausted');
      const vsTeacher = !!teacher && metadata.episodes % config.teacherEvery === 0;
      const students = !vsTeacher ? [...seats] : Math.floor(metadata.episodes / config.teacherEvery) % 2 === 0 ? ['2'] as typeof seats[number][] : ['0', '1'] as typeof seats[number][];
      const task: ModelTask = { id: 'train-' + metadata.nextSeed, seed: metadata.nextSeed,
        seats: ['first', 'first', 'first'], model: { players: students, version: status.version, epsilon: config.epsilon },
        ...(vsTeacher ? { opponentModelVersion: teacher.version } : {}) };
      const row = await (vsTeacher ? teacherRun! : runTask)(task, budget);
      playMilliseconds += row.cost.milliseconds; acceptedDecisions += row.decisions.length;
      if (row.status === 'fault') throw Error(row.error ?? 'Sampling fault');
      const rows = learningRows(row);
      if (rows.length) status = await client.request({ command: 'learn', version: status.version, rows });
      metadata.nextSeed++;
      metadata.episodes++;
      if (vsTeacher) metadata.teacherGames++;
      if (row.status === 'truncated') metadata.truncated++;
      if (metadata.episodes % 10 === 0) {
        await save();
        console.log(JSON.stringify({ event: 'training-progress', samples: status.samples, updates: status.updates,
          episodes: metadata.episodes, truncated: metadata.truncated, milliseconds: performance.now() - started }));
      }
    }
    await save();
    const final = await client.request({ command: 'status' });
    const teacherStatus = teacherClient ? await teacherClient.request({ command: 'status' }) : null;
    console.log(JSON.stringify({ event: command === 'init' ? 'initialization-complete' : 'training-complete', checkpoint: join(output, 'model.pt'),
      samples: status.samples, newSamples: status.samples - initialSamples, learnedSamples: final.learnedSamples,
      legacyLearnedSamples: final.legacyLearnedSamples, pendingSamples: final.pendingSamples, batchSamples: final.batchSamples, modelKind: final.modelKind, pretrained: final.pretrained, updates: status.updates, initialUpdates,
      episodes: metadata.episodes, teacherGames: metadata.teacherGames, teacherVersion: teacherStatus?.version ?? null,
      teacherUpdates: teacherStatus?.updates ?? null, teacherMetrics: teacherStatus?.metrics ?? null, truncated: metadata.truncated, stopped: stopping,
      milliseconds: performance.now() - started, playMilliseconds, acceptedDecisions,
      effectiveSamplesPerSecond: (status.samples - initialSamples) / ((performance.now() - started) / 1000),
      learner: final.metrics, roundTripMilliseconds: client.timings, gcMilliseconds, gcCount,
      processPeakRssBytes: process.resourceUsage().maxRSS * 1024 }));
  }
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  observer.disconnect();
  await Promise.all([client.close(), previousClient?.close(), teacherClient?.close()]);
}
});
