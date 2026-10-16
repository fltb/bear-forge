import { createHash } from 'node:crypto';
import { copy, keys } from '@bear-forge/boundary';
import { assertProgramModuleShape, assertProgramSchemasShape, exceptionMessage } from '@bear-forge/runtime';
import { createProgramRealm } from './program-realm.ts';
export type Artifact = {
  format: 1;
  abi: string;
  code: string;
  digest: string;
  exportName: string;
  contextLayout: 'lexical-cells';
  namespaceKeys: string[] | null;
};
export function digest(content: Uint8Array) {
  return createHash('sha256').update(content).digest('hex');
}
export function decode(content: Uint8Array): Artifact {
  if (!(content instanceof Uint8Array) || content.byteLength > 32 * 1024 * 1024) throw new Error('Invalid artifact');
  const x = JSON.parse(new TextDecoder().decode(content));
  if (x.metadata?.policy !== 'guarded-operations') throw new Error('Artifact requires guarded operation compilation');
  if (x.format !== 1 || x.abi !== 'effectful-v2-main-3' || x.contextLayout !== 'lexical-cells' || !(x.namespaceKeys === null || Array.isArray(x.namespaceKeys) && x.namespaceKeys.every((k: unknown) => typeof k === 'string')) || typeof x.code !== 'string' || typeof x.exportName !== 'string' || x.digest !== createHash('sha256').update(x.code).digest('hex')) throw new Error('Incompatible artifact');
  return x;
}
/** Static handlers and serialization descriptors are registered once per Program.
 * Only synchronous controlled execution enters this dispatcher. Host callbacks run
 * outside it; no selected Context survives a return to the host event loop. */
