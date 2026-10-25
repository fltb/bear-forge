import { exceptionMessage } from '@bear-forge/runtime';
import { createHash,randomUUID } from 'node:crypto';
import { withWriter } from './lock.ts';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createControlledLoader, programDigest, fileSnapshotStore } from '@bear-forge/runtime-controlled';
import { performance } from 'node:perf_hooks';
import {getHeapStatistics} from 'node:v8';
import {setTimeout as waitForPersistence} from 'node:timers/promises';
import type { GameTypes } from '@bear-forge/contracts/authoring';
import { createNativeLoader, nativeProgram, isNativeBudgetError } from '@bear-forge/runtime-native';
import { createGameBinder } from '@bear-forge/game-host';
import {registerCurrentSource,gameExecutionControl,saveGameDelivery} from '../../game-host/src/current.ts';
import {restoreGameContinuation,restoreGameDelivery} from '../../game-host/src/binder.ts';
import {ExecutionSuspended,continuationControl,restoreContinuation} from '../../runtime/src/continuation.ts';
import { PolicyRouter } from '@bear-forge/policies';
import {savePolicyWork,restorePolicyWork,preparePolicyWork,closePolicyWork,suspendedPolicyWork,policyWork} from '../../policies/src/search/work.ts';
import { ExperimentFiles } from './files.ts';
import { sameData } from '@bear-forge/boundary';
import type { Registration, TaskInput, TaskResult, ExecutionHooks, ExperimentDefinition, ExecutionProvider, PolicyResources } from './experiment.types.ts';
const experimentBudgetErrors = new WeakSet<object>();
const protocolFailureCodes = new WeakMap<object, string>();
/** RSS includes unreachable interpreter indexes awaiting V8 collection. On
 * pressure, give the host collector one chance before suspending live work.
 * This neither raises the registered threshold nor discards retained data. */
function memoryExceeded(megabytes:number):boolean{
  const limit=megabytes*1024*1024;
  if(process.memoryUsage().rss<=limit)return false;
  const collect=globalThis.gc;
  if(typeof collect==='function'){
    try{collect({type:'major',execution:'sync',flavor:'last-resort'});}catch{return true;}
    return process.memoryUsage().rss>limit;
  }
  return true;
}
/** A failed durable write cannot release its live owner and then restart an
 * older checkpoint. Retry only this persistence operation; the caller keeps
 * the actual Context/frontier (or terminal result) until publication succeeds.
 * Cancellation stops new execution, not the obligation to save existing work. */
