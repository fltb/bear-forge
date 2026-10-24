import {probabilityOperationFor,validateProbabilitySpace,validateCoordinate,generateProbability,forkProbabilityStorage,probabilityResidentBytes,forwardProbabilityReceiver,type ForwardProbability,type ForwardProbabilityResult,type ProbabilityOperation,type ProbabilityStop,type ProbabilityCoordinate,type ProbabilityEntropy,type ProbabilityOutcomes} from './probability.ts';
import {temporaryLocalsFor} from './card-execution-hints.ts';
import {inheritRuleReplyGuards} from './rules-reply-guards.ts';
import type { PortShape } from '@bear-forge/contracts/core';
import type { CardDefinition, CardEffect, CardExpression, CardFrame, CardRoot, CardScope, CardStep, CardStop, CardStorage, CardTrace } from './card.types.ts';
import { traceWriterFor } from './card-trace.ts';
import type { TraceWriter } from './card-trace.ts';
import {cardAdmissionFor} from './card-admission.ts';

type Frame<S> = CardFrame & { scope: CardScope<S> };
type Instruction<S> = ((execution: Execution<S>, frame: Frame<S>) => void) & {probability?: ProbabilityOperation<S>};
type Block<S> = { run: readonly Instruction<S>[]; trace: readonly Omit<CardTrace, 'depth'>[] };
type Executable<S> = { temporaryLocals:ReadonlyMap<number,(state:unknown)=>boolean>; blocks: readonly Block<S>[]; effects: ReadonlyMap<string, number> };
const executables = new WeakMap<object, unknown>();

/** Transient cursors are materialized only at an observable stop. All author
 * values/aliases remain owned by storage; the cursors contain no rule state. */
