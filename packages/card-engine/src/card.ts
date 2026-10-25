import {probabilityOperationFor,type ProbabilityOperation,type ProbabilityStop,type ProbabilityCoordinate} from './probability.ts';
import {temporaryLocalsFor} from './card-execution-hints.ts';
import {inheritRuleReplyGuards} from './rules-reply-guards.ts';
import type { PortShape } from '@bear-forge/contracts/core';
import type { CardDefinition, CardEffect, CardExpression, CardFrame, CardRoot, CardScope, CardStep, CardStop, CardStorage, CardTrace } from './card.types.ts';
import { traceWriterFor } from './card-trace.ts';
import type { TraceWriter } from './card-trace.ts';
import {cardAdmissionFor,inCardValueContext,cardValueEpoch,inheritCardDefinition} from './card-admission.ts';
import type {ProbabilityYield} from './probability.ts';

type Frame<S> = CardFrame & { scope: CardScope<S> };
type Instruction<S> = ((execution: Execution<S>, frame: Frame<S>) => void) & {probability?: ProbabilityOperation<S>};
type Block<S> = { run: readonly Instruction<S>[]; trace: readonly Omit<CardTrace, 'depth'>[] };
type Executable<S> = { temporaryLocals:ReadonlyMap<number,(state:unknown)=>boolean>; blocks: readonly Block<S>[]; effects: ReadonlyMap<string, number> };
const executables = new WeakMap<object, unknown>();
const scheduledChecks=new WeakMap<object,(root:unknown)=>void>();
const contextIdentityEpochs=new WeakMap<object,number>();
/** Objects already available when Program is bound may be held by its code.
 * Never serialize this process-local epoch; snapshots retain relative roles. */
export function ruleContextIdentityEpoch(program:object):number{const epoch=contextIdentityEpochs.get(program);if(epoch===undefined)throw Error('Unknown Context identity Program');return epoch;}
/** Private persistence of renewable ORIGINAL execution. It shares the frame
 * validator, but must never accept a pending probability replacement. */
export function validateScheduledContext<S,Setup,P extends {[K in keyof P]:PortShape},R>(program:CardProgram<S,Setup,P,R>,root:CardRoot<S>):void{
  if(!root||!['call','done','yield'].includes(root.stop?.kind))throw Error('Invalid original execution Context');
  const check=scheduledChecks.get(program);if(!check)throw Error('Unknown original Program');check(root);
}

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
  readonly instructionQuantum:number|undefined;
  coordinate: ProbabilityCoordinate | undefined;
  readonly publications:unknown[];
  constructor(storage: CardStorage<CardRoot<S>>, plan: Executable<S>, observe: ((event: CardTrace) => void) | undefined, probability = false, coordinate?: ProbabilityCoordinate, publications:unknown[] = [],instructionQuantum?:number) {
    this.storage=storage;this.plan=plan;this.observe=observe;this.probability=probability;this.coordinate=coordinate;this.publications=publications;
    const root = storage.root;
    this.writeTrace = traceWriterFor(observe);
    this.instructionQuantum=instructionQuantum;
    this.budget = instructionQuantum??root.budget; this.nextCall = root.nextCall;
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
        if (this.probability && instruction.probability && this.coordinate === undefined) {
          // Suspend BEFORE executing the operation, charging or tracing it.
          // All previous instructions remain committed in this exact Context.
          const space = instruction.probability.space(frame.scope);
          this.stop = {kind:'chance',space};
          break;
        }
        if (this.budget !== Infinity && this.budget <= 0) {
          this.stop = this.instructionQuantum!==undefined?{kind:'yield'}:
            { kind: 'fault', error: { kind: 'fault', code: 'budget_exceeded', message: 'Card step budget exceeded' } }; break;
        }
        if(this.budget!==Infinity)this.budget--;
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
    if(this.instructionQuantum===undefined&&this.budget!==Infinity)root.budget = this.budget;
    root.waiting = this.waiting; root.stop = this.stop;
  }
}

