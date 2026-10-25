import { randomUUID } from 'node:crypto';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import { serialize, deserialize } from 'node:v8';
import { CardProgram, CardMachine, plainCardStorage, ruleReplyGuardFor } from '@bear-forge/card-engine';
import type { CardDefinition, CardRoot, CardTrace, CardStorage } from '@bear-forge/card-engine';
import type { PortShape } from '@bear-forge/contracts/core';
import type { Instance, InstanceStop, Outcome } from '@bear-forge/contracts/instance';
import { CallIdSchema } from '@bear-forge/contracts/instance';
import type { InstanceRecord } from '@bear-forge/contracts/capture';
import type { LoadedCore } from '@bear-forge/contracts/loading';
import { InstanceSnapshotSchema } from '@bear-forge/contracts/persistence';
import { Controller, createCapture, ok, fail, exceptionMessage, assertProgramSchemasShape } from '@bear-forge/runtime';
import type { RawStop } from '@bear-forge/runtime';
import { read, copy, sameData, fields } from '@bear-forge/boundary';
import { admitDetached, isOwned, retainOwned, isOwnedTree, isDenseTree } from '../../boundary/src/values.ts';
import { Records } from '../../runtime/src/records.ts';
import type {ControllerContinuation} from '../../runtime/src/instance.ts';
import {ExecutionSuspended,registerContinuation,registerContinuationLoader} from '../../runtime/src/continuation.ts';
import { bindTraceWriter } from '../../card-engine/src/card-trace.ts';
import { CardTraceRecords } from './trace.ts';
import type { TraceLayout } from './trace.ts';
import { CardGraph, privateCardGraph } from './graph.ts';
import {ruleContextIdentityEpoch} from '../../card-engine/src/card.ts';
import { publishNativeStop } from './publication.ts';
import { memorySnapshotStore } from './store.ts';
import type { SnapshotStore } from './store.ts';
import {ProbabilityCurrent,registerProbabilityCurrent} from './probability.ts';
import {ScheduledAdvance,type ScheduledSnapshot} from './scheduled.ts';

/** recordCore:false disables execution capture as well as instruction traces;
 * controlled Context save/restore/fork remain available without history logs. */
export type CardOptions = { controlled?: boolean; stepBudget?: number;
  /** Renewable scheduling of original execution; mutually exclusive with a
   * cumulative fault budget. Private yields never become public IO/results. */
  instructionsPerSlice?:number;
  snapshots?: SnapshotStore; recordCore?: boolean; trace?: (event: CardTrace) => void };
