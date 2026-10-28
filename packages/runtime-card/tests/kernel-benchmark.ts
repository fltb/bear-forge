import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { CardMachine, CardProgram, linkRules, ruleModules, rules } from '@bear-forge/card-engine';
import type { CardRoot, CardStop } from '@bear-forge/card-engine';
import { portEffect } from '../../card-engine/src/rules-internal.ts';
import { stateOf } from '../../card-engine/src/rules-module-internal.ts';
import { privateCardGraph } from '../src/graph.ts';

/** Reproducible microbenchmarks of the production card executor and storage.
 *
 * From the repository root (Node 24):
 *   node packages/runtime-card/tests/kernel-benchmark.ts --case graph-pop
 *   node packages/runtime-card/tests/kernel-benchmark.ts --case checkpoint-chain --size 16,64,256
 *   node packages/runtime-card/tests/kernel-benchmark.ts --case event-capture --size 16,64,256,1024 --listeners 4 --events 16
 *   node packages/runtime-card/tests/kernel-benchmark.ts --case task-drain --size 64,256,1024
 *   node --cpu-prof packages/runtime-card/tests/kernel-benchmark.ts --case fx-query --size 16384 --samples 10
 *
 * Each iteration owns a new Context. Rule linking, Context construction,
 * listener installation, correctness checks and close are outside timing.
 * An ordinary ready IO boundary separates setup from the measured advance;
 * it is resumed directly, without replay, restore or a second executor.
 * Warmup runs are separate from samples. Compare revisions in separate,
 * alternating processes; do not run competing benchmarks concurrently.
 */

const names = ['graph-pop', 'graph-truncate', 'checkpoint-chain', 'event-capture', 'task-drain', 'fx-query', 'fx-record'] as const;
type CaseName = typeof names[number];
type Ports = { ready: { input: undefined; output: undefined } };
type Verification = { checksum: number; [key: string]: number };
type Evidence = Verification & { steps: number };
type Prepared = { run(): unknown; verify(result: unknown): Evidence; close(): void };
type Fixture = { stepUnit: string; workUnit: string; workUnits: number; prepare(): Prepared };
type Options = { cases: CaseName[]; sizes: number[] | undefined; iterations: number; samples: number; warmup: number; listeners: number; events: number };
const budget = 1_000_000_000;
const ready = portEffect<undefined, undefined>('ready');
const portSchemas = { ready: { input: z.undefined(), output: z.undefined() } };
const {
  defineRules, defineComponent, defineQuery, defineCheckpoint, defineEvent,
  defineEffect, sequence, whileDo, forEach, call, query, replace, install, on, emit, enqueue,
} = rules;

function integer(value: string, option: string, minimum = 1): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw Error(`${option} must be an integer >= ${minimum}`);
  return number;
}