class LoadedProgram {
  readonly realm: ReturnType<typeof createProgramRealm>['realm'];
  readonly effects: any;
  private readonly initialize: () => unknown;
  readonly namespaceDescriptor: any;
  readonly globals: () => Record<string, unknown>;
  readonly statistics = { registrations: 1, initializations: 0 };
  readonly record: () => Record<string, unknown>;
  readonly array: (length: number) => unknown[];
  private storage(value: object) {
    const state = this.effects.State.context, heap = state.objects ?? state.memory?.objects;
    return heap?.has(value) ? heap : undefined;
  }
  readonly inspection = {
    getPrototypeOf: (value: object): object | null => {
      const storage = this.storage(value);
      return storage ? storage.getPrototypeOf(value) : Object.getPrototypeOf(value);
    },
    getOwnPropertyDescriptor: (value: object, key: PropertyKey): PropertyDescriptor | undefined => {
      const storage = this.storage(value);
      return storage ? storage.getOwnPropertyDescriptor(value,key) : Object.getOwnPropertyDescriptor(value,key);
    },
    ownKeys: (value: object): (string | symbol)[] => this.storage(value)?.ownKeys(value) ?? Reflect.ownKeys(value)
  };
  read(value: any, key: PropertyKey): any { return this.effects.operations.get(this.effects.operations.ref(value,key)); }
  constructor(artifact: Artifact) {
    const { realm, runtime, factory, effectsFactory, allocators } = createProgramRealm(artifact.code);
    this.realm = realm;
    this.record = allocators.record;
    this.array = allocators.array;
    const { createOperations, protectIntrinsics, programEnvironment } = runtime;
    this.effects = effectsFactory();
    const tick = this.effects.tick;
    this.effects.operations = this.effects.installOperations(createOperations);
    for (const value of this.effects.intrinsics) protectIntrinsics(value);
    const context = this.effects.State.context;
    context.jobs = new this.effects.CowQueue();
    context.collections = new this.effects.WeakMap();
    context.cjs = Object.assign(this.record(), { id: 'program', exports: this.record() });
    context.initialExports = context.cjs.exports;
    const unavailable = (): never => {
      context.__hostViolation = true;
      throw Error('Undeclared host effect');
    };
    const capabilities = programEnvironment(tick, unavailable);
    this.globals = () => capabilities.globals(this.effects.Future, { WeakMap: this.effects.WeakMap, WeakSet: this.effects.WeakSet });
    for (const [key, value] of Object.entries(capabilities.intrinsics)) {
      if ((typeof value === 'function' || typeof value === 'object') && value !== null && value !== Function) {
        this.effects.S.regOpaqueRec(value, 'environment.' + key, { descriptor: { props: false } });
      }
    }
    // The shallow registrations above keep existing persistence names stable.
    // A program can also retain an inherited constructor, accessor or method
    // from a visible intrinsic across IO. Register that entire shared graph
    // once so Context copying never tries to clone host-owned code.
    const seenIntrinsics = new Set<object>();
    let intrinsicIndex = 0;
    const registerIntrinsic = (value: unknown): void => {
      if (value === null || typeof value !== 'object' && typeof value !== 'function' || seenIntrinsics.has(value)) return;
      seenIntrinsics.add(value);
      this.effects.S.regOpaqueObject(value, 'environment.graph.' + intrinsicIndex++, { props: false });
      registerIntrinsic(Object.getPrototypeOf(value));
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if ('value' in descriptor) registerIntrinsic(descriptor.value);
        else {
          registerIntrinsic(descriptor.get);
          registerIntrinsic(descriptor.set);
        }
      }
    };
    for (const value of Object.values(capabilities.intrinsics)) registerIntrinsic(value);
    Object.assign(this.effects.globals, {
      Math: capabilities.Math,
      Function: capabilities.Function,
      globalThis: this.effects.globals
    });
    if (artifact.namespaceKeys !== null) {
      const keys = artifact.namespaceKeys;
      const program = this;
      this.namespaceDescriptor = this.effects.S.regDescriptor({
        name: 'program.namespace', props: false,
        create() { return program.record(); },
        write(ctx: any, namespace: any) {
          const storage = program.storage(namespace);
          const fields = keys.filter(key => program.inspection.getOwnPropertyDescriptor(namespace,key)).map(key => {
            const descriptor = program.inspection.getOwnPropertyDescriptor(namespace, key)!;
            const field: any = { key, enumerable: descriptor.enumerable, configurable: descriptor.configurable };
            if ('value' in descriptor) {
              field.writable = descriptor.writable;
              field.value = ctx.step(descriptor.value, field, 'value');
            } else {
              field.get = ctx.step(descriptor.get, field, 'get');
              field.set = ctx.step(descriptor.set, field, 'set');
            }
            return field;
          });
          const result: any = { fields, extensible: storage ? storage.isExtensible(namespace) : Object.isExtensible(namespace) };
          result.prototype = ctx.step(program.inspection.getPrototypeOf(namespace), result, 'prototype');
          return result;
        },
        readContent(ctx: any, data: any, namespace: any) {
          Object.setPrototypeOf(namespace, ctx.step(data.prototype));
          for (const field of data.fields) Object.defineProperty(namespace, field.key, {
            enumerable: field.enumerable, configurable: field.configurable,
            ...('writable' in field ? { writable: field.writable, value: ctx.step(field.value) } : { get: ctx.step(field.get), set: ctx.step(field.set) })
          });
          if (!data.extensible) Object.preventExtensions(namespace);
          program.effects.State.context.objects?.register(namespace);
        }
      });
    }
    this.initialize = factory(this.effects, capabilities).initialize;
  }
  enter<T>(context: any, action: () => T): T {
    const state = this.effects.State.context;
    const saved = { ...state };
    // Dispatcher scratch is reset at the call boundary; persistent roots belong
    // to Context. Registration tables and pure builtin capabilities stay shared.
    Object.assign(state, { top: null, call: null, running: false, error: false, value: undefined,
      exception: this.effects.State.undef, active: context, jobs: context.jobs, collections: context.collections,
      cjs: context.cjs, initialExports: context.initialExports, globals: context.globals,
      objects:context.objects,memory:context.memory,intrinsicSlots:context.intrinsicSlots,
      collectionMemory:context.collectionMemory,weakMemory:context.weakMemory,
      __budgetExceeded: context.__budgetExceeded, __hostViolation: context.__hostViolation });
    try { return action(); }
    finally {
      context.cjs = state.cjs;
      context.initialExports = state.initialExports;
      context.globals = state.globals;
      context.__budgetExceeded = state.__budgetExceeded;
      context.__hostViolation = state.__hostViolation;
      for (const key of Object.keys(state)) if (!Object.hasOwn(saved, key)) delete state[key];
      Object.assign(state, saved);
    }
  }
  namespace(value: any) {
    if (this.namespaceDescriptor && value && typeof value === 'object') this.effects.S.setObjectDescriptor(value, this.namespaceDescriptor);
  }
  input(value: unknown): unknown {
    const source = copy(value);
    const seen = new Map<object, unknown>();
    const visit = (current: any): any => {
      if (current === null || typeof current !== 'object') return current;
      if (seen.has(current)) return seen.get(current);
      const target: any = Array.isArray(current) ? this.array(current.length) : this.record();
      seen.set(current, target);
      // Every admitted JSON key is data, including "__proto__".
      for (const key of Object.keys(current)) Object.defineProperty(target, key, {
        value: visit(current[key]), enumerable: true, writable: true, configurable: true
      });
      return this.effects.State.context.allocate(target);
    };
    return visit(source);
  }
  initializeContext(context: any, exportName: string) {
    this.enter(context, () => {
      this.statistics.initializations++;
      const evaluation = this.initialize();
      if (evaluation !== undefined) {
        this.effects.drain();
        const completion = this.effects.stateOf(evaluation);
        if (completion.status === 2) throw completion.value;
        if (completion.status !== 1) throw Error('Module initialization is suspended without an external input boundary');
      }
      const entry = this.read(this.read(context.cjs,'exports'),exportName);
      assertProgramModuleShape(entry,this.inspection);
      const run = this.read(entry,'run'), schemas = this.read(entry,'schemas');
      // Retain only the entry binding and validator values, not the public
      // ProgramModule/exports container. Their closure code is shared metadata.
      const closure = this.effects.State.closures.get(run);
      const usesReceiver = closure && (closure[this.effects.State.CLOSURE_META].flags & this.effects.State.Flag.HAS_THIS);
      context.bindings = Object.assign(this.record(), { run, schemas,
        ...(usesReceiver ? { receiver: entry } : {}) });
    });
  }
}
const programs = new Map<string, WeakRef<LoadedProgram>>();
function load(artifact: Artifact): LoadedProgram {
  const key = artifact.digest + JSON.stringify(artifact.namespaceKeys);
  let program = programs.get(key)?.deref();
  if (!program) {
    program = new LoadedProgram(artifact);
    programs.set(key, new WeakRef(program));
    for (const [key, ref] of programs) if (!ref.deref()) programs.delete(key);
  }
  return program;
}
/** Context owns mutable values and explicit continuation frames. Code lives in
 * LoadedProgram; creating/restoring a handle does not run module initialization. */