const nativeStructuredClone = globalThis.structuredClone;
const traceReaders = new WeakMap<object, (id: string) => Outcome<CardTrace[]>>();
/** Companion capture facility; the shared LoadedCore/Instance protocol is unchanged. */
export function readCardTrace(loaded: object, instanceId: string): Outcome<CardTrace[]> {
  return traceReaders.get(loaded)?.(instanceId) ?? fail('records_not_found');
}
export function createCardLoader(options: CardOptions = {}) {
  if (options.stepBudget !== undefined && (!Number.isSafeInteger(options.stepBudget) || options.stepBudget < 1)) throw Error('Invalid card step budget');
  if(options.instructionsPerSlice!==undefined&&(!Number.isSafeInteger(options.instructionsPerSlice)||options.instructionsPerSlice<1))throw Error('Invalid card instruction slice');
  if(options.instructionsPerSlice!==undefined&&options.stepBudget!==undefined)throw Error('Choose renewable scheduling or a cumulative step budget');
  const controlled = options.controlled ?? true;
  const store = controlled ? options.snapshots ?? memorySnapshotStore() : undefined;
  const recordCore = options.recordCore ?? controlled;
  // Explicit recordCore:false disables capture and instruction logs while
  // controlled execution retains Context persistence and direct forks.
  const recording = recordCore;
  return {
    async load<S, Setup, P extends { [K in keyof P]: PortShape }, R>(definition: CardDefinition<S, Setup, P, R>): Promise<Outcome<LoadedCore<Setup, P, R>>> {
      let ruleReplyGuard:ReturnType<typeof ruleReplyGuardFor>=null;
      let program: CardProgram<S, Setup, P, R>;
      try { if (typeof definition.id !== 'string' || !definition.id || typeof definition.initialize !== 'function') throw Error('Invalid card definition'); assertProgramSchemasShape(definition.schemas); program = new CardProgram(definition); ruleReplyGuard=ruleReplyGuardFor(definition); definition = program.definition; }
      catch (error) { return fail('invalid_argument', exceptionMessage(error)); }
      // Controller owns parser input/result isolation. Card schemas are host
      // functions, so an additional provider-side adapter would copy them twice.
      const schemas = definition.schemas;
      const traceLayout:TraceLayout={positions:[],offsets:[]};
      if(recordCore){
        const positions:Omit<CardTrace,'depth'>[]=[],offsets:number[]=[];
        program.blocks.forEach((block,index)=>{offsets.push(positions.length);block.forEach((step,position)=>positions.push({effect:program.names[index]!,block:index,index:position,kind:step.kind}));});
        traceLayout.positions=positions;traceLayout.offsets=offsets;
      }
      const graphStorage = <T>(root: T, immutable?:readonly object[],nullPrototypes?:readonly object[],contextValues?:readonly object[]): CardGraph<T> => definition.project ? new CardGraph(root,immutable,nullPrototypes,contextValues) : privateCardGraph(root,immutable,nullPrototypes,contextValues);
      const nativeStorage = (root: CardRoot<S>) => {
        const clone = globalThis.structuredClone;
        if (definition.project || clone !== nativeStructuredClone) return plainCardStorage(root, clone);
        const storage: CardStorage<CardRoot<S>> = plainCardStorage(root, value => {
          return value === storage.root.stop ? publishNativeStop(value, clone) : clone(value);
        });
        return storage;
      };
      const ownStop = (stop: RawStop): RawStop => {
        if (!definition.project) {
          // No projection can retain this detached graph. Managed private
          // exports already proved admission while constructing their fields;
          // other storage exports still need the complete admission scan.
          try {
            if (stop.kind === 'call' || stop.kind === 'done') {
              const value = stop.kind === 'call' ? stop.call.input : stop.result;
              if (isOwned(stop)) retainOwned(value, isOwnedTree(stop), isDenseTree(stop));
              else admitDetached(value);
            }
          } catch { /* Controller performs normal invalid_output rejection. */ }
        }
        return stop;
      };
      const controllers = recording ? new Map<string, Controller<Setup, P, R>>() : undefined;
      const handles = controlled ? new WeakMap<object, Controller<Setup, P, R>>() : undefined;
      const machines = controlled ? new WeakMap<Controller<Setup, P, R>, CardMachine<S, Setup, P, R>>() : undefined;
      const coreRecords = recordCore ? new WeakMap<Controller<Setup, P, R>, CardTraceRecords>() : undefined;
      // Keep the exact prepared bytes and identity after an uncertain write.
      // A retry at the same public current publishes that snapshot again;
      // it never advances the machine or accumulates a new file per retry.
      const pendingSnapshots=controlled?new WeakMap<Controller<Setup,P,R>,{state:InstanceStop<P,R>;id:string;bytes:Uint8Array}>():undefined;
      const continuations=new WeakMap<Controller<Setup,P,R>,ScheduledAdvance<S,Setup,P,R>>();
      const schedules=new WeakMap<Controller<Setup,P,R>,()=>string|null>();
      const pendingContinuations=new WeakMap<Controller<Setup,P,R>,{id:string;bytes:Uint8Array}>();
      const savingContinuations=new WeakSet<Controller<Setup,P,R>>();
      function remember(handle: Instance<P, R>, controller: Controller<Setup, P, R>): Instance<P, R> {
        if (!handles) return handle;
        const owner=controller.owner;
        const owned=()=>{if(controller.owner!==owner||controller.closed)throw Error('Original continuation owner is unavailable');};
        const idle=()=>{owned();if(controller.computing||controller.driving||savingContinuations.has(controller))throw Error('Original continuation is still running or saving');};
        handles.set(handle, controller);
        registerProbabilityCurrent(handle,()=>{
          owned();
          const machine=machines!.get(controller);
          if(!machine||controller.computing||controller.driving||controller.hasContinuation)throw Error('Card current is unavailable');
          return new ProbabilityCurrent(new CardMachine(program,(machine.storage as CardGraph<CardRoot<S>>).fork()));
        });
        if(options.instructionsPerSlice!==undefined)registerContinuation(handle,{
          pending:()=>{owned();return controller.hasContinuation;},
          callId:()=>{idle();return controller.continuationCallId;},
          matchesStop:state=>{idle();return controller.hasContinuation&&sameData(state,controller.state);},
          schedule:check=>{idle();if(check)schedules.set(controller,check);else schedules.delete(controller);},
          async save(){
            idle();if(!controller.hasContinuation)throw Error('No original continuation to save');
            savingContinuations.add(controller);
            try{
            let pending=pendingContinuations.get(controller);
            if(!pending){
              const work=continuations.get(controller);if(!work)throw Error('Missing original instruction current');
              pending={id:randomUUID(),bytes:serialize({format:1,kind:'original-continuation',rule:definition.id,recordCore,
                kernel:work.save(),host:controller.saveContinuation(),core:coreRecords?.get(controller)?.snapshot()??null})};
              pendingContinuations.set(controller,pending);
            }
            await store!.put(pending.id,pending.bytes);
            return InstanceSnapshotSchema.parse({snapshotId:pending.id});
            }finally{savingContinuations.delete(controller);}
          },
          async resume(){idle();pendingContinuations.delete(controller);return controller.resumeContinuation();},
          transfer(){idle();return remember(controller.transferContinuation(),controller);},
          async close(){idle();await controller.closeContinuation();}
        });
        const transfer = handle.transfer;
        handle.transfer = async () => { const result = await transfer(); if (result.ok) remember(result.value, controller); return result; };
        return handle;
      }
      async function driveWork(work:ScheduledAdvance<S,Setup,P,R>,controller?:Controller<Setup,P,R>):Promise<RawStop>{
        while(!work.ready){
          try{work.step(options.instructionsPerSlice!);}
          catch(error){
            // The commit callback, not exception text, establishes whether
            // this is a failure to publish an already executed instruction.
            if(controller&&work.publicationPending&&work.machine.root.stop.kind!=='fault')throw new ExecutionSuspended('original-publication-failed: '+exceptionMessage(error));
            throw error;
          }
          if(controller&&work.machine.root.stop.kind!=='fault'){
            const reason=schedules.get(controller)?.();
            if(reason)throw new ExecutionSuspended(reason);
          }
          if(!work.ready)await yieldTurn();
        }
        try{return ownStop(work.current());}
        catch(error){
          if(controller&&work.machine.root.stop.kind!=='fault')throw new ExecutionSuspended('original-publication-failed: '+exceptionMessage(error));
          throw error;
        }
      }
      async function drive(machine:CardMachine<S,Setup,P,R>,reply?:unknown):Promise<RawStop>{
        return options.instructionsPerSlice===undefined?ownStop(machine.advance(reply)):driveWork(new ScheduledAdvance(machine,reply));
      }
      async function instantiate(setup: Setup, restored?: { machine: CardMachine<S, Setup, P, R>; state: InstanceStop<P, R>; records: Records<InstanceRecord<Setup, P, R>> | any[]; core?: CardTraceRecords | undefined; shared?: true;
        accepted?:ControllerContinuation<Setup,P,R>['accepted'];scheduledPhase?:ScheduledSnapshot<S>['phase'] }): Promise<Instance<P, R>> {
        // A renewable driver does not consume the legacy cumulative field.
        // Zero makes accidental use of a bounded driver fail immediately.
        const budget = options.instructionsPerSlice!==undefined?0:options.stepBudget ?? (controlled ? 1_000_000 : Infinity);
        let root: CardRoot<S> | undefined, storage = restored?.machine.storage;
        if (!restored) {
          const checked = read<Setup>(schemas.setup, setup);
          try { root = program.initial(checked, budget); storage = controlled ? graphStorage(root) : nativeStorage(root); }
          catch (error) {
            root = { state: undefined as S, frames: [], nextCall: 1, waiting: null, budget, stop: { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: exceptionMessage(error) } } };
            storage = controlled ? graphStorage(root) : nativeStorage(root);
          }
        }
        const core = recordCore ? restored?.core?.fork() ?? new CardTraceRecords(traceLayout) : undefined;
        const observe = recordCore || options.trace ? (event: CardTrace) => {
          core?.push(event,event.depth);
          // Diagnostics are not game inputs: isolate their scalar DTO and
          // never turn an observer failure into an unreplayable game fault.
          try { options.trace?.({ ...event }); } catch { /* authoritative records remain available */ }
        } : undefined;
        if(observe)bindTraceWriter(observe,(position,depth)=>{
          core?.push(position,depth);
          if(options.trace)try{options.trace({...position,depth});}catch{/* diagnostic observers do not affect execution */}
        });
        const machine = new CardMachine(program, storage!, observe);
        // A fork already has an isolated, immutable host stop. Re-exporting the
        // machine here would walk the entire pending view despite COW roots.
        let stop: RawStop | undefined;
        try{stop = restored?.accepted&&restored.accepted.phase!=='advance'?ownStop(machine.current()):restored ? restored.state.kind === 'call' ? { kind: 'call', call: restored.state.call }
          : restored.state.kind === 'done' ? { kind: 'done', result: restored.state.result }
          : { kind: 'fault', error: restored.state.error } : await drive(machine);}
        catch(error){storage!.close?.();throw error;}
        const instanceSchemas=ruleReplyGuard?{...schemas,ports:Object.fromEntries(Object.entries(schemas.ports).map(([port,declaration])=>{
          const schema=declaration as {input:any;output:{parse:(value:unknown)=>unknown}};
          return[port,{...schema,output:{parse(value:unknown){
            const parsed=schema.output.parse(value),wait=machine.root.waiting;
            if(wait){const frame=machine.root.frames[wait.frame]!;ruleReplyGuard(program.names[frame.block]!,frame,port,parsed);}
            return parsed;
          }}}];
        }))}as typeof schemas:schemas;
        const controller = new Controller<Setup, P, R>({
          current: () => stop!,
          advance: async output => {
            if(options.instructionsPerSlice===undefined){stop=await drive(machine,output);return;}
            pendingContinuations.delete(controller);
            const work=new ScheduledAdvance(machine,output);continuations.set(controller,work);
            stop=await driveWork(work,controller);
          },
          ...(options.instructionsPerSlice!==undefined?{resume:async()=>{
            const work=continuations.get(controller);if(!work)throw Error('Missing original instruction current');
            stop=await driveWork(work,controller);
          }}:{}),
          dispose: () => { storage!.close?.();stop=undefined;machines?.delete(controller);pendingSnapshots?.delete(controller);
            continuations.delete(controller);schedules.delete(controller);pendingContinuations.delete(controller); },
          ...(controlled ? { snapshot: () => Buffer.from(serialize(machine.storage.export(machine.root))).toString('base64') } : {})
        }, instanceSchemas, setup, restored ? { state: restored.state, records: restored.records,
          ...(restored.accepted?{accepted:restored.accepted}:{}),...(restored.shared ? { shareState: true as const } : {}) } : undefined, recording);
        if(restored?.accepted)continuations.set(controller,ScheduledAdvance.adopt(machine,restored.scheduledPhase!));
        machines?.set(controller, machine);
        if (core) coreRecords!.set(controller, core);
        if (controlled) controller.forkHandler = async () => {
          try {
            const storage = machine.storage as CardGraph<CardRoot<S>>;
            return ok(await instantiate(setup, { machine: new CardMachine(program, storage.fork()), state: controller.state, records: controller.records ?? [], core, shared: true }));
          } catch (error) { return fail('program_failed', exceptionMessage(error)); }
        };
        controllers?.set(controller.id, controller); return remember(controller.handle(), controller);
      }
      // Exports at separate IO boundaries have independent public identities.
      // Break only the storage's cross-boundary physical leaf sharing here;
      // preserve aliases/cycles within each record and the generic default.
      const loaded: LoadedCore<Setup, P, R> = {
        core: { async start(setup) { try { return ok(await instantiate(setup)); } catch (error) { return fail('invalid_input', exceptionMessage(error)); } } },
      };
      if(controlled&&options.instructionsPerSlice!==undefined)registerContinuationLoader(loaded,async snapshot=>{
        let pending:CardStorage<CardRoot<S>>|undefined;
        try{
          const ref=InstanceSnapshotSchema.parse(snapshot),bytes=await store!.get(ref.snapshotId);
          if(!bytes)throw Error('Original continuation snapshot not found');
          const data=deserialize(bytes),host=data?.host;
          if(!fields(data,['format','kind','rule','recordCore','kernel','host','core'])||data.format!==1||data.kind!=='original-continuation'||
            data.rule!==definition.id||data.recordCore!==recordCore||!fields(host,['state','records','recording','accepted'])||
            host.recording!==recording||!Array.isArray(host.records)||!recordCore&&data.core!==null||!recording&&host.records.length)throw Error('Invalid original continuation snapshot');
          const accepted=host.accepted,state=host.state;
          if(!fields(accepted,['callId','phase'])||!CallIdSchema.safeParse(accepted.callId).success||!['advance','publish','ready'].includes(accepted.phase)||
            !['call','done'].includes(state?.kind))throw Error('Invalid accepted original continuation');
          if(state.kind==='call'){
            if(!fields(state,['kind','callId','call'])||!CallIdSchema.safeParse(state.callId).success||!fields(state.call,['port','input'])||!Object.hasOwn(schemas.ports,state.call.port))throw Error('Invalid original host call');
            read(schemas.ports[state.call.port as keyof P]!.input,state.call.input);
          }else{
            if(!fields(state,['kind','result']))throw Error('Invalid original host result');read(schemas.result,state.result);
          }
          if(accepted.phase!=='ready'&&(state.kind!=='call'||state.callId!==accepted.callId)||
            accepted.phase==='ready'&&state.kind==='call'&&state.callId===accepted.callId)throw Error('Original host phase disagrees with consumed call');
          if(recording){
            for(let index=0;index<host.records.length;index++)if(host.records[index]?.sequence!==index)throw Error('Invalid original host record sequence');
            const returned=host.records.filter((row:InstanceRecord<Setup,P,R>)=>row.kind==='returned'&&row.callId===accepted.callId);
            if(returned.length!==1||accepted.phase!=='ready'&&host.records.at(-1)!==returned[0])throw Error('Missing consumed reply record');
          }
          const work=ScheduledAdvance.restore(program,data.kernel);pending=work.machine.storage;
          if(accepted.phase!=='advance'){
            if(!work.ready||accepted.phase==='ready'&&!sameData(work.current(),state.kind==='call'?{kind:'call',call:state.call}:{kind:'done',result:state.result}))throw Error('Original host publication disagrees with Context');
          }
          const core=recordCore?new CardTraceRecords(traceLayout):undefined;core?.restore(data.core);
          const instance=await instantiate(undefined as Setup,{machine:work.machine,state,records:host.records,core,accepted,scheduledPhase:data.kernel.phase});
          pending=undefined;return instance;
        }finally{pending?.close?.();}
      });
      if (controllers) {
        const capture = createCapture(controllers, records => {
          const detached: typeof records = new Array(records.length);
          for (let i = 0; i < records.length; i++) Object.defineProperty(detached, i, {
            value: copy(records[i]), writable: true, enumerable: true, configurable: true
          });
          return detached;
        }), releaseRecords = capture.release;
        capture.release = async id => {
          const controller = controllers.get(id), result = await releaseRecords(id);
          if (result.ok && controller) coreRecords?.delete(controller);
          return result;
        };
        loaded.capture = capture;
        traceReaders.set(loaded, id => { const controller = controllers.get(id); return controller ? ok(copy(coreRecords?.get(controller)?.slice() ?? [])) : fail('records_not_found'); });
      }
      if (controlled) loaded.persistence = {
        async save(instance) {
          const c = handles!.get(instance); if (!c) return fail('invalid_argument');
          const status = await instance.inspect(); if (!status.ok) return status;
          if (c.computing || c.driving) return fail('instance_busy');
          if (c.state.kind === 'fault') return { ok: false, error: c.state.error };
          try {
            let pending=pendingSnapshots!.get(c);
            if(!pending||pending.state!==c.state){
              const machine=machines!.get(c)!,graph=(machine.storage as CardGraph<CardRoot<S>>).snapshot(false,ruleContextIdentityEpoch(program));
              const bytes=serialize({format:1,rule:definition.id,cooperative:options.instructionsPerSlice!==undefined,
                root:graph.root,immutable:graph.immutable,nullPrototypes:graph.nullPrototypes,contextValues:graph.contextValues,state:c.state,records:c.records?.slice()??[],recordCore,core:coreRecords?.get(c)?.snapshot()??null});
              pending={state:c.state,id:randomUUID(),bytes};pendingSnapshots!.set(c,pending);
            }
            await store!.put(pending.id,pending.bytes);
            if(pendingSnapshots!.get(c)===pending)pendingSnapshots!.delete(c);
            return ok(InstanceSnapshotSchema.parse({snapshotId:pending.id}));
          } catch (error) { return fail('program_failed', exceptionMessage(error)); }
        },
        async restore(snapshot) {
          let pending:CardStorage<CardRoot<S>>|undefined;
          try {
            const ref = InstanceSnapshotSchema.parse(snapshot), bytes = await store!.get(ref.snapshotId); if (!bytes) return fail('snapshot_not_found');
            const data = deserialize(bytes);
            if (data?.format !== 1 || data.rule !== definition.id || data.recordCore !== recordCore || (!recordCore && data.core !== null) || !Array.isArray(data.records) || !Array.isArray(data.immutable) || !Array.isArray(data.nullPrototypes)||!Array.isArray(data.contextValues) || !data.root || !['call', 'done'].includes(data.state?.kind)) return fail('snapshot_incompatible');
            if((data.cooperative??false)!==(options.instructionsPerSlice!==undefined))return fail('snapshot_incompatible');
            program.validate(data.root);
            if (data.state.kind === 'call') {
              if (!fields(data.state, ['kind', 'callId', 'call']) || !CallIdSchema.safeParse(data.state.callId).success || !fields(data.state.call, ['port', 'input']) || !Object.hasOwn(schemas.ports, data.state.call.port)) return fail('snapshot_incompatible');
              read(schemas.ports[data.state.call.port as keyof P]!.input, data.state.call.input);
            } else {
              if (!fields(data.state, ['kind', 'result'])) return fail('snapshot_incompatible');
              read(schemas.result, data.state.result);
            }
            const storage = graphStorage<CardRoot<S>>(data.root,data.immutable,data.nullPrototypes,data.contextValues), machine = new CardMachine(program, storage, options.trace);
            pending=storage;
            if (!sameData(machine.current(), data.state.kind === 'call' ? { kind: 'call', call: data.state.call } : { kind: 'done', result: data.state.result })) return fail('snapshot_incompatible');
            if (data.state.kind === 'call' && (!data.root.waiting || !data.root.frames.length)) return fail('snapshot_incompatible');
            const core = recordCore ? new CardTraceRecords(traceLayout) : undefined; core?.restore(data.core);
            const instance=await instantiate(undefined as Setup, { machine, state: data.state, records: data.records, core });pending=undefined;
            return ok(instance);
          } catch (error) { return fail('snapshot_incompatible', exceptionMessage(error)); }
          finally{pending?.close?.();}
        },
        async release(snapshot) {
          try { const ref = InstanceSnapshotSchema.parse(snapshot); if (!await store!.known(ref.snapshotId)) return fail('snapshot_not_found'); const bytes = await store!.get(ref.snapshotId); if (bytes) { const data = deserialize(bytes); if (data.rule !== definition.id || data.format !== 1) return fail('snapshot_incompatible'); await store!.remove(ref.snapshotId); } return ok(undefined); }
          catch (error) { return fail('invalid_argument', exceptionMessage(error)); }
        },
      };
      return ok(loaded);
    },
  };
}