class Execution<S> {
  readonly frames: Frame<S>[] = [];
  depth = 0;
  budget: number;
  nextCall: number;
  stop: CardRoot<S>['stop'] = null;
  waiting: CardRoot<S>['waiting'] = null;
  readonly writeTrace: TraceWriter | undefined;
  readonly storage:CardStorage<CardRoot<S>>;
  readonly plan:Executable<S>;
  readonly observe:((event:CardTrace)=>void)|undefined;
  readonly probability: boolean;
  coordinate: ProbabilityCoordinate | undefined;
  readonly publications:unknown[];
  forwardValue:{value:ForwardProbabilityResult}|undefined;
  forwardPending:{kernel:ForwardProbability<S>;plan:NonNullable<ReturnType<ForwardProbability['plan']>>;scope:CardScope<S>}|undefined;
  constructor(storage: CardStorage<CardRoot<S>>, plan: Executable<S>, observe: ((event: CardTrace) => void) | undefined, probability = false, coordinate?: ProbabilityCoordinate, forwardValue?:{value:ForwardProbabilityResult},publications:unknown[] = []) {
    this.storage=storage;this.plan=plan;this.observe=observe;this.probability=probability;this.coordinate=coordinate;this.forwardValue=forwardValue;this.publications=publications;
    const root = storage.root;
    this.writeTrace = traceWriterFor(observe);
    this.budget = root.budget; this.nextCall = root.nextCall;
    const scopes = new Map<number, CardScope<S>>();
    for (const saved of root.frames) {
      let scope = scopes.get(saved.call);
      if (!scope) { scope = { state: root.state, input: saved.input, locals: saved.locals }; scopes.set(saved.call, scope); }
      this.frames.push({ block: saved.block, index: saved.index, input: saved.input, locals: saved.locals,
        call: saved.call, target: saved.target, items: saved.items, item: saved.item, scope });
    }
    this.depth = this.frames.length;
  }
  push(block: number, scope: CardScope<S>, call: number, target: string | null = null): void {
    let frame = this.frames[this.depth];
    if (!frame) this.frames.push({ block, index: 0, input: scope.input, locals: scope.locals, call, target, items: null, item: 0, scope });
    else { frame.block = block; frame.index = 0; frame.input = scope.input; frame.locals = scope.locals; frame.call = call; frame.target = target; frame.items = null; frame.item = 0; frame.scope = scope; }
    this.depth++;
  }
  invoke(block: number, parent: Frame<S>, input: unknown, target: string | null = null): void {
    const state=this.storage.root.state,temporary=this.plan.temporaryLocals.get(block)?.(state)===true;
    const local=Object.create(null) as Record<string,unknown>;
    const scope = { state, input, locals: temporary?local:this.storage.own(local) };
    this.push(block, scope, this.nextCall++, target);
  }
  child(block: number, parent: Frame<S>): void {
    this.push(block, { state: this.storage.root.state, input: parent.input, locals: parent.locals }, parent.call);
  }
  finish(value: unknown, call: number): void {
    let target: string | null = null;
    while (this.depth && this.frames[this.depth - 1]!.call === call) target = this.frames[--this.depth]!.target ?? target;
    if (!this.depth) this.stop = { kind: 'done', result: value };
    else if (target !== null) this.frames[this.depth - 1]!.locals[target] = value;
  }
  run(): void {
    while (!this.stop) {
      if (!this.depth) { this.stop = { kind: 'done', result: undefined }; break; }
      const frame = this.frames[this.depth - 1]!, block = this.plan.blocks[frame.block]!;
      if (frame.index === block.run.length) {
        this.depth--;
        if (this.depth && this.frames[this.depth - 1]!.call !== frame.call && frame.target !== null) this.frames[this.depth - 1]!.locals[frame.target] = undefined;
        continue;
      }
      // Consecutive operations run in one bound block. Scope is an ephemeral
      // author-facing view: assigning to its fields never changes the frame.
      const depth = this.depth;
      do {
        frame.scope = { state: this.storage.root.state, input: frame.input, locals: frame.locals };
        const instruction = block.run[frame.index]!;
        if(!this.probability&&instruction.probability?.forward&&!this.forwardValue&&forwardProbabilityReceiver(this.storage)?.enabled?.()!==false){
          const kernel=instruction.probability.forward,plan=kernel.plan(frame.scope);
          if(plan){
            const space=instruction.probability.space(frame.scope);
            if(space.kind!=='boundary'||!instruction.probability.resolveForward)throw Error('Forward probability requires a result-bearing boundary');
            validateProbabilitySpace(space);this.forwardPending={kernel,plan,scope:frame.scope};this.stop={kind:'chance',space};break;
          }
        }
        if (this.probability && instruction.probability && this.coordinate === undefined) {
          // Suspend BEFORE executing the operation, charging or tracing it.
          // All previous instructions remain committed in this exact Context.
          const space = instruction.probability.space(frame.scope);
          validateProbabilitySpace(space);
          this.stop = {kind:'chance',space};
          break;
        }
        if (this.budget !== Infinity && this.budget-- <= 0) {
          this.stop = { kind: 'fault', error: { kind: 'fault', code: 'budget_exceeded', message: 'Card step budget exceeded' } }; break;
        }
        if (this.writeTrace) this.writeTrace(block.trace[frame.index]!, depth);
        else if (this.observe) this.observe({ ...block.trace[frame.index]!, depth });
        instruction(this, frame);
      } while (!this.stop && this.depth === depth && this.frames[depth - 1] === frame && frame.index < block.run.length);
    }
  }
  publish(): void {
    const root = this.storage.root, frames = new Array<CardFrame>(this.depth);
    for (let index = 0; index < this.depth; index++) {
      const frame = this.frames[index]!;
      frames[index] = { block: frame.block, index: frame.index, input: frame.input, locals: frame.locals,
        call: frame.call, target: frame.target, items: frame.items, item: frame.item };
    }
    root.frames = frames; root.nextCall = this.nextCall;
    if(this.budget!==Infinity)root.budget = this.budget;
    root.waiting = this.waiting; root.stop = this.stop;
  }
}