async function persistRetained<T>(retained:boolean,hooks:ExecutionHooks,taskId:string,stage:string,operation:()=>Promise<T>):Promise<T>{
  let failures=0;
  for(;;){
    try{return await operation();}
    catch(error){
      if(!retained)throw error;
      failures++;
      try{await hooks.persistenceWait?.({taskId,stage,failures,error:exceptionMessage(error)});}catch{/* diagnostics cannot discard the live owner */}
      await waitForPersistence(Math.min(1000,25*2**Math.min(failures-1,6)));
    }
  }
}
class ExperimentBudgetError extends Error {
  constructor(message: string) { super(message); experimentBudgetErrors.add(this); }
}
/** A durable unfinished task, not a game result and not a retry from setup. */
const retainedPauses=new WeakSet<object>();
class RetainedWorkPause extends Error{
  readonly reason:string;
  readonly cost:{milliseconds:number;steps:number};
  readonly checkpointRequired:boolean;
  constructor(reason:string,cost:{milliseconds:number;steps:number},checkpointRequired=true){
    super('Retained search work: '+reason);this.reason=reason;this.cost=cost;this.checkpointRequired=checkpointRequired;
    retainedPauses.add(this);
  }
  static [Symbol.hasInstance](value:unknown):boolean{return retainedPauses.has(value as object);}
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
    const active:any=definition.retainedSearch&&files?await files.read('active-work-'+task.id):null;
    if(definition.retainedSearch&&(active!==null||saved?.workToken!=null)&&
      !(typeof active?.token==='string'&&active.token.length>0&&active.token===saved?.workToken)){
      throw new RetainedWorkPause('uncheckpointed-current-lost',{milliseconds:priorMilliseconds,steps:saved?.step??0});
    }
    let workToken:string|null=saved?.workToken??null,dirty=false;
    const beginWork=async()=>{
      if(!definition.retainedSearch||dirty)return;
      if(!files||!controlled)throw Error('Retained search requires durable controlled execution');
      const token=randomUUID();
      // Publish BEFORE executing a new prefix. A hard exit with a token that
      // differs from the checkpoint is evidence of potentially lost work,
      // never permission to re-execute that prefix from the older checkpoint.
      await persistRetained(true,hooks,task.id,'work-marker',()=>files.write('active-work-'+task.id,{token}));
      workToken=token;dirty=true;
    };
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
    if(!(controlled&&saved))await beginWork();
    const instance = controlled && saved ? saved.gameContinuation?await restoreContinuation(loaded,saved.snapshot):unwrap(await loaded.persistence.restore(saved.snapshot)) : unwrap(await loaded.core.start(definition.setup(task)));
    const gameInput={
      instance,
      contract: 'execution' in definition ? definition.contract : definition.module.contract,
      ...(controlled ? {
        persistence: loaded.persistence
      } : {})
    };
    let game:any;
    try{game=unwrap(await(saved?.gameContinuation?restoreGameContinuation(gameInput,saved.gameContinuation):saved?.gameDelivery?restoreGameDelivery(gameInput,saved.gameDelivery):createGameBinder().bind(gameInput)));}
    catch(error){
      // A binder that already took ownership cleans up its owned handle. The
      // caller's old handle may consequently be revoked; preserve the cause.
      try{const pending=continuationControl(instance);if(pending?.pending())await pending.close();else await instance.close();}catch{}
      throw error;
    }
    const execution=gameExecutionControl(game);
    const closeGame=async()=>{if(execution?.pending())await execution.close();else await game.close();};
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
    let policies:ReturnType<typeof definition.policies>={},router:PolicyRouter;
    const policyBindings=new Map<string,any>();
    const preparedReplies = new Map<string, {reply?: any; error?: unknown}>();
    let needsPreparation = false;
    try{
      policies=definition.policies(task,policyResources,forkCurrent);
      router=new PolicyRouter(policies,task.seed,controlled?saved?.policy:undefined);
      if(saved?.policyWork){
        restorePolicyWork(policies,saved.policyWork);
        // Policies now own their restored data (or their retained reference).
        // The runner must not pin a second complete frontier for this entire
        // invocation. The durable checkpoint on disk remains unchanged.
        saved.policyWork=undefined;
      }
      if(saved?.routerPending)router.restorePending(saved.routerPending);
      for(const player of Object.keys(policies))policyBindings.set(player,router.binding(player));
      for (const [player, binding] of policyBindings) {
        const callbacks=requiresCurrent ? {
        ...binding,
        onRequest: async (request: any) => {
          const prepared = preparedReplies.get(JSON.stringify(request.id));
          if (!prepared) {needsPreparation = true; return {kind:'pause'};}
          if ('error' in prepared) throw prepared.error;
          return prepared.reply;
        }
        } : binding;
        unwrap(await(execution?.pending()?execution.bind(callbacks):game.bind(callbacks)));
      }
    }catch(error){
      try{closePolicyWork(policies);}finally{await closeGame();}
      throw error;
    }
    const retainsWork=Object.values(policies).some(policy=>policyWork(policy)!==undefined);
    if(retainsWork&&execution)execution.schedule(()=>hooks.signal?.aborted?'cancelled':
      config.taskMilliseconds!==undefined&&performance.now()-started>=config.taskMilliseconds||hooks.deadline!==undefined&&performance.now()>=hooks.deadline?'wall-budget':
      memoryExceeded(config.memoryBudgetMB??4096)?'memory-budget':null);
    const persist=<V>(stage:string,operation:()=>Promise<V>)=>persistRetained(retainsWork,hooks,task.id,stage,operation);
    const packets: any[] = controlled ? saved?.packets ?? [] : [],
      decisions: any[] = controlled ? saved?.decisions ?? [] : [];
    const advance = async () => {
      if (!requiresCurrent) return unwrap(await(execution?.pending()?execution.resume(hooks.signal?{signal:hooks.signal}:undefined):game.run(hooks.signal ? {signal: hooks.signal} : undefined)));
      // Policy evaluation needs a stable current Context. Prepare its reply
      // before entering the driver, then let BaseGame validate and accept it.
      // An initial event-only advance can reach the first request and pause;
      // no player action has executed at that point, and nothing is replayed.
      for (;;) {
        // A suspended game must first finish its original continuation. At a
        // stable boundary, restore retained search before publishing a dirty
        // token: a crash while decoding cannot have consumed a search edge.
        if(!execution?.pending()){
          try{await preparePolicyWork(policies);}
          catch(error){
            if(!retainsWork)throw error;
            // A prior game continuation may already have progressed in this
            // interval. Preserve it before reporting a preparation failure.
            if(dirty)await checkpointWork();
            throw new RetainedWorkPause('search-restore-failed: '+exceptionMessage(error),{milliseconds:priorMilliseconds+performance.now()-started,steps});
          }
        }
        await beginWork();
        if(execution?.pending()){
          needsPreparation=false;
          const next=unwrap(await execution.resume(hooks.signal?{signal:hooks.signal}:undefined));
          if(!needsPreparation||next.accepted||next.pause!=='requested'||hooks.signal?.aborted)return next;
          continue;
        }
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
          const suspension=suspendedPolicyWork(policies);
          if(suspension.length){
            const reason=hooks.signal?.aborted?'cancelled':suspension.find(reason=>reason!=='scheduling-yield')??
              (config.taskMilliseconds!==undefined&&performance.now()-started>=config.taskMilliseconds||hooks.deadline!==undefined&&performance.now()>=hooks.deadline?'wall-budget':
              memoryExceeded(config.memoryBudgetMB??4096)?'memory-budget':null);
            if(reason){await checkpointWork();throw new RetainedWorkPause(hooks.signal?.aborted?'cancelled':reason,{milliseconds:priorMilliseconds+performance.now()-started,steps});}
            // A scheduling yield resumes this SAME live search session. No
            // game action or logical game step has been accepted.
            await new Promise<void>(resolve=>setImmediate(resolve));continue;
          }
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
    let continuingTransaction=Boolean(saved?.routerPending);
    const stepLimit=retainsWork?steps+config.maxSteps:config.maxSteps;
    const retainSnapshot=async(snapshot:any,completedSteps:number)=>{
      const obsolete=previousSnapshot;previousSnapshot=snapshot;
      if(!obsolete)return;
      try{unwrap(await loaded.persistence.release(obsolete));}
      catch(error){
        // The replacement checkpoint already owns the new snapshot. Failed
        // cleanup cannot invalidate it or turn unfinished search into a result.
        if(retainsWork)throw new RetainedWorkPause('snapshot-cleanup-failed: '+exceptionMessage(error),{
          milliseconds:priorMilliseconds+performance.now()-started,steps:completedSteps,
        });
        throw error;
      }
    };
    const checkpointWork=async()=>{
      if(!controlled||!files)throw Error('Retained search requires durable controlled execution');
      const current=execution?.pending()?await persist('game-continuation',()=>execution.save()):
        {snapshot:await persist('game-snapshot',async()=>unwrap(await game.save())),game:undefined};
      const snapshot=current.snapshot;
      const gameDelivery=current.game?null:saveGameDelivery(game);
      const transaction=await persist('router-snapshot',async()=>({pending:router.savePending(),state:router.snapshot()}));
      const policyState=await persist('search-snapshot',async()=>savePolicyWork(policies));
      await persist('checkpoint',()=>files.write('checkpoint-'+task.id,{snapshot,policy:transaction.state,routerPending:transaction.pending,policyWork:policyState,policyResources,
        ...(current.game?{gameContinuation:current.game}:{}),
        ...(gameDelivery?{gameDelivery}:{}),
        ...(definition.retainedSearch?{workToken}:{}),elapsedMilliseconds:priorMilliseconds+performance.now()-started,packets,decisions,commits,step:steps}));
      dirty=false;
      await retainSnapshot(snapshot,steps);
    };
    try {
      for (; steps < stepLimit;) {
        if (hooks.signal?.aborted) throw new ExperimentBudgetError('Experiment cancelled');
        if (config.taskMilliseconds !== undefined && (retainsWork?0:priorMilliseconds) + performance.now() - started >= config.taskMilliseconds ||
            hooks.deadline !== undefined && performance.now() >= hooks.deadline) throw new ExperimentBudgetError('Experiment wall budget exceeded');
        if (memoryExceeded(config.memoryBudgetMB ?? 4096)) throw new ExperimentBudgetError('Experiment memory budget exceeded');
        if(continuingTransaction)continuingTransaction=false;else router.begin();
        await hooks.point?.('before-advance', task.id);
        if(!requiresCurrent)await beginWork();
        advances++;
        const next = await advance();
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
        // The accepted edge and its host records now belong to this prefix.
        // Cancellation or a failed save must retain the NEXT logical step.
        steps++;
        await hooks.point?.('after-advance', task.id);
        if (controlled && (config.checkpointEvery ?? 0) > 0 && steps % config.checkpointEvery! === 0 && next.state.kind !== 'fault' && next.state.kind !== 'ended') {
          const checkpointStart=performance.now(),charge=await definition.checkpointCost?.(task,policyResources,forkCurrent);
          try{
            const snapshotStart=performance.now(),snapshot=await persist('game-snapshot',async()=>unwrap(await game.save()));
            const gameDelivery=saveGameDelivery(game);
            snapshotMilliseconds+=performance.now()-snapshotStart;
            snapshotBytes+=(await persist('snapshot-metadata',()=>stat(files!.directory+'/snapshots/'+snapshot.snapshotId+'.snapshot'))).size;
            await hooks.point?.('after-snapshot',task.id);
            // This prefix is durable with the checkpoint. A failed/unfinished
            // tail is covered by the existing attempt recovery reservation.
            charge?.(performance.now()-checkpointStart);
            const policyState=await persist('search-snapshot',async()=>savePolicyWork(policies));
            await persist('checkpoint',()=>files!.write('checkpoint-'+task.id,{
              snapshot,policy:router.snapshot(),policyResources,policyWork:policyState,
              ...(gameDelivery?{gameDelivery}:{}),
              ...(definition.retainedSearch?{workToken}:{}),
              elapsedMilliseconds:priorMilliseconds+performance.now()-started,
              packets,decisions,commits,step:steps,
            }));
            dirty=false;
            await retainSnapshot(snapshot,steps);
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
      if(retainsWork&&status==='truncated'&&!error){await checkpointWork();throw new RetainedWorkPause('scheduling-step-yield',{milliseconds:priorMilliseconds+performance.now()-started,steps});}
    } catch (e) {
      if(e instanceof RetainedWorkPause)throw e;
      if(retainsWork&&e instanceof ExecutionSuspended){
        await checkpointWork();throw new RetainedWorkPause(e.reason,{milliseconds:priorMilliseconds+performance.now()-started,steps});
      }
      if(retainsWork&&budgetFailure(e)){
        await checkpointWork();throw new RetainedWorkPause(exceptionMessage(e),{milliseconds:priorMilliseconds+performance.now()-started,steps});
      }
      error = exceptionMessage(e);
      status = budgetFailure(e) ? 'truncated' : 'fault';
    } finally {
      try{closePolicyWork(policies);}finally{await closeGame();}
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
      if(definition.retainedSearch&&hooks.signal?.aborted)throw new RetainedWorkPause('pre-execution-cancelled',{
        milliseconds:priorCost?.milliseconds??0,steps:priorCost?.steps??0,
      },false);
      if (memoryExceeded(config.memoryBudgetMB ?? 4096)) {
        // No Context has been started or restored here. Keep the attempt
        // unstarted, so a later invocation may start it exactly once.
        if(definition.retainedSearch)throw new RetainedWorkPause('pre-execution-memory-budget',{
          milliseconds:(priorCost?.milliseconds??0)+performance.now()-started,steps:priorCost?.steps??0,
        },false);
        throw new ExperimentBudgetError('Experiment memory budget exceeded');
      }
      return await runTaskImplementation(task, config, attempt, files, hooks, prepared, priorCost);
    } catch (error) {
      if(error instanceof RetainedWorkPause)throw error;
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
    // The task commit is immutable evidence of execution. Publication cost is
    // settled in the existing attempt records and derived summary, so a failed
    // summary write cannot force mutation or re-execution of that evidence.
    const publicationView=(row:Row,record:any):Row=>{
      const publication=record.publication;
      if(!publication||record.attempt!==row.attempt||!Number.isSafeInteger(publication.startedAt)||publication.startedAt>Date.now()||!Number.isFinite(publication.milliseconds)||publication.milliseconds<0||typeof publication.complete!=='boolean')throw Error('Invalid terminal publication accounting');
      return{...row,cost:{...row.cost,milliseconds:row.cost.milliseconds+publication.milliseconds,publicationMilliseconds:publication.milliseconds},
        attempts:(row.attempts??[]).map(attempt=>attempt.attempt===record.attempt?record:attempt)};
    };
    async function publishRetainedResult(row:Row,record:any){
      const prior=record.publication;
      const startedAt=prior?.startedAt??Date.now(),measuredAt=performance.now();
      if(!Number.isSafeInteger(startedAt)||startedAt>Date.now()||prior&&(!Number.isFinite(prior.milliseconds)||prior.milliseconds<0||typeof prior.complete!=='boolean'))throw Error('Invalid terminal publication accounting');
      // A cold repair includes the period during which publication was left
      // incomplete. During this process use a monotonic elapsed clock.
      const carried=Math.max(prior?.milliseconds??0,Date.now()-startedAt);
      const persist=<V>(stage:string,operation:()=>Promise<V>)=>persistRetained(true,hooks,row.id,stage,operation);
      const attemptKey='attempt-history-'+row.id+'-'+row.attempt;
      const pending={...record,publication:{startedAt,milliseconds:carried,complete:false}};
      await persist('publication-state',async()=>{
        await files.write(attemptKey,pending);await files.write('attempt-'+row.id,pending);
      });
      await persist('task-result',()=>files.commit(row.id,row));
      await persist('publication-cost',async()=>{
        // Recompute on each failed bookkeeping attempt. Retrying serialization
        // or summary publication must not lose the intervening wait cost.
        const publication={startedAt,milliseconds:carried+performance.now()-measuredAt,complete:true};
        const completed={...record,publication,cost:{...row.cost,milliseconds:row.cost.milliseconds+publication.milliseconds,publicationMilliseconds:publication.milliseconds}};
        await files.write(attemptKey,completed);await files.write('attempt-'+row.id,completed);
        await files.write('summary-'+row.id,definition.summarize(publicationView(row,completed)));
      });
    }
    if(definition.retainedSearch)for(const row of await files.results<Row>()){
      const record:any=await files.read('attempt-'+row.id);
      if(record?.publication){
        if(record.attempt!==row.attempt)throw Error('Terminal publication attempt changed');
        const summary=await files.read('summary-'+row.id);
        if(!record.publication.complete||!sameData(summary,definition.summarize(publicationView(row,record))))await publishRetainedResult(row,record);
      }
    }
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
    const batchRemaining = registration.config.batchMilliseconds === undefined ? Infinity : Math.max(0, registration.config.batchMilliseconds - (definition.retainedSearch?0:batchSpent));
    const batchDeadline = Math.min(hooks.deadline ?? Infinity, batchStarted + batchRemaining,
      definition.retainedSearch?Infinity:performance.now() + Math.max(0,registeredWallDeadline-Date.now()));
    const executionHooks = {...hooks, ...(Number.isFinite(batchDeadline) ? {deadline: batchDeadline} : {})};
    let stopReason: string | null = stopBatch ? 'prior-fault' : null;
    if (registration.config.engine === 'controlled') {
      for (const id of existing) await files.remove('checkpoint-' + id);
      await files.collectSnapshots();
    }
    let done = existing.size;
    const prepared: FrozenExecutable = { engine: registration.config.engine ?? 'native', value: executable };
    async function executeTask(task: T) {
      const persist=<V>(stage:string,operation:()=>Promise<V>)=>persistRetained(!!definition.retainedSearch,executionHooks,task.id,stage,operation);
      let result: Row | undefined;
      const prior: any = await files.read('attempt-' + task.id);
      const checkpoint = registration.config.engine === 'controlled' && prior && prior.status !== 'fault'
        ? await files.read<{step:number;elapsedMilliseconds?:number;workToken?:string}>('checkpoint-' + task.id).then(value=>value===null?null:{step:value.step,elapsedMilliseconds:value.elapsedMilliseconds,workToken:value.workToken}) : null;
      // The outer attempt scheduler needs only these scalars. Keeping the
      // deserialized checkpoint here pins a second complete search frontier
      // while runPreparedTask restores and owns the actual current below.
      const active:any=definition.retainedSearch?await files.read('active-work-'+task.id):null;
      if(definition.retainedSearch&&(active!==null||checkpoint?.workToken!=null)&&
        !(typeof active?.token==='string'&&active.token.length>0&&active.token===checkpoint?.workToken)){
        const reason='uncheckpointed-current-lost';
        if(prior){
          const paused={...prior,status:'incomplete',reason,checkpointRequired:true};
          await persist('attempt-history',()=>files.write('attempt-history-'+task.id+'-'+prior.attempt,paused));
          await persist('attempt-state',()=>files.write('attempt-'+task.id,paused));
        }
        stopBatch=true;stopReason='search-incomplete:'+reason;return;
      }
      // Resuming a durable boundary continues the same logical attempt. A
      // completed task file still wins above; no committed task is replayed.
      const unstarted=definition.retainedSearch&&(
        prior?.status==='incomplete'&&prior.checkpointRequired===false||
        prior?.status==='started'&&!checkpoint&&active===null
      );
      const firstAttempt = checkpoint||unstarted ? prior.attempt : (prior?.attempt ?? 0) + 1;
      for (let attempt = firstAttempt; attempt <= registration.config.maxAttempts; attempt++) {
        const resuming = (checkpoint||unstarted) && attempt === prior.attempt;
        const priorCost: Row['cost'] | undefined = resuming ? prior.cost ?? {
          milliseconds: registration.config.taskMilliseconds ?? checkpoint?.elapsedMilliseconds ?? 0,
          reservedMilliseconds: registration.config.taskMilliseconds ?? 0,
          steps: checkpoint?.step??0,
        } : undefined;
        const attemptKey = 'attempt-history-' + task.id + '-' + attempt;
        const start = {
          attempt,
          started: resuming ? prior.started : Date.now(),
          status: 'started'
        };
        await persist('attempt-history',()=>files.write(attemptKey, start));
        await persist('attempt-state',()=>files.write('attempt-' + task.id, start));
        try{result = await runPreparedTask(task, registration.config, attempt, files, executionHooks,
          prepared, priorCost);}catch(error){
          if(!(error instanceof RetainedWorkPause))throw error;
          const paused={...start,status:'incomplete',cost:error.cost,reason:error.reason,checkpointRequired:error.checkpointRequired};
          await persist('attempt-history',()=>files.write(attemptKey,paused));await persist('attempt-state',()=>files.write('attempt-'+task.id,paused));
          stopBatch=true;stopReason='search-incomplete:'+error.reason;return;
        }
        const completed = {
          ...start,
          finished: Date.now(),
          cost: result.cost,
          error: result.error ?? null,
          status: result.status,
          ...(definition.retainedSearch?{publication:{startedAt:Date.now(),milliseconds:0,complete:false}}:{}),
        };
        await persist('attempt-history',()=>files.write(attemptKey, completed));
        await persist('attempt-state',()=>files.write('attempt-' + task.id, completed));
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
      const completedResult=result;
      if(definition.retainedSearch){
        const record:any=await files.read('attempt-'+task.id);
        if(!record||record.attempt!==result.attempt)throw Error('Missing terminal attempt for publication');
        await publishRetainedResult(completedResult,record);
      }else await persist('task-result',()=>files.commit(task.id,completedResult));
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
      if (memoryExceeded(registration.config.memoryBudgetMB ?? 4096)) {stopReason = 'memory-budget'; break;}
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
