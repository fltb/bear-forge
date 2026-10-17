import type { PortShape } from '@bear-forge/contracts/core';
import type { CardDefinition, CardEffect, CardExpression, CardFrame, CardRoot, CardScope, CardStep, CardStop, CardStorage, CardTrace } from './card.types.ts';

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
  constructor(definition: CardDefinition<S, Setup, P, R>) {
    if (definition.project !== undefined && typeof definition.project !== 'function') throw Error('Invalid card projection');
    this.definition = Object.freeze({ ...definition, effects: Object.freeze([...definition.effects]) });
    const blocks: (readonly CardStep<S>[])[] = [], names: string[] = [];
    const active = new Set<readonly CardStep<S>[]>();
    const register = (steps: readonly CardStep<S>[], name: string): number => {
      if (!Array.isArray(steps) || active.has(steps)) throw Error('Invalid or cyclic structural block');
      active.add(steps);
      const own = steps.map(step => ({ ...step })) as CardStep<S>[];
      const index = blocks.length; blocks.push(own); names.push(name);
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
  readonly program: CardProgram<S, Setup, P, R>;
  readonly storage: CardStorage<CardRoot<S>>;
  readonly trace: ((event: CardTrace) => void) | undefined;
  constructor(program: CardProgram<S, Setup, P, R>, storage: CardStorage<CardRoot<S>>, trace?: (event: CardTrace) => void) { this.program = program; this.storage = storage; this.trace = trace; }
  get root() { return this.storage.root; }
  private scope(frame: CardFrame): CardScope<S> { return { state: this.root.state, input: frame.input, locals: frame.locals }; }
  private push(block: number, parent: CardFrame, input = parent.input, local = parent.locals, call = parent.call, target: string | null = null): void {
    this.root.frames.push({ block, index: 0, input, locals: local, call, target, items: null, item: 0 });
  }
  private finish(value: any, call: number): void {
    const frames = this.root.frames;
    let target: string | null = null;
    while (frames.length && frames.at(-1)!.call === call) target = frames.pop()!.target ?? target;
    if (!frames.length) this.root.stop = { kind: 'done', result: value };
    else if (target !== null) frames.at(-1)!.locals[target] = value;
  }
  advance(reply?: unknown): CardStop<P, R> {
    if (this.root.stop?.kind === 'done' || this.root.stop?.kind === 'fault') return this.current();
    try {
      if (this.root.waiting) {
        const wait = this.root.waiting, frame = this.root.frames[wait.frame];
        if (!frame) throw Error('Missing waiting frame');
        if (wait.to !== null) frame.locals[wait.to] = this.storage.own(this.storage.export(reply));
        this.root.waiting = null; this.root.stop = null;
      }
      while (!this.root.stop) {
        const frame = this.root.frames.at(-1);
        if (!frame) { this.root.stop = { kind: 'done', result: undefined }; break; }
        const block = this.program.blocks[frame.block];
        if (!block || frame.index < 0 || frame.index > block.length) throw Error('Invalid execution position');
        if (frame.index === block.length) {
          this.root.frames.pop();
          if (!this.root.frames.length || this.root.frames.at(-1)!.call !== frame.call) {
            if (frame.target !== null && this.root.frames.length) this.root.frames.at(-1)!.locals[frame.target] = undefined;
          }
          continue;
        }
        if (this.root.budget !== Infinity && this.root.budget-- <= 0) { this.root.stop = { kind: 'fault', error: { kind: 'fault', code: 'budget_exceeded', message: 'Card step budget exceeded' } }; break; }
        const step = block[frame.index]!;
        this.trace?.({ effect: this.program.names[frame.block]!, block: frame.block, index: frame.index, kind: step.kind, depth: this.root.frames.length });
        const scope = this.scope(frame);
        switch (step.kind) {
          case 'operation': {
            const value = step.run(scope);
            if (value && typeof value.then === 'function') throw Error('Card operation must be synchronous');
            if (step.to !== null) frame.locals[step.to] = value;
            frame.index++; break;
          }
          case 'invoke': {
            const name = typeof step.effect === 'string' ? step.effect : step.effect(scope);
            const block = this.program.effects.get(name); if (block === undefined) throw Error('Unknown effect: ' + name);
            const input = this.storage.own(step.input(scope)); frame.index++;
            this.push(block, frame, input, Object.create(null), this.root.nextCall++, step.to); break;
          }
          case 'branch': {
            const selected = step.test(scope); if (typeof selected !== 'boolean') throw Error('Card condition must be synchronous boolean');
            const block = this.program.children.get(step)![selected ? 0 : 1]!;
            frame.index++; this.push(block, frame); break;
          }
          case 'repeat': {
            const selected = step.test(scope); if (typeof selected !== 'boolean') throw Error('Card condition must be synchronous boolean');
            if (selected) this.push(this.program.children.get(step)![0]!, frame);
            else frame.index++;
            break;
          }
          case 'each':
            if (frame.items === null) { const items = step.items(scope); if (!Array.isArray(items)) throw Error('Iteration requires a finite array'); frame.items = [...items]; frame.item = 0; }
            if (frame.item === frame.items.length) { frame.items = null; frame.index++; }
            else this.push(this.program.effects.get(step.effect)!, frame, frame.items[frame.item++], Object.create(null), this.root.nextCall++);
            break;
          case 'request': {
            const call = step.call(scope); frame.index++;
            // The machine is stopped until reply. Internal aliases are safe;
            // export isolates the host. Copying the world here would register
            // an entire second game graph at every decision.
            const detached = this.storage.own(call);
            this.root.waiting = { frame: this.root.frames.length - 1, to: step.to, call: detached };
            this.root.stop = { kind: 'call', call: detached }; break;
          }
          case 'return': this.finish(step.value(scope), frame.call); break;
        }
      }
    } catch (error) {
      this.root.waiting = null;
      this.root.stop = { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: error instanceof Error ? error.message : String(error) } };
    }
    this.storage.boundary?.();
    try { return this.current(); }
    catch (error) {
      this.root.waiting = null;
      this.root.stop = { kind: 'fault', error: { kind: 'fault', code: 'program_failed', message: error instanceof Error ? error.message : String(error) } };
      return this.current();
    }
  }
  current(): CardStop<P, R> {
    const stop = this.storage.export(this.root.stop);
    if (!this.program.definition.project || stop.kind === 'fault') return stop;
    const projected = this.program.definition.project(stop);
    if (!projected || projected.kind !== stop.kind || stop.kind === 'call' && (projected.kind !== 'call' || projected.call?.port !== stop.call.port)) throw Error('Projection changed execution boundary');
    return projected;
  }
}