function compileInstruction<S>(step: CardStep<S>, children: readonly number[] | undefined, effects: ReadonlyMap<string, number>): Instruction<S> {
  switch (step.kind) {
    case 'operation': {
      const kernel = probabilityOperationFor(step.run);
      const instruction: Instruction<S> = (execution, frame) => {
      const coordinate = execution.coordinate;
      const value=execution.probability&&kernel?kernel.resolve(frame.scope,coordinate!):step.run(frame.scope);
      if (execution.probability && kernel) execution.coordinate = undefined;
      if(kernel?.publication){
        const publication=kernel.publication(frame.scope,value);
        if(publication!==undefined)execution.publications.push(publication);
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
    contextIdentityEpochs.set(this,cardValueEpoch());
    this.admitState=cardAdmissionFor(definition);
    if (definition.project !== undefined && typeof definition.project !== 'function') throw Error('Invalid card projection');
    this.definition = Object.freeze({ ...definition, effects: Object.freeze([...definition.effects]) });
    inheritRuleReplyGuards(definition.effects,this.definition.effects);
    inheritCardDefinition(definition,this.definition);
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
    scheduledChecks.set(this,root=>this.validateContext(root as CardRoot<S>,true));
  }
  initial(setup: Setup, budget = Number.MAX_SAFE_INTEGER): CardRoot<S> {
    return { state: inCardValueContext(()=>this.definition.initialize(setup)), frames: [{ block: this.effects.get(this.definition.entry)!, index: 0, input: setup, locals: Object.create(null), call: 0, target: null, items: null, item: 0 }], nextCall: 1, waiting: null, stop: null, budget };
  }
  validate(root: CardRoot<S>): void {
    this.validateContext(root,false);
  }
  private validateContext(root:CardRoot<S>,scheduled:boolean):void{
    if (!root || !Array.isArray(root.frames) || !Number.isSafeInteger(root.nextCall) || root.nextCall < 1 || !Number.isSafeInteger(root.budget) || root.budget < 0 || !root.stop || !(scheduled?['call','done','yield']:['call','done']).includes(root.stop.kind)) throw Error('Invalid card snapshot root');
    for (const frame of root.frames) {
      const block = this.blocks[frame.block];
      if (!block || !Number.isInteger(frame.index) || frame.index < 0 || frame.index > block.length || !Number.isSafeInteger(frame.call) || frame.call < 0 || frame.call >= root.nextCall || !frame.locals || typeof frame.locals !== 'object' || Array.isArray(frame.locals) || frame.target !== null && typeof frame.target !== 'string' || frame.items !== null && !Array.isArray(frame.items) || !Number.isSafeInteger(frame.item) || frame.item < 0 || frame.items && frame.item > frame.items.length) throw Error('Invalid card frame');
    }
    if (root.stop.kind === 'call') {
      const wait = root.waiting;
      if (!wait || wait.frame !== root.frames.length - 1 || !root.frames.length || wait.to !== null && typeof wait.to !== 'string' || !wait.call || typeof wait.call.port !== 'string' || !Object.hasOwn(this.definition.schemas.ports, wait.call.port)) throw Error('Invalid card wait');
      const frame = root.frames[wait.frame]!, step = this.blocks[frame.block]![frame.index - 1];
      if (step?.kind !== 'request' || step.to !== wait.to || wait.call !== root.stop.call) throw Error('Invalid request continuation');
    } else if(root.stop.kind==='yield'){
      if(root.waiting!==null||!root.frames.length)throw Error('Invalid yielded probability Context');
      const frame=root.frames.at(-1)!,plan=executables.get(this)! as Executable<S>,instruction=plan.blocks[frame.block]!.run[frame.index];
      // Original execution may yield before any instruction, including RNG.
      if(!instruction)throw Error('Yield is not before an unexecuted instruction of this kernel');
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
    if (this.root.stop?.kind === 'chance'||this.root.stop?.kind==='yield') throw Error('A probability continuation requires its probability kernel');
    return this.advanceWithKernel(false,reply) as CardStop<P,R>;
  }
  /** Host scheduling of the REAL execution. This uses original operations,
   * including their original RNG, and never enters the probability kernel.
   * The host retains this current between slices and exposes only normal IO. */
  advanceScheduled(reply?:unknown,instructions=4096,committed?:()=>void):CardStop<P,R>|ProbabilityYield{
    if(!Number.isSafeInteger(instructions)||instructions<1)throw Error('Invalid instruction slice');
    if(this.root.stop?.kind==='chance')throw Error('A probability continuation requires its probability kernel');
    if(this.root.stop?.kind==='yield'&&reply!==undefined)throw Error('A scheduling continuation takes no reply');
    return this.advanceWithKernel(false,reply,committed,instructions) as CardStop<P,R>|ProbabilityYield;
  }
  /** The same interpreter, with suspension only at registered random/order
   * operations. This private search boundary is not a public Instance IO port. */
  advanceProbability(reply?: unknown,committed?:()=>void): CardStop<P,R> | ProbabilityStop {
    return this.advanceWithKernel(true,reply,committed) as CardStop<P,R>|ProbabilityStop;
  }
  /** The original interpreter with a renewable instruction slice. A slice
   * never changes rule state, the original budget, probability or terminal value. */
  advanceExactProbability(reply?:unknown,committed?:()=>void,instructions=4096):CardStop<P,R>|ProbabilityStop|ProbabilityYield{
    return this.advanceWithKernel(true,reply,committed,instructions);
  }
  /** Read the pending marker's original input without consuming its edge.
   * The input is retained in the current frame and restored with that frame. */
  probabilityBoundaryValue():unknown {
    const root=this.root;
    const frame=root.frames.at(-1)!,plan=executables.get(this.program)! as Executable<S>;
    const kernel=plan.blocks[frame.block]!.run[frame.index]!.probability!;
    // Storage may share private publication leaves across reads. This method
    // hands the projection to search callers, which must not mutate that cache.
    return structuredClone(this.storage.export(kernel.boundaryValue!({state:root.state,input:frame.input,locals:frame.locals})));
  }
  /** No original operation is executed. Root returns are observable, and a
   * stored caller result is conservatively observable even if later unused. */
  probabilityCoordinatesEquivalent():boolean{
    const root=this.root;
    if(root.stop?.kind!=='chance'||root.frames.length<2)return false;
    const frame=root.frames.at(-1)!;
    if(frame.target!==null)return false;
    const plan=executables.get(this.program)! as Executable<S>;
    return plan.blocks[frame.block]!.run[frame.index]?.probability?.discardedReturnEquivalent===true;
  }
  private advanceWithKernel(probability: boolean, reply?: unknown,committed?:()=>void,instructions?:number): CardStop<P,R> | ProbabilityStop | ProbabilityYield {
    const root = this.root;
    let coordinate: ProbabilityCoordinate | undefined;
    if (root.stop?.kind === 'chance') {
      if(root.stop.space.kind==='unavailable')throw Error('Unavailable probability space has no valid coordinate: '+root.stop.space.reason);
      coordinate=reply as ProbabilityCoordinate;
    }
    if (root.stop?.kind === 'done' || root.stop?.kind === 'fault') return this.current();
    const publications:unknown[]=[];this.publications=[];
    const execution = new Execution(this.storage, executables.get(this.program)! as Executable<S>, this.trace, probability, coordinate,publications,instructions);
    try {
      if (root.waiting) {
        const wait = root.waiting, frame = execution.frames[wait.frame]!;
        if (wait.to !== null) frame.locals[wait.to] = this.storage.own(this.storage.export(reply));
      }
      inCardValueContext(()=>execution.run());
    } catch (error) {
      execution.waiting = null;
      execution.stop = { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: error instanceof Error ? error.message : String(error) } };
    }
    execution.publish();
    // Search owns a resumable edge. Record consumption at the actual commit,
    // before publication export or boundary collection can throw.
    committed?.();
    if(publications.length)this.publications=this.storage.export(publications);
    this.storage.boundary?.();
    try { return root.stop?.kind === 'chance'||root.stop?.kind==='yield' ? this.storage.export(root.stop) as ProbabilityStop|ProbabilityYield : this.current(); }
    catch (error) {
      // The original continuation has already committed. Search must retain
      // that exact boundary if exporting/projecting it fails; replacing it
      // with a fault would destroy the successor and its remaining space.
      if(probability||instructions!==undefined)throw error;
      root.waiting = null;
      root.stop = { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: error instanceof Error ? error.message : String(error) } };
      return this.current();
    }
  }
  current(): CardStop<P, R> {
    if (this.root.stop?.kind === 'chance'||this.root.stop?.kind==='yield') throw Error('A probability continuation has no public IO stop');
    const stop = this.storage.export(this.root.stop);
    if (!this.program.definition.project || stop.kind === 'fault') return stop;
    const projected = this.program.definition.project(stop);
    if (!projected || projected.kind !== stop.kind || stop.kind === 'call' && (projected.kind !== 'call' || projected.call?.port !== stop.call.port)) throw Error('Projection changed execution boundary');
    return projected;
  }
}