function compileInstruction<S>(step: CardStep<S>, children: readonly number[] | undefined, effects: ReadonlyMap<string, number>): Instruction<S> {
  switch (step.kind) {
    case 'operation': {
      const kernel = probabilityOperationFor(step.run);
      const instruction: Instruction<S> = (execution, frame) => {
      const coordinate = execution.coordinate;
      if (execution.probability && kernel && coordinate === undefined) throw Error('Missing probability selection');
      const forward=execution.forwardValue&&kernel?.resolveForward,started=forward?performance.now():0;
      let value:any;
      try{value=forward?forward(frame.scope,execution.forwardValue!.value):execution.probability&&kernel?(typeof coordinate==='bigint'?kernel.resolve(frame.scope,coordinate):kernel.resolveSample!(frame.scope,coordinate!.value)):step.run(frame.scope);}
      finally{if(forward)forwardProbabilityReceiver(execution.storage)?.charge?.(performance.now()-started);}
      if (execution.probability && kernel) execution.coordinate = undefined;
      execution.forwardValue=undefined;
      if(kernel?.publication){
        const started=performance.now();
        try{const publication=kernel.publication(frame.scope,value);if(publication!==undefined)execution.publications.push(publication);}
        finally{if(!execution.probability)forwardProbabilityReceiver(execution.storage)?.charge?.(performance.now()-started);}
      }
      if(execution.probability&&kernel?.constraints)for(const condition of kernel.constraints(frame.scope,value))execution.publications.push({kind:'probability-constraint',...condition});
      // CardExpression's public result is unconstrained and can include a
      // Promise. Rule-module shape checks are erased separately at binding.
      if (value && typeof value.then === 'function') throw Error('Card operation must be synchronous');
      if (step.to !== null) frame.locals[step.to] = value;
      frame.index++;
      };
      if (kernel) instruction.probability = kernel;
      return instruction;
    }
    case 'invoke': {
      const fixed = typeof step.effect === 'string' ? effects.get(step.effect)! : null;
      const selected = typeof step.effect === 'function' ? step.effect : null;
      return (execution, frame) => {
        let block = fixed;
        if (block === null) { const name = selected!(frame.scope); block = effects.get(name) ?? null; if (block === null) throw Error('Unknown effect: ' + name); }
        const input = execution.storage.own(step.input(frame.scope)); frame.index++;
        execution.invoke(block, frame, input, step.to);
      };
    }
    case 'branch': return (execution, frame) => { const selected = step.test(frame.scope); frame.index++; execution.child(children![selected ? 0 : 1]!, frame); };
    case 'repeat': return (execution, frame) => { if (step.test(frame.scope)) execution.child(children![0]!, frame); else frame.index++; };
    case 'each': {
      const block = effects.get(step.effect)!;
      return (execution, frame) => {
        if (frame.items === null) { frame.items = execution.storage.own([...step.items(frame.scope)]); frame.item = 0; }
        if (frame.item === frame.items.length) { frame.items = null; frame.index++; }
        else execution.invoke(block, frame, frame.items[frame.item++]);
      };
    }
    case 'request': return (execution, frame) => {
      const call = step.call(frame.scope); frame.index++;
      const detached = execution.storage.own(call);
      execution.waiting = { frame: execution.depth - 1, to: step.to, call: detached };
      execution.stop = { kind: 'call', call: detached };
    };
    case 'return': return (execution, frame) => execution.finish(step.value(frame.scope), frame.call);
  }
}

export const card = {
  operation<S>(run: CardExpression<S>, to: string | null = null): CardStep<S> { return { kind: 'operation', run, to }; },
  invoke<S>(effect: string | CardExpression<S, string>, input: CardExpression<S> = () => undefined, to: string | null = null): CardStep<S> { return { kind: 'invoke', effect, input, to }; },
  request<S>(call: CardExpression<S>, to: string | null = null): CardStep<S> { return { kind: 'request', call, to }; },
  branch<S>(test: CardExpression<S, boolean>, yes: readonly CardStep<S>[], no: readonly CardStep<S>[] = []): CardStep<S> { return { kind: 'branch', test, yes, no }; },
  repeat<S>(test: CardExpression<S, boolean>, body: readonly CardStep<S>[]): CardStep<S> { return { kind: 'repeat', test, body }; },
  forEach<S>(items: CardExpression<S, readonly any[]>, effect: string): CardStep<S> { return { kind: 'each', items, effect }; },
  return<S>(value: CardExpression<S> = () => undefined): CardStep<S> { return { kind: 'return', value }; },
};