export class ProgramExecution {
  readonly loaded: LoadedProgram;
  private context: any;
  private pendingReplyContext: any | undefined;
  private readonly artifact: Artifact;
  private copyPlan: (() => any) | undefined;
  constructor(artifact: Artifact, budget = 1000000, loaded?: LoadedProgram) {
    this.artifact = artifact;
    this.loaded = loaded ?? load(artifact);
    const initialExports = this.loaded.record();
    const storage=this.loaded.effects.createContextRoots(),objects=storage.objects;
    this.context = Object.assign(this.loaded.record(), { bindings: null, io: undefined, result: undefined, jobs: new this.loaded.effects.CowQueue(),
      ...storage,
      remaining: budget, cjs: Object.assign(this.loaded.record(), { id: 'program', exports: initialExports }), initialExports,
      globals: this.loaded.globals(),
      __budgetExceeded: false, __hostViolation: false });
    objects.register(initialExports);objects.register(this.context.globals);
  }
  fresh(budget = 1000000): ProgramExecution { return new ProgramExecution(this.artifact, budget, this.loaded); }
  private releaseContext(context: any) {
    if (!context) return;
    for (const key of ['objects','memory','intrinsicSlots','collectionMemory','weakMemory','jobs']) context[key]?.clear();
  }
  private initialize() {
    if (!this.context.bindings) this.loaded.initializeContext(this.context, this.artifact.exportName);
  }
  private guard<T>(action: () => T): T {
    this.copyPlan = undefined;
    return this.loaded.enter(this.context, () => {
      const result = action();
      const state = this.loaded.effects.State.context;
      if (state.__budgetExceeded) throw Error('budget exceeded');
      if (state.__hostViolation) throw Error('Undeclared host effect');
      return result;
    });
  }
  get io() {
    return this.loaded.enter(this.context,()=>{
    const state = this.context.io && this.loaded.effects.stateOf(this.context.io);
    return state && { ...state, ...(state.callData === undefined ? {} : { callData: copy(state.callData,this.loaded.inspection) }) };
    });
  }
  get result() {
    return this.loaded.enter(this.context,()=>{
    const state = this.context.result && this.loaded.effects.stateOf(this.context.result);
    if (!state) return state;
    if (state.status !== 1) return { ...state };
    // The internal execution handle also supports inspecting non-JSON
    // language values in differential/copy tests. Public Instance results are
    // admitted and copied by the schema boundary before reaching callers.
    try { return { ...state, value: copy(state.value,this.loaded.inspection) }; }
    catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return { ...state };
    }
    });
  }
  admitSchemas() {
    this.initialize();
    this.guard(() => {
      const schemas = this.context.bindings.schemas, { admitSchema } = this.loaded.effects;
      assertProgramSchemasShape(schemas,this.loaded.inspection);
      const read = (value: any,key: string) => this.loaded.read(value,key);
      admitSchema(read(schemas,'setup')); admitSchema(read(schemas,'result'));
      const ports = read(schemas,'ports');
      for (const key of keys(ports,this.loaded.inspection)) {
        const port=read(ports,key); admitSchema(read(port,'input')); admitSchema(read(port,'output'));
      }
    });
  }
  boundarySchemas(): any {
    this.initialize();
    return this.guard(() => {
      const wrap = (select: (schemas: any) => any, transactional = false) => Object.freeze({
        parse: (value: unknown) => {
          const parse = (execution: ProgramExecution) => execution.guard(() => {
            const schema = select(execution.context.bindings.schemas), loaded = execution.loaded;
            return copy(loaded.effects.operations.invoke(loaded.read(schema,'parse'),schema,[loaded.input(value)]),loaded.inspection);
          });
          if (!transactional) return parse(this);
          // A rejected host reply leaves the pending IO and all game state
          // untouched. Parse on a Context branch and install it only if the
          // reply is accepted or the parser latched a terminal fault.
          const branch = this.fork();
          try {
            const parsed = parse(branch);
            // Validation alone is not acceptance: the caller may cancel after
            // parsing and before it advances the pending IO.
            this.discardOutput();
            this.pendingReplyContext = branch.context;
            branch.context = undefined;
            return parsed;
          } catch (error) {
            if (branch.fault || branch.hostViolation) {
              this.releaseContext(this.context);
              this.context = branch.context;
              branch.context = undefined;
              this.copyPlan = undefined;
            }
            throw error;
          } finally { branch.dispose(); }
        }
      });
      const schemas = this.context.bindings.schemas;
      assertProgramSchemasShape(schemas,this.loaded.inspection);
      const read = (value: any,key: string) => this.loaded.read(value,key);
      const ports = Object.fromEntries(keys(read(schemas,'ports'),this.loaded.inspection).map(key => [key,
        Object.freeze({ input: wrap(schemas => read(read(read(schemas,'ports'),key),'input')),
          output: wrap(schemas => read(read(read(schemas,'ports'),key),'output'), true) })]));
      return Object.freeze({ setup: wrap(schemas => read(schemas,'setup')), result: wrap(schemas => read(schemas,'result')), ports: Object.freeze(ports) });
    });
  }
  start(setup: unknown) {
    this.copyPlan = undefined;
    this.discardOutput();
    this.initialize();
    this.loaded.enter(this.context, () => {
      this.context.io = new this.loaded.effects.Device();
      const result = Reflect.apply(this.context.bindings.run, this.context.bindings.receiver, [this.loaded.input(setup), this.context.io]);
      // Program.run must return a managed Promise. Check before exposing a
      // resumable handle; a plain value cannot carry a controlled completion.
      this.loaded.effects.stateOf(result);
      this.context.result = result;
      this.loaded.effects.drain();
    });
  }
  resume(output: unknown) {
    this.copyPlan = undefined;
    if (this.pendingReplyContext) {
      this.releaseContext(this.context);
      this.context = this.pendingReplyContext;
      this.pendingReplyContext = undefined;
    }
    this.loaded.enter(this.context, () => this.loaded.effects.reply(this.context.io, this.loaded.input(output)));
  }
  discardOutput() { this.releaseContext(this.pendingReplyContext); this.pendingReplyContext = undefined; }
  private roots(): any {
    const io = this.context.io && this.loaded.effects.stateOf(this.context.io);
    const result = this.context.result && this.loaded.effects.stateOf(this.context.result);
    if (!this.context.bindings || this.pendingReplyContext || this.fault || this.hostViolation || this.context.jobs.length || io?.fault || !(io?.pending && result?.status === 0 || !io?.pending && result?.status === 1)) throw Error('Context is not saveable');
      // Future listeners and retained resolvers own resumable frames. An
      // independent strong registry of every suspended frame would retain
      // abandoned tasks and their unreachable payloads forever.
      const { cjs, initialExports, objects, memory, intrinsicSlots, collectionMemory, weakMemory, ...values } = this.context;
      // Ordinary exports are loading products, not execution roots. Preserve
      // namespace data only where compiled author code actually refers to it.
      const keys = this.artifact.namespaceKeys;
      // Only the loader-created container has the compiler's namespace shape.
      // A replacement exports object can also be reachable as ordinary author
      // data through a local CommonJS wrapper; filtering it would delete live
      // properties from that alias during fork/save.
      this.loaded.namespace(initialExports);
      const namespaces = keys === null || keys.length ? { cjs, initialExports } : {};
      return Object.assign(this.loaded.record(), values, namespaces);
  }
  private encode(): any {
    return this.loaded.enter(this.context, () => this.loaded.effects.S.write(this.roots()));
  }
  snapshot(): string {
    return JSON.stringify({ layout: 'lexical-cells', context: this.encode() });
  }
  fork(): ProgramExecution {
    this.loaded.enter(this.context,()=>this.roots());
    const next=Object.create(ProgramExecution.prototype) as ProgramExecution;
    Object.assign(next,{artifact:this.artifact,loaded:this.loaded});
    const objects=this.context.objects.fork();
    next.context={...this.context,objects,memory:this.context.memory.fork(objects),
      intrinsicSlots:this.context.intrinsicSlots.fork(),collectionMemory:this.context.collectionMemory.fork(),
      weakMemory:this.context.weakMemory.fork(),jobs:this.context.jobs.fork()};
    return next;
  }
  private decode(encoded: any) {
    // Decode into fresh stores without initializing author code. Reusing the
    // current stores retains every previous restored graph, and a failed read
    // must not mutate the running Context.
    const target = this.fresh(this.context.remaining);
    try {
      const value = this.loaded.enter(target.context, () => this.loaded.effects.S.read(encoded));
      target.install(value);
      this.releaseContext(this.context);
      this.context = target.context;
      target.context = undefined;
      this.discardOutput();
      this.copyPlan = undefined;
    } finally { target.dispose(); }
  }
  private install(value: any) {
    this.copyPlan = undefined;
    this.pendingReplyContext = undefined;
    if (!value?.bindings?.run || !value.bindings.schemas || !(value.jobs instanceof this.loaded.effects.CowQueue || Array.isArray(value.jobs)) || !Number.isSafeInteger(value.remaining)) throw Error('Invalid Context');
    if (Array.isArray(value.jobs)) {
      const queue = new this.loaded.effects.CowQueue();
      for (const job of value.jobs) queue.push(job);
      value.jobs = queue;
    }
    const initialExports = Object.hasOwn(value, 'initialExports') ? value.initialExports : value.cjs?.exports ?? {};
    // Older contexts may carry the redundant debugger index. It is not an
    // execution dependency; restoring it would reintroduce strong retention.
    const { suspended: _debugIndex, ...execution } = value;
    this.context = { ...this.context, ...execution, initialExports, cjs: value.cjs ?? { id: 'program', exports: initialExports } };
  }
  restore(data: string) {
    const saved = JSON.parse(data);
    if (saved.layout !== 'lexical-cells') throw Error('Incompatible Context');
    this.decode(saved.context);
  }
  dispose() { this.copyPlan = undefined; this.discardOutput(); this.releaseContext(this.context); this.context = undefined; }
  get fault() { return this.context.__budgetExceeded; }
  message(value: unknown) { return this.loaded.enter(this.context,()=>exceptionMessage(value,this.loaded.inspection)); }
  get hostViolation() { return this.context.__hostViolation; }
}