function options(): Options | undefined {
  const { values } = parseArgs({ options: {
    case: { type: 'string', default: 'all' }, size: { type: 'string' },
    iterations: { type: 'string', default: '1' }, samples: { type: 'string', default: '5' },
    warmup: { type: 'string', default: '2' }, listeners: { type: 'string', default: '4' },
    events: { type: 'string', default: '16' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`Usage: node packages/runtime-card/tests/kernel-benchmark.ts [options]
  --case all|${names.join('|')}  (comma-separated selections also accepted)
  --size N[,N...]    Override each selected case's geometric sizes
  --iterations N    Fresh Contexts per timed sample (default 1)
  --samples N       Timed samples per size (default 5)
  --warmup N        Separate warmup batches per size (default 2; 0 allowed)
  --listeners N     Event-capture listeners (default 4; 0 allowed)
  --events N        Queued emissions per event-capture Context (default 16)
Each JSON line describes one case and size. Setup and verification are excluded.
event-capture measures capture/queueing, not subsequent handler dispatch.`);
    return undefined;
  }
  const selected = values.case === 'all' ? [...names] : values.case.split(',');
  for (const name of selected) if (!names.includes(name as CaseName)) throw Error(`Unknown case: ${name}`);
  return {
    cases: [...new Set(selected)] as CaseName[],
    sizes: values.size === undefined ? undefined : [...new Set(values.size.split(',').map(value => integer(value, '--size')))],
    iterations: integer(values.iterations, '--iterations'), samples: integer(values.samples, '--samples'),
    warmup: integer(values.warmup, '--warmup', 0), listeners: integer(values.listeners, '--listeners', 0),
    events: integer(values.events, '--events'),
  };
}

function prepareMachine<R>(program: CardProgram<{}, number, Ports, R>, size: number,
  verify: (result: R, root: CardRoot<{}>) => Verification): Prepared {
  const storage = privateCardGraph(program.initial(size, budget));
  const machine = new CardMachine(program, storage);
  try {
    assert.deepEqual(machine.advance(), { kind: 'call', call: { port: 'ready', input: undefined } });
  } catch (error) { storage.close(); throw error; }
  const before = machine.root.budget;
  return {
    run: () => machine.advance(undefined),
    verify(result) {
      const stop = result as CardStop<Ports, R>;
      assert.equal(stop.kind, 'done', JSON.stringify(stop));
      if (stop.kind !== 'done') throw Error('Benchmark did not finish');
      const checked = verify(stop.result, machine.root);
      return { ...checked, checksum: checked.checksum, steps: before - machine.root.budget };
    },
    close: () => storage.close(),
  };
}

function graphFixture(size: number, truncate: boolean): Fixture {
  return { stepUnit: 'array-mutation', workUnit: 'removed-element', workUnits: size,
    prepare() {
      const storage = privateCardGraph({ items: Array.from({ length: size }, (_, index) => index) });
      const items = storage.root.items;
      return {
        run() {
          let checksum = 0;
          if (truncate) {
            for (let length = size - 1; length >= 0; length--) {
              checksum += items[length]!;
              items.length = length;
            }
          } else {
            while (items.length) checksum += items.pop()!;
          }
          return checksum;
        },
        verify(result) {
          assert.equal(result, size * (size - 1) / 2);
          assert.equal(items.length, 0);
          assert.equal(Object.keys(items).length, 0);
          return { steps: size, checksum: result as number, removedElements: size };
        },
        close: () => storage.close(),
      };
    },
  };
}

function checkpointFixture(size: number): Fixture {
  const module = defineRules({ requires: [], build(m) {
    const checkpoint = m.own(defineCheckpoint({ input: z.number(), output: z.number() }));
    const resolve = defineEffect<number, rules.ReplacementResult<number>>(b => {
      const result = b.local<rules.ReplacementResult<number>>();
      return sequence(b.assign(result, m.resolve(checkpoint, b.input)), b.return(result));
    });
    return { exports: { checkpoint: checkpoint.public, resolve } };
  } });
  const increment = defineEffect<rules.ReplacementContext<number>, rules.ReplacementResult<number>>(b =>
    b.return({ kind: 'change', value: b.read(view => view.input.value + 1) }));
  const ability = replace(module.exports.checkpoint, { effect: increment });
  const entry = defineEffect<number, rules.ReplacementResult<number>>(b => {
    const result = b.local<rules.ReplacementResult<number>>();
    return sequence(
      forEach(b.read(view => Array.from({ length: view.input }, (_, index) => index)), () =>
        install({ source: 0, owner: 0, ability, environment: {}, lifetime: 0 })),
      call(ready, undefined),
      b.assign(result, call(module.exports.resolve, 0)), b.return(result),
    );
  });
  const program = new CardProgram(linkRules<{}, number, Ports, rules.ReplacementResult<number>>({
    id: 'kernel-benchmark-checkpoint', schemas: { setup: z.number(), result: z.custom<rules.ReplacementResult<number>>(), ports: portSchemas },
    initialize: () => ({}), entry, definitions: [entry, ready, increment], modules: [module], initialEntities: [0],
  }));
  return { stepUnit: 'card-instruction', workUnit: 'replacement', workUnits: size,
    prepare: () => prepareMachine(program, size, result => {
      assert.deepEqual(result, { kind: 'change', value: size });
      return { checksum: size, appliedReplacements: size };
    }),
  };
}

type Environment = { rows: { value: number; tag: string }[] };
function eventFixture(size: number, listeners: number, events: number): Fixture {
  const module = defineRules({ requires: [], build(m) {
    const event = m.own(defineEvent({ payload: z.number(), dispatch: 'queued', publicEmit: true }));
    return { exports: { event: event.public } };
  } });
  const listener = defineEffect<rules.ReactionContext<number, Environment>, void>(b => b.return(undefined));
  const ability = on(module.exports.event, { effect: listener, eligible: 'captured' });
  const entry = defineEffect<number, number>(b => {
    const cursor = b.local<number>();
    return sequence(
      forEach(Array.from({ length: listeners }, (_, index) => index), () => install({
        source: 0, owner: 0, ability, lifetime: 0,
        environment: b.read(view => ({ rows: Array.from({ length: view.input }, (_, index) => ({ value: index, tag: 'environment' })) })),
      })),
      b.assign(cursor, 0), call(ready, undefined),
      whileDo(b.read(view => view.get(cursor) < events), sequence(
        emit(module.exports.event, cursor), b.assign(cursor, b.read(view => view.get(cursor) + 1)),
      )), b.return(cursor),
    );
  });
  const program = new CardProgram(linkRules<{}, number, Ports, number>({
    id: 'kernel-benchmark-event-capture', schemas: { setup: z.number(), result: z.number(), ports: portSchemas },
    initialize: () => ({}), entry, definitions: [entry, ready, listener], modules: [module], initialEntities: [0],
  }));
  return { stepUnit: 'card-instruction', workUnit: 'queued-event', workUnits: events,
    prepare: () => prepareMachine(program, size, (result, root) => {
      assert.equal(result, events);
      const state = stateOf(root.state), envelopes = Object.values(state.outbox);
      assert.equal(state.eventQueues.queued.size, events);
      assert.equal(envelopes.length, events);
      let checksum = 0;
      for (let event = 0; event < envelopes.length; event++) {
        const envelope = envelopes[event]!;
        assert.equal(envelope.payload, event);
        assert.equal(envelope.handlers.length, listeners);
        for (const { registration } of envelope.handlers) {
          const environment = registration.environment as Environment;
          assert.equal(environment.rows.length, size);
          let total = 0;
          for (const row of environment.rows) { total += row.value; assert.equal(row.tag, 'environment'); }
          assert.equal(total, size * (size - 1) / 2);
          checksum += total;
        }
      }
      return { checksum, queuedEvents: events, capturedHandlers: events * listeners, environmentRows: size };
    }),
  };
}

function queryFixture(size: number): Fixture {
  const module = defineRules({ requires: [], build(m) {
    const offset = m.own(defineComponent({ schema: z.number(), initial: () => 1 }));
    const add = defineQuery({ input: z.number(), output: z.number(), reads: [offset],
      base: (reader, value) => value + reader.component(0, offset) });
    return { exports: { add } };
  } });
  const leaf = defineEffect<number, number>(b => b.return(query(module.exports.add, b.input)));
  const entry = defineEffect<number, number>(b => {
    const cursor = b.local<number>(), total = b.local<number>(), value = b.local<number>();
    return sequence(
      b.assign(cursor, 0), b.assign(total, 0), call(ready, undefined),
      whileDo(b.read(view => view.get(cursor) < view.input), sequence(
        b.assign(value, call(leaf, cursor)),
        b.assign(total, b.read(view => view.get(total) + view.get(value))),
        b.assign(cursor, b.read(view => view.get(cursor) + 1)),
      )), b.return(total),
    );
  });
  const program = new CardProgram(linkRules<{}, number, Ports, number>({
    id: 'kernel-benchmark-fx-query', schemas: { setup: z.number(), result: z.number(), ports: portSchemas },
    initialize: () => ({}), entry, definitions: [entry, ready, leaf], modules: [module], initialEntities: [0],
  }));
  return { stepUnit: 'card-instruction', workUnit: 'fx-query-call', workUnits: size,
    prepare: () => prepareMachine(program, size, result => {
      assert.equal(result, size * (size + 1) / 2);
      return { checksum: result, fxCalls: size, queryCalls: size };
    }),
  };
}

function taskFixture(size: number): Fixture {
  const queue = Object.freeze({ label: 'kernel-benchmark-tasks' });
  type Summary = { count: number; sum: number; inOrder: boolean };
  const summarySchema = z.object({ count: z.number(), sum: z.number(), inOrder: z.boolean() });
  const module = defineRules({ requires: [], build(m) {
    const summary = m.own(defineComponent({ schema: summarySchema, initial: (): Summary => ({ count: 0, sum: 0, inOrder: true }) }));
    // A constant-size production atom records order and progress. Appending to
    // a copied log array here would add an unrelated quadratic workload.
    const record = m.atom({ input: z.number(), output: z.undefined(), reads: [summary], writes: [summary], emits: [],
      run(reader, value) {
        const previous = reader.component(0, summary);
        return { writes: [{ entity: 0, component: summary, value: {
          count: previous.count + 1, sum: previous.sum + value,
          inOrder: previous.inOrder && value === previous.count,
        } }], events: [], result: undefined };
      },
    });
    const current = defineQuery({ input: z.undefined(), output: summarySchema, reads: [summary], base: reader => reader.component(0, summary) });
    return { exports: { record, current } };
  } });
  const entry = defineEffect<number, Summary>(b => sequence(
    forEach(b.read(view => Array.from({ length: view.input }, (_, index) => index)), item =>
      enqueue(module.exports.record, item, { queue, source: 0, lifetime: 0, eligible: 'captured' })),
    call(ready, undefined), ruleModules.drainQueue(queue), b.return(query(module.exports.current, undefined)),
  ));
  const program = new CardProgram(linkRules<{}, number, Ports, Summary>({
    id: 'kernel-benchmark-task-drain', schemas: { setup: z.number(), result: summarySchema, ports: portSchemas },
    initialize: () => ({}), entry, definitions: [entry, ready], modules: [module], initialEntities: [0],
  }));
  return { stepUnit: 'card-instruction', workUnit: 'drained-task', workUnits: size,
    prepare: () => prepareMachine(program, size, (result, root) => {
      assert.deepEqual(result, { count: size, sum: size * (size - 1) / 2, inOrder: true });
      const state = stateOf(root.state);
      assert.equal(Object.keys(state.tasks).length, 0);
      assert.equal(state.sources.length, 0);
      for (const bucket of [state.indexes.tasksByScope, state.indexes.tasksBySource, state.indexes.tasksByEvent])
        assert.equal(Object.keys(bucket).length, 0);
      for (const pending of Object.values(state.queues)) {
        assert.equal(pending.size, 0); assert.equal(pending.first, null); assert.equal(pending.last, null);
        assert.equal(Object.keys(pending.links).length, 0);
      }
      return { checksum: result.sum, drainedTasks: result.count, orderedTasks: result.inOrder ? size : 0, remainingTasks: 0 };
    }),
  };
}

function recordFixture(size: number): Fixture {
  type Input = { left: number; right: number; tag: string };
  type Output = { value: number; tag: string };
  const inputSchema = z.object({ left: z.number(), right: z.number(), tag: z.string() });
  const outputSchema = z.object({ value: z.number(), tag: z.string() });
  const module = defineRules({ requires: [], build() {
    const add = defineQuery({ input: inputSchema, output: outputSchema,
      base: (_reader, value) => ({ value: value.left + value.right, tag: value.tag }) });
    return { exports: { add } };
  } });
  const leaf = defineEffect<Input, Output>(b => b.return(query(module.exports.add, b.input)));
  const entry = defineEffect<number, number>(b => {
    const cursor = b.local<number>(), total = b.local<number>(), value = b.local<Output>();
    return sequence(
      b.assign(cursor, 0), b.assign(total, 0), call(ready, undefined),
      whileDo(b.read(view => view.get(cursor) < view.input), sequence(
        b.assign(value, call(leaf, { left: cursor, right: 1, tag: 'owned-record' })),
        b.assign(total, b.read(view => view.get(total) + view.get(value).value)),
        b.assign(cursor, b.read(view => view.get(cursor) + 1)),
      )), b.return(total),
    );
  });
  const program = new CardProgram(linkRules<{}, number, Ports, number>({
    id: 'kernel-benchmark-fx-record', schemas: { setup: z.number(), result: z.number(), ports: portSchemas },
    initialize: () => ({}), entry, definitions: [entry, ready, leaf], modules: [module], initialEntities: [0],
  }));
  return { stepUnit: 'card-instruction', workUnit: 'record-query-call', workUnits: size,
    prepare: () => prepareMachine(program, size, result => {
      assert.equal(result, size * (size + 1) / 2);
      return { checksum: result, fxCalls: size, queryCalls: size };
    }),
  };
}

function createFixture(name: CaseName, size: number, config: Options): Fixture {
  switch (name) {
    case 'graph-pop': return graphFixture(size, false);
    case 'graph-truncate': return graphFixture(size, true);
    case 'checkpoint-chain': return checkpointFixture(size);
    case 'event-capture': return eventFixture(size, config.listeners, config.events);
    case 'task-drain': return taskFixture(size);
    case 'fx-query': return queryFixture(size);
    case 'fx-record': return recordFixture(size);
  }
}

function batch(fixture: Fixture, iterations: number): { elapsedMs: number; evidence: Evidence } {
  const prepared: Prepared[] = [], results = new Array<unknown>(iterations);
  try {
    for (let index = 0; index < iterations; index++) prepared.push(fixture.prepare());
    const start = performance.now();
    for (let index = 0; index < iterations; index++) results[index] = prepared[index]!.run();
    const elapsedMs = performance.now() - start;
    const evidence = prepared[0]!.verify(results[0]);
    for (let index = 1; index < iterations; index++) assert.deepEqual(prepared[index]!.verify(results[index]), evidence);
    return { elapsedMs, evidence };
  } finally { for (const current of prepared) current.close(); }
}

function run(config: Options): void {
  for (const name of config.cases) {
    const sizes = config.sizes ?? (name === 'checkpoint-chain' ? [16, 64, 256]
      : name === 'task-drain' ? [64, 256, 1024]
      : name === 'event-capture' ? [16, 64, 256, 1024] : [256, 1024, 4096, 16384]);
    for (const size of sizes) {
      const fixture = createFixture(name, size, config);
      let evidence: Evidence | undefined;
      for (let index = 0; index < config.warmup; index++) evidence = batch(fixture, config.iterations).evidence;
      const samplesMs: number[] = [];
      for (let index = 0; index < config.samples; index++) {
        const sample = batch(fixture, config.iterations);
        if (evidence) assert.deepEqual(sample.evidence, evidence);
        evidence = sample.evidence;
        samplesMs.push(sample.elapsedMs / config.iterations);
      }
      const sorted = [...samplesMs].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
      const medianMs = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
      console.log(JSON.stringify({
        benchmark: 'card-kernel', case: name, size, node: process.version, v8: process.versions.v8,
        platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
        warmupBatches: config.warmup, samples: config.samples, iterationsPerSample: config.iterations,
        timedPhase: 'execute-only', setupIncluded: false, verificationIncluded: false,
        ...(name === 'event-capture' ? { listeners: config.listeners, events: config.events, handlerDispatchIncluded: false } : {}),
        ...(name === 'task-drain' ? { scheduling: 'enqueue-before-timing', drain: 'production-drainQueue', taskBody: 'constant-size-order-summary-atom' } : {}),
        medianMs, meanMs: samplesMs.reduce((sum, value) => sum + value, 0) / samplesMs.length,
        minMs: sorted[0], maxMs: sorted.at(-1), p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
        workUnit: fixture.workUnit, workUnits: fixture.workUnits, medianNsPerUnit: medianMs * 1e6 / fixture.workUnits,
        stepUnit: fixture.stepUnit, evidence, samplesMs,
      }));
    }
  }
}

const config = options();
if (config) run(config);