/** Immutable definition linking only; no source rewriting or generated code. */
export class CardProgram<S, Setup, P extends { [K in keyof P]: PortShape }, R> {
  readonly blocks: readonly (readonly CardStep<S>[])[];
  readonly children = new Map<CardStep<S>, readonly number[]>();
  readonly effects = new Map<string, number>();
  readonly names: readonly string[];
  readonly definition: CardDefinition<S, Setup, P, R>;
  private readonly admitState:((state:unknown)=>void)|undefined;
  constructor(definition: CardDefinition<S, Setup, P, R>) {
    this.admitState=cardAdmissionFor(definition);
    if (definition.project !== undefined && typeof definition.project !== 'function') throw Error('Invalid card projection');
    this.definition = Object.freeze({ ...definition, effects: Object.freeze([...definition.effects]) });
    inheritRuleReplyGuards(definition.effects,this.definition.effects);
    const blocks: (readonly CardStep<S>[])[] = [], names: string[] = [], temporaryLocals=new Map<number,(state:unknown)=>boolean>();
    const active = new Set<readonly CardStep<S>[]>();
    const register = (steps: readonly CardStep<S>[], name: string): number => {
      if (!Array.isArray(steps) || active.has(steps)) throw Error('Invalid or cyclic structural block');
      active.add(steps);
      const own = steps.map(step => ({ ...step })) as CardStep<S>[];
      const index = blocks.length; blocks.push(own); names.push(name);
      const temporary=temporaryLocalsFor(steps);if(temporary)temporaryLocals.set(index,temporary);
      for (const step of own) {
        if (!['operation', 'invoke', 'request', 'branch', 'repeat', 'each', 'return'].includes(step.kind)) throw Error('Unknown card instruction');
        const fn = (value: unknown) => { if (typeof value !== 'function') throw Error('Card expression must be a function'); };
        if (step.kind === 'operation') fn(step.run);
        if (step.kind === 'invoke') { if (typeof step.effect !== 'string') fn(step.effect); fn(step.input); }
        if (step.kind === 'request') fn(step.call);
        if (step.kind === 'branch' || step.kind === 'repeat') fn(step.test);
        if (step.kind === 'each') { fn(step.items); if (typeof step.effect !== 'string') throw Error('Invalid iteration effect'); }
        if (step.kind === 'return') fn(step.value);
        if (['operation', 'invoke', 'request'].includes(step.kind) && (step as { to: unknown }).to !== null && typeof (step as { to: unknown }).to !== 'string') throw Error('Invalid result slot');
        if (step.kind === 'branch') this.children.set(step, [register(step.yes, name), register(step.no, name)]);
        if (step.kind === 'repeat') this.children.set(step, [register(step.body, name)]);
        Object.freeze(step);
      }
      Object.freeze(own);
      active.delete(steps);
      return index;
    };
    for (const effect of definition.effects) {
      if (typeof effect.id !== 'string' || !effect.id || this.effects.has(effect.id)) throw Error('Duplicate or invalid effect: ' + effect.id);
      this.effects.set(effect.id, register(effect.steps, effect.id));
    }
    if (!this.effects.has(definition.entry)) throw Error('Unknown entry effect');
    for (const block of blocks) for (const step of block) {
      if ((step.kind === 'invoke' && typeof step.effect === 'string' || step.kind === 'each') && !this.effects.has(step.effect as string)) throw Error('Unknown static effect: ' + step.effect);
    }
    this.blocks = Object.freeze(blocks); this.names = Object.freeze(names);
    const compiled: Executable<S> = { temporaryLocals,effects: this.effects, blocks: blocks.map((block, index) => ({
      run: block.map(step => compileInstruction(step, this.children.get(step), this.effects)),
      trace: block.map((step, position) => ({ effect: names[index]!, block: index, index: position, kind: step.kind })),
    })) };
    executables.set(this, compiled);
  }
  initial(setup: Setup, budget = Number.MAX_SAFE_INTEGER): CardRoot<S> {
    return { state: this.definition.initialize(setup), frames: [{ block: this.effects.get(this.definition.entry)!, index: 0, input: setup, locals: Object.create(null), call: 0, target: null, items: null, item: 0 }], nextCall: 1, waiting: null, stop: null, budget };
  }
  validate(root: CardRoot<S>): void {
    if (!root || !Array.isArray(root.frames) || !Number.isSafeInteger(root.nextCall) || root.nextCall < 1 || !Number.isSafeInteger(root.budget) || root.budget < 0 || !root.stop || !['call', 'done'].includes(root.stop.kind)) throw Error('Invalid card snapshot root');
    for (const frame of root.frames) {
      const block = this.blocks[frame.block];
      if (!block || !Number.isInteger(frame.index) || frame.index < 0 || frame.index > block.length || !Number.isSafeInteger(frame.call) || frame.call < 0 || frame.call >= root.nextCall || !frame.locals || typeof frame.locals !== 'object' || Array.isArray(frame.locals) || frame.target !== null && typeof frame.target !== 'string' || frame.items !== null && !Array.isArray(frame.items) || !Number.isSafeInteger(frame.item) || frame.item < 0 || frame.items && frame.item > frame.items.length) throw Error('Invalid card frame');
    }
    if (root.stop.kind === 'call') {
      const wait = root.waiting;
      if (!wait || wait.frame !== root.frames.length - 1 || !root.frames.length || wait.to !== null && typeof wait.to !== 'string' || !wait.call || typeof wait.call.port !== 'string' || !Object.hasOwn(this.definition.schemas.ports, wait.call.port)) throw Error('Invalid card wait');
      const frame = root.frames[wait.frame]!, step = this.blocks[frame.block]![frame.index - 1];
      if (step?.kind !== 'request' || step.to !== wait.to || wait.call !== root.stop.call) throw Error('Invalid request continuation');
    } else if (root.waiting !== null || root.frames.length) throw Error('Invalid card terminal snapshot');
    this.admitState?.(root.state);
  }
}

