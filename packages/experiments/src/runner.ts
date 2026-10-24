import { exceptionMessage } from '@bear-forge/runtime';
import { createHash } from 'node:crypto';
import { withWriter } from './lock.ts';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createControlledLoader, programDigest, fileSnapshotStore } from '@bear-forge/runtime-controlled';
import { performance } from 'node:perf_hooks';
import {getHeapStatistics} from 'node:v8';
import type { GameTypes } from '@bear-forge/contracts/authoring';
import { createNativeLoader, nativeProgram, isNativeBudgetError } from '@bear-forge/runtime-native';
import { createGameBinder } from '@bear-forge/game-host';
import {registerCurrentSource} from '../../game-host/src/current.ts';
import { PolicyRouter } from '@bear-forge/policies';
import { ExperimentFiles } from './files.ts';
import { sameData } from '@bear-forge/boundary';
import type { Registration, TaskInput, TaskResult, ExecutionHooks, ExperimentDefinition, ExecutionProvider, PolicyResources } from './experiment.types.ts';
const experimentBudgetErrors = new WeakSet<object>();
const protocolFailureCodes = new WeakMap<object, string>();
class ExperimentBudgetError extends Error {
  constructor(message: string) { super(message); experimentBudgetErrors.add(this); }
}
class ProtocolFailure extends Error {
  readonly code: string;
  constructor(error: {code: string}) { super(JSON.stringify(error)); this.code = error.code; protocolFailureCodes.set(this, error.code); }
}
function executableDigest(engine: 'native' | 'controlled', executable: unknown): string {
  const hash = createHash('sha256'), active = new WeakSet<object>();
  const field = (value: string) => { hash.update(String(Buffer.byteLength(value)) + ':'); hash.update(value); };
  const add = (value: unknown): void => {
    if (value === null) { hash.update('null;'); return; }
    if (typeof value === 'string') { hash.update('string;'); field(value); return; }
    if (typeof value === 'boolean') { hash.update(value ? 'true;' : 'false;'); return; }
    if (typeof value === 'number' && Number.isFinite(value)) {
      hash.update('number;'); field(Object.is(value, -0) ? '-0' : String(value)); return;
    }
    if (typeof value !== 'object' || active.has(value)) throw Error('Invalid executable artifact data');
    active.add(value);
    try {
      if (Array.isArray(value)) {
        hash.update('array;'); field(String(value.length));
        for (let index = 0; index < value.length; index++) {
          if (!Object.hasOwn(value, index)) throw Error('Invalid executable artifact data');
          add(value[index]);
        }
      } else {
        const keys = Reflect.ownKeys(value);
        if (keys.some(key => typeof key !== 'string') || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error('Invalid executable artifact data');
        hash.update('object;'); field(String(keys.length));
        for (const key of (keys as string[]).sort()) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
          if (!descriptor.enumerable || !('value' in descriptor)) throw Error('Invalid executable artifact data');
          field(key); add(descriptor.value);
        }
      }
    } finally { active.delete(value); }
  };
  add({ engine, executable: executable ?? null });
  return hash.digest('hex');
}
async function verifyExecutableSources(engine: 'native' | 'controlled', executable: unknown): Promise<void> {
  if (executable == null) return;
  let sources: unknown;
  try {
    sources = engine === 'controlled'
      ? JSON.parse(Buffer.from((executable as { content: string }).content, 'base64').toString('utf8')).metadata?.sourceFiles
      : (executable as { sourceFiles?: unknown }).sourceFiles;
  } catch { throw Error('Executable source manifest missing; rebuild'); }
  if (!Array.isArray(sources)) throw Error('Executable source manifest missing; rebuild');
  for (const entry of sources) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !isAbsolute(entry[0])
      || typeof entry[1] !== 'string' || !/^[a-f0-9]{64}$/.test(entry[1])) {
      throw Error('Invalid executable source manifest');
    }
    let content: Buffer;
    try { content = await readFile(entry[0]); }
    catch { throw Error('Executable source changed; rebuild'); }
    if (createHash('sha256').update(content).digest('hex') !== entry[1]) throw Error('Executable source changed; rebuild');
  }
}
function budgetFailure(error: unknown): boolean {
  return experimentBudgetErrors.has(error as object) || isNativeBudgetError(error)
    || protocolFailureCodes.get(error as object) === 'budget_exceeded';
}
export function createExperimentRunner<G extends GameTypes, T extends TaskInput, C extends Registration, S extends { id: string }>(definition: ExperimentDefinition<G, T, C, S>) {
  type Row = TaskResult<T>;
  type Files = ExperimentFiles<Row, S>;
  const nativePrograms = new Map<string, ReturnType<typeof nativeProgram<G['setup'], G['ports'], G['programResult']>>>();
  function approvedNative(artifact: any, stepBudget = 100000000) {
    const key = createHash('sha256').update(artifact.code).update(artifact.exportName).update(String(stepBudget)).digest('hex');
    let program = nativePrograms.get(key);
    if (!program) {
      program = nativeProgram<G['setup'], G['ports'], G['programResult']>(artifact, {
        stepBudget
      });
      if (nativePrograms.size >= 4) nativePrograms.delete(nativePrograms.keys().next().value!);
      nativePrograms.set(key, program);
    }
    return program;
  }
  const unwrap = (x: any) => {
    if (!x.ok) throw new ProtocolFailure(x.error);
    return x.value;
  };
  type FrozenExecutable = {
    engine: 'native' | 'controlled';
    value: unknown;
    // Own the provider for this experiment, including between asynchronous
    // task commits. A global WeakRef alone cannot keep Program code alive.
    controlled?: ReturnType<ReturnType<typeof createControlledLoader>['load']>;
    provided?: ReturnType<ExecutionProvider<G>['load']>;
  };
  async function runTaskImplementation(task: T, config: C, attempt = 1, files?: Files, hooks: ExecutionHooks = {}, prepared?: FrozenExecutable, priorCost?: Row['cost']): Promise<Row> {
    const started = performance.now(),
      cpuStarted = process.cpuUsage();
    const priorMilliseconds = priorCost?.milliseconds ?? 0;
    let snapshotMilliseconds = 0,
      snapshotBytes = 0;
    const controlled = config.engine === 'controlled';
    if (prepared && prepared.engine !== (controlled ? 'controlled' : 'native')) throw Error('Prepared executable engine mismatch');
    if (controlled && !files) throw Error('Controlled task requires its registered output directory');
    const saved: any = files ? await files.read('checkpoint-' + task.id) : null;
    let loaded: any;
    if ('execution' in definition) {
      const executable = definition.execution.identity;
      if (files && !prepared) {
        const old = await files.read(controlled ? 'artifact' : 'native-artifact');
        if (old && !sameData(old, executable)) throw Error('Registered executable belongs to another provider');
        const frozen: any = await files.read('implementation');
        if (frozen && frozen.executableDigest !== executableDigest(controlled ? 'controlled' : 'native', executable)) throw Error('Frozen executable identity changed');
        if (frozen && !sameData(frozen.implementation, await definition.identity())) throw Error('Registered production code or dependency version changed');
      }
      const load = () => definition.execution.load({ controlled, stepBudget: config.computeStepBudget ?? 100000000,
        ...(files ? { snapshotDirectory: files.directory + '/snapshots' } : {}) });
      loaded = unwrap(await (prepared ? prepared.provided ??= load() : load()));
    } else if (controlled) {
      const artifact: any = prepared?.engine === 'controlled' ? prepared.value : await files!.read('artifact');
      if (!artifact) throw Error('Missing frozen compiled artifact');
      if (!prepared) {
        const frozen: any = await files!.read('implementation');
        if (frozen && frozen.executableDigest !== executableDigest('controlled', artifact)) throw Error('Frozen executable artifact changed');
      }
      const load = () => createControlledLoader({
        trustedDigests: new Set([artifact.digest]),
        snapshots: fileSnapshotStore(files!.directory + '/snapshots'),
        stepBudget: config.computeStepBudget ?? 100000000
      }).load({
        content: new Uint8Array(Buffer.from(artifact.content, 'base64'))
      } as never);
      loaded = unwrap(await (prepared ? prepared.controlled ??= load() : load()));
    } else {
      const artifact: any = prepared?.engine === 'native' ? prepared.value : files ? await files.read('native-artifact') : null;
      if (!prepared) {
        const frozen: any = files ? await files.read('implementation') : null;
        if (frozen && frozen.executableDigest !== executableDigest('native', artifact)) throw Error('Frozen executable artifact changed');
      }
      loaded = unwrap(await createNativeLoader().load(artifact ? await approvedNative(artifact, config.computeStepBudget) : definition.module.program));
    }
    const instance = controlled && saved ? unwrap(await loaded.persistence.restore(saved.snapshot)) : unwrap(await loaded.core.start(definition.setup(task)));
    const game = unwrap(await createGameBinder().bind({
      instance,
      contract: 'execution' in definition ? definition.contract : definition.module.contract,
      ...(controlled ? {
        persistence: loaded.persistence
      } : {})
    }));
    const policyResources: PolicyResources = controlled ? saved?.policyResources ?? {} : {};
    // Work since the durable checkpoint may include discarded proposals. Charge
    // its known duration (or conservative reservation) to each actor's safety
    // account; it must not become free search after recovery.
    const uncheckpointedMilliseconds = Math.max(0, priorMilliseconds - (saved?.elapsedMilliseconds ?? 0));
    for (const resource of Object.values(policyResources)) {
      resource.milliseconds += uncheckpointedMilliseconds;
      resource.reservedMilliseconds = (resource.reservedMilliseconds ?? 0) + uncheckpointedMilliseconds;
    }
    const requiresCurrent = definition.requiresCurrent?.(task) ?? false;
    const forkCurrent = async () => {
      if (!game.fork) throw Error('Current execution has no fork capability');
      return unwrap(await game.fork());
    };
    registerCurrentSource(forkCurrent,game);
    const policies = definition.policies(task,policyResources,forkCurrent),
      router = new PolicyRouter(policies, task.seed, controlled ? saved?.policy : undefined);
    const packets: any[] = controlled ? saved?.packets ?? [] : [],
      decisions: any[] = controlled ? saved?.decisions ?? [] : [];
    const policyBindings = new Map(Object.keys(policies).map(player => [player, router.binding(player)]));
    const preparedReplies = new Map<string, {reply?: any; error?: unknown}>();
    let needsPreparation = false;
    for (const [player, binding] of policyBindings) unwrap(await game.bind(requiresCurrent ? {
      ...binding,
      onRequest: async (request: any) => {
        const prepared = preparedReplies.get(JSON.stringify(request.id));
        if (!prepared) {needsPreparation = true; return {kind:'pause'};}
        if ('error' in prepared) throw prepared.error;
        return prepared.reply;
      }
    } : binding));
    const advance = async () => {
      if (!requiresCurrent) return unwrap(await game.run(hooks.signal ? {signal: hooks.signal} : undefined));
      // Policy evaluation needs a stable current Context. Prepare its reply
      // before entering the driver, then let BaseGame validate and accept it.
      // An initial event-only advance can reach the first request and pause;
      // no player action has executed at that point, and nothing is replayed.
      for (;;) {
        const state = unwrap(await game.inspect());
        const cancellation = new AbortController(), abort = () => cancellation.abort();
        hooks.signal?.addEventListener('abort',abort,{once:true});
        if (hooks.signal?.aborted) abort();
        try {
          if (state.kind === 'request') await Promise.all(state.requests.map(async (request: any) => {
            const binding = policyBindings.get(request.player);
            if (!binding) return;
            const key = JSON.stringify(request.id);
            try {preparedReplies.set(key,{reply:await binding.onRequest(request,{signal:cancellation.signal})});}
            catch (error) {preparedReplies.set(key,{error});}
          }));
          needsPreparation = false;
          const next = unwrap(await game.run(hooks.signal ? {signal:hooks.signal} : undefined));
          if (!needsPreparation || next.accepted || next.pause !== 'requested' || hooks.signal?.aborted) return next;
        } finally {
          cancellation.abort(); hooks.signal?.removeEventListener('abort',abort); preparedReplies.clear();
        }
      }
    };
    const commits: any[] = controlled ? saved?.commits ?? [] : [];
    let previousSnapshot = controlled ? saved?.snapshot : undefined;
    let steps = controlled ? saved?.step ?? 0 : 0,
      status: TaskResult['status'] = 'truncated',
      result: any = null,
      error: string | undefined;
    let advances = steps;
    try {
      for (; steps < config.maxSteps; steps++) {
        if (hooks.signal?.aborted) throw new ExperimentBudgetError('Experiment cancelled');
        if (config.taskMilliseconds !== undefined && priorMilliseconds + performance.now() - started >= config.taskMilliseconds ||
            hooks.deadline !== undefined && performance.now() >= hooks.deadline) throw new ExperimentBudgetError('Experiment wall budget exceeded');
        if (process.memoryUsage().rss > (config.memoryBudgetMB ?? 4096) * 1024 * 1024) throw new ExperimentBudgetError('Experiment memory budget exceeded');
        router.begin();
        await hooks.point?.('before-advance', task.id);
        advances++;
        const next = await advance();
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
          const checkpointStart=performance.now(),charge=await definition.checkpointCost?.(task,policyResources,forkCurrent);
          try{
            const snapshotStart=performance.now(),snapshot=unwrap(await game.save());
            snapshotMilliseconds+=performance.now()-snapshotStart;
            snapshotBytes+=(await stat(files!.directory+'/snapshots/'+snapshot.snapshotId+'.snapshot')).size;
            await hooks.point?.('after-snapshot',task.id);
            // This prefix is durable with the checkpoint. A failed/unfinished
            // tail is covered by the existing attempt recovery reservation.
            charge?.(performance.now()-checkpointStart);
            await files!.write('checkpoint-'+task.id,{
              snapshot,policy:router.snapshot(),policyResources,
              elapsedMilliseconds:priorMilliseconds+performance.now()-started,
              packets,decisions,commits,step:steps+1,
            });
            if(previousSnapshot)unwrap(await loaded.persistence.release(previousSnapshot));
            previousSnapshot=snapshot;
          }finally{charge?.(performance.now()-checkpointStart);}
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
          if (hooks.signal?.aborted) throw new ExperimentBudgetError('Experiment cancelled');
          status = 'fault';
          error = 'Unexpected policy pause: ' + next.pause;
          break;
        }
      }
    } catch (e) {
      error = exceptionMessage(e);
      status = budgetFailure(e) ? 'truncated' : 'fault';
    } finally {
      await game.close();
    }
    if (status === 'truncated' && !error) error = 'Experiment step budget exceeded';
    let after: number | null = null;
    const facts: any[] = [];
    if (loaded.capture) do {
      const page = unwrap(await loaded.capture.read(instance.id, {
        after,
        limit: 1000
      }));
      for (const record of page.records) {
        facts.push(...definition.facts(record));
      }
      after = page.next;
    } while (after !== null);
    if (loaded.capture) unwrap(await loaded.capture.release(instance.id));
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
      policyResources,
      cost: {
        milliseconds: priorMilliseconds + performance.now() - started,
        ...(priorCost?.reservedMilliseconds ? {reservedMilliseconds: priorCost.reservedMilliseconds} : {}),
        steps: advances,
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
  async function runPreparedTask(task: T, config: C, attempt = 1, files?: Files, hooks: ExecutionHooks = {}, prepared?: FrozenExecutable, priorCost?: Row['cost']): Promise<Row> {
    const started = performance.now();
    try {
      if (process.memoryUsage().rss > (config.memoryBudgetMB ?? 4096) * 1024 * 1024) throw new ExperimentBudgetError('Experiment memory budget exceeded');
      return await runTaskImplementation(task, config, attempt, files, hooks, prepared, priorCost);
    } catch (error) {
      const message = exceptionMessage(error);
      return {
        id: task.id,
        input: task,
        attempt,
        status: budgetFailure(error) ? 'truncated' : 'fault',
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
          milliseconds: (priorCost?.milliseconds ?? 0) + performance.now() - started,
          ...(priorCost?.reservedMilliseconds ? {reservedMilliseconds: priorCost.reservedMilliseconds} : {}),
          steps: 0,
          processPeakRssBytes: process.resourceUsage().maxRSS * 1024
        },
        error: message
      };
    }
  }
  function runTask(task: T, config: C, attempt = 1, files?: Files, hooks: ExecutionHooks = {}): Promise<Row> {
    return runPreparedTask(task, config, attempt, files, hooks);
  }
  async function executeExperiment(directory: string, input?: C, onProgress?: (done: number, total: number) => void, hooks: ExecutionHooks = {}) {
    const batchStarted = performance.now(), batchStartedAt = Date.now();
    const files = new ExperimentFiles<Row, S>(directory, definition.summarize);
    let registration: any = await files.read('registration');
    if (input) {
      const config = definition.parseRegistration(input),
        tasks = definition.tasks(config);
      await files.register(config, tasks);
      registration = {
        config,
        tasks
      };
    }
    if (!registration) throw Error('No registered experiment');
    registration.config = definition.parseRegistration(registration.config);
    let registeredWallDeadline = Infinity;
    if (registration.config.batchMilliseconds !== undefined) {
      // This is one wall-clock batch, including cold setup and downtime between
      // resumptions. A restart cannot open a fresh full-duration batch window.
      const previous = await files.read<{startedAt:number;milliseconds:number}>('wall-budget');
      const window = previous ?? {startedAt:batchStartedAt,milliseconds:registration.config.batchMilliseconds};
      if (!Number.isSafeInteger(window.startedAt) || window.startedAt > batchStartedAt ||
          window.milliseconds !== registration.config.batchMilliseconds) throw Error('Invalid experiment wall budget or clock moved backwards');
      if (!previous) await files.write('wall-budget',window);
      registeredWallDeadline = window.startedAt + window.milliseconds;
    }
    const identity = await definition.identity(),
      runtime = {
        platform: process.platform,
        arch: process.arch,
        heapSizeLimit: getHeapStatistics().heap_size_limit,
        versions: Object.fromEntries(Object.entries(process.versions).sort(([a], [b]) => a.localeCompare(b)))
      },
      frozen: any = await files.read('implementation');
    if (frozen) {
      if (!sameData(frozen.runtime, runtime)) throw Error('Experiment runtime version changed');
      if (!sameData(frozen.implementation, identity)) throw Error('Registered production code or dependency version changed');
    }
    let executable: unknown;
    if ('execution' in definition) {
      executable = definition.execution.identity;
      const key = registration.config.engine === 'controlled' ? 'artifact' : 'native-artifact';
      const old = await files.read(key);
      if (old && !sameData(old, executable)) throw Error('Registered executable belongs to another provider');
      if (!old) await files.write(key, executable);
    } else if (registration.config.engine === 'controlled') {
      const old: any = await files.read('artifact');
      if (old) executable = old;
      else {
        const content = new Uint8Array(await readFile(definition.artifacts.controlled));
        executable = {
          content: Buffer.from(content).toString('base64'),
          digest: programDigest(content)
        };
        await files.write('artifact', executable);
      }
    } else {
      const old: any = await files.read('native-artifact');
      if (old) executable = old;
      else {
        try {
          executable = JSON.parse(await readFile(definition.artifacts.native, 'utf8'));
          await files.write('native-artifact', executable);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    const digest = executableDigest(registration.config.engine ?? 'native', executable);
    if (frozen) {
      if (frozen.executableDigest !== digest) throw Error('Frozen executable artifact changed');
    }
    if (!('execution' in definition) && registration.config.engine === 'controlled') {
      const artifact = executable as { content?: unknown; digest?: unknown };
      if (typeof artifact.content !== 'string' || typeof artifact.digest !== 'string'
        || programDigest(new Uint8Array(Buffer.from(artifact.content, 'base64'))) !== artifact.digest) {
        throw Error('Invalid frozen executable artifact');
      }
    }
    if (!('execution' in definition)) await verifyExecutableSources(registration.config.engine ?? 'native', executable);
    if (!frozen) await files.write('implementation', { implementation: identity, runtime, executableDigest: digest });
    const existing = new Set((await files.summaries()).map(r => r.id));
    let batchSpent = 0, stopBatch = false;
    if (registration.config.batchMilliseconds !== undefined || registration.config.stopOnFault) {
      for (const task of registration.tasks as T[]) {
        const row = await files.read<Row>('task-' + task.id);
        if (row) {
          batchSpent += row.attempts?.reduce((sum, attempt) => sum + (attempt.cost?.milliseconds ?? registration.config.taskMilliseconds ?? registration.config.batchMilliseconds ?? 0), 0) ?? row.cost.milliseconds;
          if (registration.config.stopOnFault && row.status === 'fault') stopBatch = true;
        }
        else {
          const attempt = await files.read<{started: number; status?: string; finished?: number; cost?: {milliseconds: number}}>('attempt-' + task.id);
          // An interrupted attempt has unknown consumed work. Reserve its full
          // task allowance; restart cannot turn an interrupted batch into free work.
          if (attempt) batchSpent += attempt.cost?.milliseconds ?? registration.config.taskMilliseconds ?? registration.config.batchMilliseconds ?? 0;
          if (registration.config.stopOnFault && attempt?.status === 'fault') stopBatch = true;
        }
      }
    }
    const batchRemaining = registration.config.batchMilliseconds === undefined ? Infinity : Math.max(0, registration.config.batchMilliseconds - batchSpent);
    const batchDeadline = Math.min(hooks.deadline ?? Infinity, batchStarted + batchRemaining,
      performance.now() + Math.max(0,registeredWallDeadline-Date.now()));
    const executionHooks = {...hooks, ...(Number.isFinite(batchDeadline) ? {deadline: batchDeadline} : {})};
    let stopReason: string | null = stopBatch ? 'prior-fault' : null;
    if (registration.config.engine === 'controlled') {
      for (const id of existing) await files.remove('checkpoint-' + id);
      await files.collectSnapshots();
    }
    let done = existing.size;
    const prepared: FrozenExecutable = { engine: registration.config.engine ?? 'native', value: executable };
    async function executeTask(task: T) {
      let result: Row | undefined;
      const prior: any = await files.read('attempt-' + task.id);
      const checkpoint = registration.config.engine === 'controlled' && prior && prior.status !== 'fault'
        ? await files.read<{step:number;elapsedMilliseconds?:number}>('checkpoint-' + task.id) : null;
      // Resuming a durable boundary continues the same logical attempt. A
      // completed task file still wins above; no committed task is replayed.
      const firstAttempt = checkpoint ? prior.attempt : (prior?.attempt ?? 0) + 1;
      for (let attempt = firstAttempt; attempt <= registration.config.maxAttempts; attempt++) {
        const resuming = checkpoint && attempt === prior.attempt;
        const priorCost: Row['cost'] | undefined = resuming ? prior.cost ?? {
          milliseconds: registration.config.taskMilliseconds ?? checkpoint.elapsedMilliseconds ?? 0,
          reservedMilliseconds: registration.config.taskMilliseconds ?? 0,
          steps: checkpoint.step,
        } : undefined;
        const attemptKey = 'attempt-history-' + task.id + '-' + attempt;
        const start = {
          attempt,
          started: resuming ? prior.started : Date.now(),
          status: 'started'
        };
        await files.write(attemptKey, start);
        await files.write('attempt-' + task.id, start);
        result = await runPreparedTask(task, registration.config, attempt, files, executionHooks,
          prepared, priorCost);
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
      if (registration.config.stopOnFault && result.status === 'fault') {stopBatch = true; stopReason = 'fault';}
      await hooks.point?.('after-commit', task.id);
      if (registration.config.engine === 'controlled') {
        await files.remove('checkpoint-' + task.id);
      }
      onProgress?.(++done, registration.tasks.length);
    }
    const pending = (registration.tasks as T[]).filter(task => !existing.has(task.id)),
      concurrency = registration.config.concurrency ?? 1;
    for (let offset = 0; offset < pending.length; offset += concurrency) {
      if (stopBatch) break;
      if (hooks.signal?.aborted) {stopReason = 'cancelled'; break;}
      if (performance.now() >= batchDeadline) {stopReason = 'wall-budget'; break;}
      if (process.memoryUsage().rss > (registration.config.memoryBudgetMB ?? 4096) * 1024 * 1024) {stopReason = 'memory-budget'; break;}
      await Promise.all(pending.slice(offset, offset + concurrency).map(executeTask));
      if (registration.config.engine === 'controlled') await files.collectSnapshots();
    }
    return {
      files,
      registration,
      stopReason,
      results: await files.summaries()
    };
  }
  function runExperiment(directory: string, input?: C, onProgress?: (done: number, total: number) => void, hooks: ExecutionHooks = {}) {
    return withWriter(directory, () => executeExperiment(directory, input, onProgress, hooks));
  }

  return { runTask, runExperiment };
}
