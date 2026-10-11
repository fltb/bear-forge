import { createHash } from 'node:crypto';
import { withWriter } from './lock.ts';
import { implementationIdentity } from './identity.ts';
import { readFile, stat } from 'node:fs/promises';
import { createControlledLoader, programDigest, fileSnapshotStore } from '@bear-forge/runtime-controlled';
import { performance } from 'node:perf_hooks';
import type { Setup, State, Ports } from '@bear-forge/forge-duel';
import { game as module, cards } from '@bear-forge/forge-duel';
import { createNativeLoader, nativeProgram } from '@bear-forge/runtime-native';
import { createGameBinder } from '@bear-forge/game-host';
import { PolicyRouter, createScript } from '@bear-forge/policies';
import type { PolicyRequest } from '@bear-forge/policies';
import { ExperimentFiles } from './files.ts';
import { RegistrationSchema } from './registration.schemas.ts';
import { createTasks } from './tasks.ts';
import type { Registration, TaskInput, TaskResult, Script, ExecutionHooks } from './experiment.types.ts';
const nativePrograms = new Map<string, ReturnType<typeof nativeProgram<Setup, Ports, State>>>();
function approvedNative(artifact: any, stepBudget = 100000000) {
  const key = createHash('sha256').update(artifact.code).update(artifact.exportName).update(String(stepBudget)).digest('hex');
  let program = nativePrograms.get(key);
  if (!program) {
    program = nativeProgram<Setup, Ports, State>(artifact, {
      stepBudget
    });
    if (nativePrograms.size >= 4) nativePrograms.delete(nativePrograms.keys().next().value!);
    nativePrograms.set(key, program);
  }
  return program;
}
const unwrap = (x: any) => {
  if (!x.ok) throw Error(JSON.stringify(x.error));
  return x.value;
};
export function scoreAction(action: any, request: PolicyRequest) {
  const observation: any = request.observation,
    seat = request.player,
    enemy = seat === '0' ? '1' : '0';
  if (action.kind === 'end') return -100;
  if (action.kind === 'attack') {
    const unit = observation.heroes[seat].board.find((u: any) => u.id === action.unitId);
    if (action.target === 'hero:' + enemy) return observation.heroes[enemy].hp <= unit.attack ? 10000 : 10 + unit.attack;
    const target = observation.heroes[enemy].board.find((u: any) => u.id === action.target);
    return (target.hp <= unit.attack ? 30 : 0) + target.attack - (unit.hp <= target.attack ? unit.attack : 0);
  }
  const card = observation.hand.find((c: any) => c.id === action.cardId);
  if (!card) throw Error('Action card missing from legal observation');
  const rule = cards[card.definition as keyof typeof cards];
  if (rule.attack) return 20 + rule.attack + rule.hp;
  if (card.definition === 'repair') return Math.min(3, 20 - observation.heroes[seat].hp) - 10;
  if (card.definition === 'supply') return 5;
  if (action.target === 'hero:' + enemy) return observation.heroes[enemy].hp <= (card.definition === 'spark' ? 2 : 4) ? 10000 : 6;
  const target = observation.heroes[enemy].board.find((u: any) => u.id === action.target);
  return (target.hp <= (card.definition === 'spark' ? 2 : 4) ? 25 : 0) + target.attack;
}
const policy = (name: Script) => createScript(name, name === 'rule' ? {
  score: scoreAction,
  version: 'forge-rule@1'
} : {});
async function runTaskImplementation(task: TaskInput, config: Registration, attempt = 1, files?: ExperimentFiles, hooks: ExecutionHooks = {}): Promise<TaskResult> {
  const started = performance.now(),
    cpuStarted = process.cpuUsage();
  let snapshotMilliseconds = 0,
    snapshotBytes = 0;
  const controlled = config.engine === 'controlled';
  if (controlled && !files) throw Error('Controlled task requires its registered output directory');
  const saved: any = files ? await files.read('checkpoint-' + task.id) : null;
  let loaded: any;
  if (controlled) {
    const artifact: any = await files!.read('artifact');
    if (!artifact) throw Error('Missing frozen compiled artifact');
    loaded = unwrap(await createControlledLoader({
      trustedDigests: new Set([artifact.digest]),
      snapshots: fileSnapshotStore(files!.directory + '/snapshots'),
      stepBudget: config.computeStepBudget ?? 100000000
    }).load({
      content: new Uint8Array(Buffer.from(artifact.content, 'base64'))
    } as never));
  } else {
    const artifact: any = files ? await files.read('native-artifact') : null;
    loaded = unwrap(await createNativeLoader().load(artifact ? approvedNative(artifact, config.computeStepBudget) : module.program));
  }
  const instance = controlled && saved ? unwrap(await loaded.persistence.restore(saved.snapshot)) : unwrap(await loaded.core.start({
    profile: 'forge-duel-v1',
    seed: task.seed,
    first: '0',
    decks: task.decks
  }));
  const game = unwrap(await createGameBinder().bind({
    instance,
    contract: module.contract,
    ...(controlled ? {
      persistence: loaded.persistence
    } : {})
  }));
  const policies = {
      '0': policy(task.seat === '0' ? task.policy : task.opponent),
      '1': policy(task.seat === '1' ? task.policy : task.opponent)
    },
    router = new PolicyRouter(policies, task.seed, controlled ? saved?.policy : undefined);
  const packets: any[] = controlled ? saved?.packets ?? [] : [],
    decisions: any[] = controlled ? saved?.decisions ?? [] : [];
  for (const player of ['0', '1']) unwrap(await game.bind(router.binding(player)));
  const commits: any[] = controlled ? saved?.commits ?? [] : [];
  let previousSnapshot = controlled ? saved?.snapshot : undefined;
  let steps = controlled ? saved?.step ?? 0 : 0,
    status: TaskResult['status'] = 'truncated',
    result: any = null,
    error: string | undefined;
  try {
    for (; steps < config.maxSteps; steps++) {
      if (process.memoryUsage().rss > (config.memoryBudgetMB ?? 4096) * 1024 * 1024) throw Error('Experiment memory budget exceeded');
      router.begin();
      await hooks.point?.('before-advance', task.id);
      const next = unwrap(await game.run());
      await hooks.point?.('after-advance', task.id);
      const staged = router.prepare(next.accepted);
      router.commit(task.id + ':' + steps, staged.state);
      commits.push({
        taskId: task.id,
        logicalStep: steps,
        accepted: next.accepted
      });
      packets.push(...staged.packets);
      if (staged.candidate) decisions.push({
        step: steps,
        accepted: next.accepted,
        proposal: staged.candidate.proposal
      });
      if (controlled && (config.checkpointEvery ?? 0) > 0 && (steps + 1) % config.checkpointEvery! === 0 && next.state.kind !== 'fault' && next.state.kind !== 'ended') {
        const snapshotStart = performance.now(),
          snapshot = unwrap(await game.save());
        snapshotMilliseconds += performance.now() - snapshotStart;
        snapshotBytes += (await stat(files!.directory + '/snapshots/' + snapshot.snapshotId + '.snapshot')).size;
        await hooks.point?.('after-snapshot', task.id);
        await files!.write('checkpoint-' + task.id, {
          snapshot,
          policy: router.snapshot(),
          packets,
          decisions,
          commits,
          step: steps + 1
        });
        if (previousSnapshot) unwrap(await loaded.persistence.release(previousSnapshot));
        previousSnapshot = snapshot;
      }
      if (next.state.kind === 'ended') {
        result = next.state.result;
        status = 'ended';
        break;
      }
      if (next.state.kind === 'fault') {
        status = next.state.error.code === 'budget_exceeded' ? 'truncated' : 'fault';
        error = JSON.stringify(next.state.error);
        break;
      }
      if (next.pause) {
        status = 'fault';
        error = 'Unexpected policy pause: ' + next.pause;
        break;
      }
    }
  } catch (e) {
    error = String(e);
    status = /budget exceeded/i.test(error) ? 'truncated' : 'fault';
  } finally {
    await game.close();
  }
  let after: number | null = null;
  const facts: any[] = [];
  do {
    const page = unwrap(await loaded.capture.read(instance.id, {
      after,
      limit: 1000
    }));
    for (const record of page.records) {
      if (record.kind === 'called' && record.call.port === 'event') facts.push(...record.call.input);
    }
    after = page.next;
  } while (after !== null);
  unwrap(await loaded.capture.release(instance.id));
  return {
    id: task.id,
    input: task,
    attempt,
    status,
    result,
    packets,
    decisions,
    facts,
    commits,
    lineage: {
      rootTaskId: task.id,
      parentTaskId: null,
      kind: 'actual'
    },
    policy: router.snapshot(),
    cost: {
      milliseconds: performance.now() - started,
      steps: steps + 1,
      cpuMilliseconds: (process.cpuUsage(cpuStarted).user + process.cpuUsage(cpuStarted).system) / 1000,
      processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
      snapshotMilliseconds,
      snapshotBytes
    },
    ...(error ? {
      error
    } : {})
  };
}
export async function runTask(task: TaskInput, config: Registration, attempt = 1, files?: ExperimentFiles, hooks: ExecutionHooks = {}): Promise<TaskResult> {
  const started = performance.now();
  try {
    if (process.memoryUsage().rss > (config.memoryBudgetMB ?? 4096) * 1024 * 1024) throw Error('Experiment memory budget exceeded');
    return await runTaskImplementation(task, config, attempt, files, hooks);
  } catch (error) {
    const message = String(error);
    return {
      id: task.id,
      input: task,
      attempt,
      status: /budget|timed out/i.test(message) ? 'truncated' : 'fault',
      result: null,
      packets: [],
      decisions: [],
      facts: [],
      policy: {},
      lineage: {
        rootTaskId: task.id,
        parentTaskId: null,
        kind: 'actual'
      },
      cost: {
        milliseconds: performance.now() - started,
        steps: 0,
        processPeakRssBytes: process.resourceUsage().maxRSS * 1024
      },
      error: message
    };
  }
}
async function executeExperiment(directory: string, input?: Registration, onProgress?: (done: number, total: number) => void, hooks: ExecutionHooks = {}) {
  const files = new ExperimentFiles(directory);
  let registration: any = await files.read('registration');
  if (input) {
    const config = RegistrationSchema.parse(input),
      tasks = createTasks(config);
    await files.register(config, tasks);
    registration = {
      config,
      tasks
    };
  }
  if (!registration) throw Error('No registered experiment');
  registration.config = RegistrationSchema.parse(registration.config);
  const identity = await implementationIdentity(),
    frozen: any = await files.read('implementation');
  if (frozen && JSON.stringify(frozen) !== JSON.stringify(identity)) throw Error('Registered production code or dependency version changed');
  if (!frozen) await files.write('implementation', identity);
  if (registration.config.engine === 'controlled') {
    const old: any = await files.read('artifact');
    if (!old) {
      const content = new Uint8Array(await readFile('build/forge-duel.program'));
      await files.write('artifact', {
        content: Buffer.from(content).toString('base64'),
        digest: programDigest(content)
      });
    }
  } else {
    const old: any = await files.read('native-artifact');
    if (!old) {
      try {
        await files.write('native-artifact', JSON.parse(await readFile('build/forge-duel.native.json', 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  const existing = new Set((await files.summaries()).map(r => r.id));
  if (registration.config.engine === 'controlled') {
    for (const id of existing) await files.remove('checkpoint-' + id);
    await files.collectSnapshots();
  }
  let done = existing.size;
  async function executeTask(task: TaskInput) {
    let result: TaskResult | undefined;
    const prior: any = await files.read('attempt-' + task.id);
    for (let attempt = (prior?.attempt ?? 0) + 1; attempt <= registration.config.maxAttempts; attempt++) {
      const attemptKey = 'attempt-history-' + task.id + '-' + attempt;
      const start = {
        attempt,
        started: Date.now(),
        status: 'started'
      };
      await files.write(attemptKey, start);
      await files.write('attempt-' + task.id, start);
      result = await runTask(task, registration.config, attempt, files, hooks);
      const completed = {
        ...start,
        finished: Date.now(),
        cost: result.cost,
        error: result.error ?? null,
        status: result.status
      };
      await files.write(attemptKey, completed);
      await files.write('attempt-' + task.id, completed);
      if (result.status !== 'fault') break;
    }
    if (!result) result = {
      id: task.id,
      input: task,
      attempt: prior?.attempt ?? 0,
      status: 'fault',
      result: null,
      packets: [],
      decisions: [],
      facts: [],
      policy: {},
      cost: {
        milliseconds: 0,
        steps: 0
      },
      error: 'Attempt budget exhausted by interrupted runs'
    };
    result.attempts = [];
    for (let ordinal = 1; ordinal <= result.attempt; ordinal++) {
      const record: any = await files.read('attempt-history-' + task.id + '-' + ordinal);
      if (record) result.attempts.push(record);
    }
    await hooks.point?.('before-commit', task.id);
    await files.commit(task.id, result);
    await hooks.point?.('after-commit', task.id);
    if (registration.config.engine === 'controlled') {
      await files.remove('checkpoint-' + task.id);
    }
    onProgress?.(++done, registration.tasks.length);
  }
  const pending = (registration.tasks as TaskInput[]).filter(task => !existing.has(task.id)),
    concurrency = registration.config.concurrency ?? 1;
  for (let offset = 0; offset < pending.length; offset += concurrency) {
    await Promise.all(pending.slice(offset, offset + concurrency).map(executeTask));
    if (registration.config.engine === 'controlled') await files.collectSnapshots();
  }
  return {
    files,
    registration,
    results: await files.summaries()
  };
}
export function runExperiment(directory: string, input?: Registration, onProgress?: (done: number, total: number) => void, hooks: ExecutionHooks = {}) {
  return withWriter(directory, () => executeExperiment(directory, input, onProgress, hooks));
}