/** A plain execution mode; ownership is trusted, exports still isolate graphs. */
export function plainCardStorage<T>(root: T, exporter?: <V>(value: V) => V): CardStorage<T> {
  const clone = <V>(value: V): V => {
    const seen = new Map<object, any>();
    const visit = (x: any): any => {
      if (x === null || typeof x !== 'object') return x;
      if (seen.has(x)) return seen.get(x);
      const out = Array.isArray(x) ? new Array(x.length) : Object.create(Object.getPrototypeOf(x)); seen.set(x, out);
      for (const key of Object.keys(x)) Object.defineProperty(out, key, { value: visit(x[key]), enumerable: true, configurable: true, writable: true });
      return out;
    };
    return visit(value);
  };
  let open = true;
  return {
    get root() { if (!open) throw Error('Closed card storage'); return root; },
    own: value => value, export: exporter ?? clone,
    close() { open = false; root = undefined as T; },
  };
}

export class CardMachine<S, Setup, P extends { [K in keyof P]: PortShape }, R> {
  private publications:unknown[]=[];
  /** Ephemeral declarations emitted by the original operations in the last
   * advance. They never execute instructions or contain an action history. */
  takeProbabilityPublications():unknown[]{const result=this.publications;this.publications=[];return result;}
  readonly program: CardProgram<S, Setup, P, R>;
  readonly storage: CardStorage<CardRoot<S>>;
  readonly trace: ((event: CardTrace) => void) | undefined;
  constructor(program: CardProgram<S, Setup, P, R>, storage: CardStorage<CardRoot<S>>, trace?: (event: CardTrace) => void) { this.program = program; this.storage = storage; this.trace = trace; }
  get root() { return this.storage.root; }
  advance(reply?: unknown): CardStop<P, R> {
    if (this.root.stop?.kind === 'chance') throw Error('A probability continuation requires its probability kernel');
    return this.advanceWithKernel(false,reply) as CardStop<P,R>;
  }
  /** The same interpreter, with suspension only at registered random/order
   * operations. This private search boundary is not a public Instance IO port. */
  advanceProbability(reply?: unknown): CardStop<P,R> | ProbabilityStop {
    return this.advanceWithKernel(true,reply);
  }
  /** Invoke only the pending operation's static sampler. This does not advance
   * any instruction or change the Context. Generated values are committed once
   * by the original atom after a child accepts its sample coordinate. */
  sampleProbability(source: ProbabilityEntropy): unknown {
    const root=this.root;
    if(root.stop?.kind!=='chance'||root.stop.space.kind!=='sampled')throw Error('No sampled probability operation');
    const frame=root.frames.at(-1)!,plan=executables.get(this.program)! as Executable<S>;
    const kernel=plan.blocks[frame.block]!.run[frame.index]!.probability;
    if(!kernel?.sample||!kernel.resolveSample)throw Error('Missing probability sampler');
    source.check();
    return kernel.sample({state:root.state,input:frame.input,locals:frame.locals},source);
  }
  partitionProbability(hint:unknown,maximum:number,source:ProbabilityEntropy):ProbabilityOutcomes|undefined {
    const root=this.root;if(root.stop?.kind!=='chance')throw Error('No current probability operation');
    if(!Number.isSafeInteger(maximum)||maximum<1||maximum>64)throw Error('Invalid probability partition capacity');
    const frame=root.frames.at(-1)!,plan=executables.get(this.program)! as Executable<S>;
    const kernel=plan.blocks[frame.block]!.run[frame.index]!.probability;
    source.check();const result=kernel?.partition?.({state:root.state,input:frame.input,locals:frame.locals},hint,maximum,source);source.check();
    if(result){
      if(!['exact','particles'].includes(result.representation)||!result.outcomes.length||result.outcomes.length>maximum||result.outcomes.some(row=>!Number.isFinite(row.probability)||row.probability<=0)||Math.abs(result.outcomes.reduce((sum,row)=>sum+row.probability,0)-1)>1e-12)throw Error('Invalid probability partition mass');
      for(const row of result.outcomes)validateCoordinate(root.stop.space,row.coordinate);
    }
    return result;
  }
  private advanceWithKernel(probability: boolean, reply?: unknown): CardStop<P,R> | ProbabilityStop {
    const root = this.root;
    let coordinate: ProbabilityCoordinate | undefined;
    if (root.stop?.kind === 'chance') {validateCoordinate(root.stop.space,reply); coordinate=reply;}
    if (root.stop?.kind === 'done' || root.stop?.kind === 'fault') return this.current();
    const publications:unknown[]=[];this.publications=[];
    let execution = new Execution(this.storage, executables.get(this.program)! as Executable<S>, this.trace, probability, coordinate,undefined,publications);
    try {
      if (root.waiting) {
        const wait = root.waiting, frame = execution.frames[wait.frame]!;
        if (wait.to !== null) frame.locals[wait.to] = this.storage.own(this.storage.export(reply));
      }
      for(;;){
        execution.run();
        if(!execution.forwardPending)break;
        // Publish the still-current, unexecuted marker before making COW
        // branches. Rebind cursors afterwards so temporary locals never alias
        // a graph page that was published and forked midway through a run.
        execution.publish();this.storage.boundary?.();
        const value=this.captureForward(execution.forwardPending);
        execution=new Execution(this.storage,executables.get(this.program)! as Executable<S>,this.trace,false,undefined,{value},publications);
      }
    } catch (error) {
      execution.waiting = null;
      execution.stop = { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: error instanceof Error ? error.message : String(error) } };
    }
    execution.publish();
    if(publications.length){
      const started=performance.now();
      try{this.publications=this.storage.export(publications);}
      finally{if(!probability)forwardProbabilityReceiver(this.storage)?.charge?.(performance.now()-started);}
    }
    this.storage.boundary?.();
    try { return root.stop?.kind === 'chance' ? this.storage.export(root.stop) as ProbabilityStop : this.current(); }
    catch (error) {
      root.waiting = null;
      root.stop = { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: error instanceof Error ? error.message : String(error) } };
      return this.current();
    }
  }
  private captureForward(pending:NonNullable<Execution<S>['forwardPending']>):ForwardProbabilityResult {
    const {kernel,plan,scope}=pending,started=performance.now();
    const basis=this.storage.export(kernel.project(scope));
    if(!Number.isSafeInteger(plan.maximum)||plan.maximum<1||plan.maximum>8||!Number.isFinite(plan.milliseconds)||plan.milliseconds<0||plan.milliseconds>2000||!plan.until)throw Error('Invalid forward probability budget');
    const owned=new Set<CardMachine<S,Setup,P,R>>(),queue:{machine:CardMachine<S,Setup,P,R>;probability:number}[]=[],leaves:typeof queue=[],outcomes:ForwardProbabilityResult['outcomes']=[];
    let random={...plan.random},nodes=0,advances=0,words=0,reason:string|null=null,representation:ForwardProbabilityResult['representation']='exact';
    class Limited extends Error {}
    const receiver=forwardProbabilityReceiver(this.storage);
    const check=(additionalNodes=0,additionalAdvances=0)=>{
      const milliseconds=performance.now()-started;
      if(milliseconds>=plan.milliseconds)reason='forward-wall-budget';
      else if(probabilityResidentBytes(this.storage)>=1024**3)reason='forward-memory-budget';
      else reason=receiver?.limit?.({milliseconds,nodes:nodes+additionalNodes,advances:advances+additionalAdvances,words})??null;
      if(reason)throw new Limited();
    };
    const entropy={check,word:()=>{check();const next=kernel.word(random);random=next.random;words++;return next.value;}};
    const execute=<T>(phase:'fork'|'advance'|'cleanup',operation:()=>T):T=>{
      if(phase!=='cleanup')check(Number(phase==='fork'),Number(phase==='advance'));
      if(phase==='fork'){if(nodes>=10000){reason='forward-node-budget';throw new Limited();}nodes++;}
      if(phase==='advance')advances++;
      return operation();
    };
    const fork=(parent:CardMachine<S,Setup,P,R>)=>{
      check(1);if(nodes>=10000){reason='forward-node-budget';throw new Limited();}
      const storage=forkProbabilityStorage(parent.storage);if(!storage){reason='forward-storage-unavailable';throw new Limited();}
      const child=new CardMachine(parent.program,storage);owned.add(child);nodes++;return child;
    };
    const advance=(machine:CardMachine<S,Setup,P,R>,coordinate:ProbabilityCoordinate)=>{check(0,1);advances++;machine.advanceProbability(coordinate);};
    try{
      const first=fork(this);advance(first,0n);queue.push({machine:first,probability:1});
      while(queue.length){
        check();const node=queue.shift()!,stop=node.machine.root.stop as CardStop<P,R>|ProbabilityStop;
        if(stop.kind==='fault')throw Error('Original forward probability execution failed: '+stop.error.message);
        if(stop.kind!=='chance'){reason='forward-scope-exited';throw new Limited();}
        if(stop.space.kind==='boundary'&&stop.space.name===plan.until){
          const value=node.machine.storage.export(kernel.project({state:node.machine.root.state,input:scope.input,locals:scope.locals}));
          outcomes.push({probability:node.probability,value});leaves.push(node);continue;
        }
        const choices=generateProbability(stop.space,plan.maximum-queue.length-outcomes.length,entropy,source=>execute('advance',()=>node.machine.sampleProbability(source)));
        if(choices.representation==='particles')representation='particles';
        for(const choice of choices.outcomes){const child=fork(node.machine);advance(child,choice.coordinate);queue.push({machine:child,probability:node.probability*choice.probability});}
        node.machine.storage.close?.();owned.delete(node.machine);
      }
      check();
      // The receiver runs while these are live successors of this very first
      // execution. Its continuation shares this generation's entropy/budget;
      // source leaves remain borrowed and are closed below on every outcome.
      receiver?.receive({representation,maximum:plan.maximum,outcomes:leaves.map(node=>({storage:node.machine.storage,probability:node.probability})),entropy,execute});
    }catch(error){if(!(error instanceof Limited))throw error;outcomes.length=0;}
    finally{for(const child of owned)child.storage.close?.();}
    const result={representation,basis,outcomes,random,reason,cost:{milliseconds:performance.now()-started,nodes,advances,words}};
    receiver?.complete?.(result);
    return result;
  }
  current(): CardStop<P, R> {
    if (this.root.stop?.kind === 'chance') throw Error('A probability continuation has no public IO stop');
    const stop = this.storage.export(this.root.stop);
    if (!this.program.definition.project || stop.kind === 'fault') return stop;
    const projected = this.program.definition.project(stop);
    if (!projected || projected.kind !== stop.kind || stop.kind === 'call' && (projected.kind !== 'call' || projected.call?.port !== stop.call.port)) throw Error('Projection changed execution boundary');
    return projected;
  }
}
