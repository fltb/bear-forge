import { randomUUID } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { CardProgram, CardMachine, plainCardStorage } from '@bear-forge/card-engine';
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
import { CardGraph, privateCardGraph } from './graph.ts';
import { memorySnapshotStore } from './store.ts';
import type { SnapshotStore } from './store.ts';

export type CardOptions = { controlled?: boolean; stepBudget?: number; snapshots?: SnapshotStore; recordCore?: boolean; trace?: (event: CardTrace) => void };
const nativeStructuredClone = globalThis.structuredClone;
const nativeKeys = Object.keys, nativePrototype = Object.getPrototypeOf;
/** The pristine native clone built every own field as enumerable data. Only
 * its supported data nodes still need admission; unsupported brands fall back
 * to Controller so fault kind and validation order stay unchanged. */
function ownNativeClone<T>(value: T): T {
  if (nativePrototype(Array.prototype) !== Object.prototype) return value;
  const seen = new Set<object>(); let tree = true, dense = true;
  function visit(x: any): boolean {
    if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'undefined' || typeof x === 'bigint') return true;
    if (typeof x !== 'object') return false;
    if (seen.has(x)) { tree = false; return true; }
    const array = Array.isArray(x);
    if (nativePrototype(x) !== (array ? Array.prototype : Object.prototype)) return false;
    seen.add(x);
    const names = nativeKeys(x);
    if (array && (names.length !== x.length || x.length > 0 && names[x.length - 1] !== String(x.length - 1))) dense = false;
    for (let i = 0; i < names.length; i++) if (!visit(x[names[i]!])) return false;
    return true;
  }
  return visit(value) ? retainOwned(value, tree, dense) : value;
}
const traceReaders = new WeakMap<object, (id: string) => Outcome<CardTrace[]>>();
/** Companion capture facility; the shared LoadedCore/Instance protocol is unchanged. */
export function readCardTrace(loaded: object, instanceId: string): Outcome<CardTrace[]> {
  return traceReaders.get(loaded)?.(instanceId) ?? fail('records_not_found');
}
export function createCardLoader(options: CardOptions = {}) {
  if (options.stepBudget !== undefined && (!Number.isSafeInteger(options.stepBudget) || options.stepBudget < 1)) throw Error('Invalid card step budget');
  const controlled = options.controlled ?? true;
  const store = controlled ? options.snapshots ?? memorySnapshotStore() : undefined;
  const recordCore = options.recordCore ?? controlled;
  // The existing recordCore option explicitly requests native auditing too.
  // Ordinary native games construct neither capture logs nor their registries.
  const recording = controlled || recordCore;
  return {
    async load<S, Setup, P extends { [K in keyof P]: PortShape }, R>(definition: CardDefinition<S, Setup, P, R>): Promise<Outcome<LoadedCore<Setup, P, R>>> {
      let program: CardProgram<S, Setup, P, R>;
      try { if (typeof definition.id !== 'string' || !definition.id || typeof definition.initialize !== 'function') throw Error('Invalid card definition'); assertProgramSchemasShape(definition.schemas); program = new CardProgram(definition); definition = program.definition; }
      catch (error) { return fail('invalid_argument', exceptionMessage(error)); }
      // Controller owns parser input/result isolation. Card schemas are host
      // functions, so an additional provider-side adapter would copy them twice.
      const schemas = definition.schemas;
      const graphStorage = <T>(root: T): CardGraph<T> => definition.project ? new CardGraph(root) : privateCardGraph(root);
      const nativeStorage = (root: CardRoot<S>) => {
        const clone = globalThis.structuredClone;
        if (definition.project || clone !== nativeStructuredClone) return plainCardStorage(root, clone);
        const storage: CardStorage<CardRoot<S>> = plainCardStorage(root, value => {
          const detached = clone(value);
          return value === storage.root.stop ? ownNativeClone(detached) : detached;
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
      const coreRecords = recordCore ? new WeakMap<Controller<Setup, P, R>, Records<CardTrace>>() : undefined;
      function remember(handle: Instance<P, R>, controller: Controller<Setup, P, R>): Instance<P, R> {
        if (!handles) return handle;
        handles.set(handle, controller);
        const transfer = handle.transfer;
        handle.transfer = async () => { const result = await transfer(); if (result.ok) remember(result.value, controller); return result; };
        return handle;
      }
      function instantiate(setup: Setup, restored?: { machine: CardMachine<S, Setup, P, R>; state: InstanceStop<P, R>; records: Records<InstanceRecord<Setup, P, R>> | any[]; core?: Records<CardTrace> | undefined; shared?: true }): Instance<P, R> {
        const budget = options.stepBudget ?? (controlled ? 1_000_000 : Infinity);
        let root: CardRoot<S> | undefined, storage = restored?.machine.storage;
        if (!restored) {
          const checked = read<Setup>(schemas.setup, setup);
          try { root = program.initial(checked, budget); storage = controlled ? graphStorage(root) : nativeStorage(root); }
          catch (error) {
            root = { state: undefined as S, frames: [], nextCall: 1, waiting: null, budget, stop: { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: exceptionMessage(error) } } };
            storage = controlled ? graphStorage(root) : nativeStorage(root);
          }
        }
        const core = recordCore ? restored?.core?.fork() ?? new Records<CardTrace>() : undefined;
        const observe = recordCore || options.trace ? (event: CardTrace) => {
          core?.push(event);
          // Diagnostics are not game inputs: isolate their scalar DTO and
          // never turn an observer failure into an unreplayable game fault.
          try { options.trace?.({ ...event }); } catch { /* authoritative records remain available */ }
        } : undefined;
        const machine = new CardMachine(program, storage!, observe);
        // A fork already has an isolated, immutable host stop. Re-exporting the
        // machine here would walk the entire pending view despite COW roots.
        let stop: RawStop | undefined = restored ? restored.state.kind === 'call' ? { kind: 'call', call: restored.state.call }
          : restored.state.kind === 'done' ? { kind: 'done', result: restored.state.result }
          : { kind: 'fault', error: restored.state.error } : ownStop(machine.advance());
        const controller = new Controller<Setup, P, R>({
          current: () => stop!,
          advance: async output => { stop = ownStop(machine.advance(output)); },
          dispose: () => { storage!.close?.(); stop = undefined; machines?.delete(controller); },
          ...(controlled ? { snapshot: () => Buffer.from(serialize(machine.storage.export(machine.root))).toString('base64') } : {})
        }, schemas, setup, restored ? { state: restored.state, records: restored.records, ...(restored.shared ? { shareState: true as const } : {}) } : undefined, recording);
        machines?.set(controller, machine);
        if (core) coreRecords!.set(controller, core);
        if (controlled) controller.forkHandler = async () => {
          try {
            const storage = machine.storage as CardGraph<CardRoot<S>>;
            return ok(instantiate(setup, { machine: new CardMachine(program, storage.fork()), state: controller.state, records: controller.records!, core, shared: true }));
          } catch (error) { return fail('program_failed', exceptionMessage(error)); }
        };
        controllers?.set(controller.id, controller); return remember(controller.handle(), controller);
      }
      // Exports at separate IO boundaries have independent public identities.
      // Break only the storage's cross-boundary physical leaf sharing here;
      // preserve aliases/cycles within each record and the generic default.
      const loaded: LoadedCore<Setup, P, R> = {
        core: { async start(setup) { try { return ok(instantiate(setup)); } catch (error) { return fail('invalid_input', exceptionMessage(error)); } } },
      };
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
            const machine = machines!.get(c)!;
            const bytes = serialize({ format: 1, rule: definition.id, root: machine.storage.export(machine.root), state: c.state, records: c.records!.slice(), recordCore, core: coreRecords?.get(c)?.slice() ?? [] });
            const snapshotId = randomUUID(); await store!.put(snapshotId, bytes); return ok(InstanceSnapshotSchema.parse({ snapshotId }));
          } catch (error) { return fail('program_failed', exceptionMessage(error)); }
        },
        async restore(snapshot) {
          try {
            const ref = InstanceSnapshotSchema.parse(snapshot), bytes = await store!.get(ref.snapshotId); if (!bytes) return fail('snapshot_not_found');
            const data = deserialize(bytes);
            if (data?.format !== 1 || data.rule !== definition.id || data.recordCore !== recordCore || !Array.isArray(data.core) || !Array.isArray(data.records) || !data.root || !['call', 'done'].includes(data.state?.kind)) return fail('snapshot_incompatible');
            program.validate(data.root);
            if (data.state.kind === 'call') {
              if (!fields(data.state, ['kind', 'callId', 'call']) || !CallIdSchema.safeParse(data.state.callId).success || !fields(data.state.call, ['port', 'input']) || !Object.hasOwn(schemas.ports, data.state.call.port)) return fail('snapshot_incompatible');
              read(schemas.ports[data.state.call.port as keyof P]!.input, data.state.call.input);
            } else {
              if (!fields(data.state, ['kind', 'result'])) return fail('snapshot_incompatible');
              read(schemas.result, data.state.result);
            }
            const storage = graphStorage<CardRoot<S>>(data.root), machine = new CardMachine(program, storage, options.trace);
            if (!sameData(machine.current(), data.state.kind === 'call' ? { kind: 'call', call: data.state.call } : { kind: 'done', result: data.state.result })) return fail('snapshot_incompatible');
            if (data.state.kind === 'call' && (!data.root.waiting || !data.root.frames.length)) return fail('snapshot_incompatible');
            const core = recordCore ? new Records<CardTrace>() : undefined; if (core) for (const event of data.core) core.push(event);
            return ok(instantiate(undefined as Setup, { machine, state: data.state, records: data.records, core }));
          } catch (error) { return fail('snapshot_incompatible', exceptionMessage(error)); }
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

/** Re-executes recorded accepted inputs, verifying every boundary, not winner only. */
export async function replayCard<S, Setup, P extends { [K in keyof P]: PortShape }, R>(definition: CardDefinition<S, Setup, P, R>, records: readonly InstanceRecord<Setup, P, R>[], options: CardOptions & { coreTrace?: readonly CardTrace[] } = {}): Promise<Outcome<void>> {
  const unwrap = <T>(value: Outcome<T>): T => { if (!value.ok) throw Error(value.error.message); return value.value; };
  let instance: Instance<P, R> | undefined;
  try {
    if (records[0]?.kind !== 'started' || records.some((record, index) => record.sequence !== index)) throw Error('Invalid record prefix');
    const actualTrace: CardTrace[] = [];
    const loaded = unwrap(await createCardLoader(options.coreTrace ? { ...options, trace: event => { actualTrace.push({ ...event }); options.trace?.({ ...event }); } } : options).load(definition)); instance = unwrap(await loaded.core.start(records[0].setup));
    let called: Extract<InstanceRecord<Setup, P, R>, { kind: 'called' }> | undefined;
    const callIds = new Set<string>();
    let terminal = false;
    for (const record of records.slice(1)) {
      if (terminal) throw Error('Records after terminal state');
      const stop = unwrap(await instance.inspect());
      if (record.kind === 'called') {
        if (!CallIdSchema.safeParse(record.callId).success || callIds.has(record.callId)) throw Error('Invalid or reused recorded CallId');
        if (called || stop.kind !== 'call' || !sameData(stop.call, record.call)) throw Error('Replay call mismatch at ' + record.sequence);
        callIds.add(record.callId);
        called = record;
      } else if (record.kind === 'returned') {
        if (!called || record.callId !== called.callId || record.reply.port !== called.call.port || stop.kind !== 'call') throw Error('Replay reply mismatch');
        unwrap(await instance.bind({ [record.reply.port]: async () => ({ kind: 'reply', value: record.reply.output }) } as any));
        const result = unwrap(await instance.run()); if (!result.accepted) throw Error('Replay reply rejected'); called = undefined;
      } else if (record.kind === 'completed') {
        if (called || stop.kind !== 'done' || !sameData(stop.result, record.result)) throw Error('Replay result mismatch');
        terminal = true;
      } else if (record.kind === 'faulted') {
        if (called || stop.kind !== 'fault' || !sameData(stop.error, record.error)) throw Error('Replay fault mismatch');
        terminal = true;
      } else throw Error('Repeated start record');
    }
    if (!terminal) throw Error('Incomplete replay record');
    if (options.coreTrace && !sameData(actualTrace, options.coreTrace)) throw Error('Core step replay mismatch');
    await instance.close(); await loaded.capture?.release(instance.id); return ok(undefined);
  } catch (error) { await instance?.close(); return fail('invalid_argument', exceptionMessage(error)); }
}
