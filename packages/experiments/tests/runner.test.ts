import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExperimentRunner } from '../src/runner.ts';
import { ExperimentFiles } from '../src/files.ts';
import { createHash } from 'node:crypto';

test('frozen implementation identity compares boundary data, not property order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-identity-'));
  const files = new ExperimentFiles<{ id: string }>(directory, value => value);
  await files.register({ id: 'sample', engine: 'native', maxAttempts: 1, maxSteps: 1 }, []);
  let identity: unknown = { sourceDigest: 'fixed', metadata: { a: 1, b: -0 } };
  const runner = createExperimentRunner({
    module: null as any,
    parseRegistration: (value: unknown) => value as any,
    tasks: () => [],
    setup: () => { throw Error('No task expected'); },
    policies: () => { throw Error('No task expected'); },
    facts: () => [],
    summarize: (value: any) => ({ id: value.id }),
    identity: async () => identity,
    artifacts: { native: 'unused', controlled: 'unused' }
  });
  assert.deepEqual((await runner.runExperiment(directory)).results, []);
  const frozen: any = await files.read('implementation');
  assert.equal(frozen.runtime.versions.v8, process.versions.v8);
  assert.equal(frozen.runtime.platform, process.platform);
  identity = { metadata: { b: -0, a: 1 }, sourceDigest: 'fixed' };
  assert.deepEqual((await runner.runExperiment(directory)).results, []);
  identity = { metadata: { b: 0, a: 1 }, sourceDigest: 'fixed' };
  await assert.rejects(() => runner.runExperiment(directory), /Registered production code or dependency version changed/);
  identity = { metadata: { b: -0, a: 1 }, sourceDigest: 'fixed' };
  frozen.runtime.versions.v8 = 'different-v8';
  await files.write('implementation', frozen);
  await assert.rejects(() => runner.runExperiment(directory), /Experiment runtime version changed/);
});

test('experiment rejects a changed frozen executable artifact before scheduling tasks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bear-artifact-'));
  try {
    const native = join(directory, 'native.json'), controlled = join(directory, 'controlled.bin'), source = join(directory, 'source.mts');
    await writeFile(source, 'original');
    const sourceFiles = [[source, createHash('sha256').update('original').digest('hex')]];
    await writeFile(native, JSON.stringify({ code: 'original', exportName: 'program', sourceFiles }));
    await writeFile(controlled, JSON.stringify({ metadata: { sourceFiles } }));
    const runner = createExperimentRunner({
      module: null as any,
      parseRegistration: (value: unknown) => value as any,
      tasks: () => [],
      setup: () => { throw Error('No task expected'); },
      policies: () => { throw Error('No task expected'); },
      facts: () => [],
      summarize: (value: any) => ({ id: value.id }),
      identity: async () => ({ sourceDigest: 'fixed' }),
      artifacts: { native, controlled }
    });
    for (const engine of ['native', 'controlled'] as const) {
      const output = join(directory, engine), files = new ExperimentFiles<{ id: string }>(output, value => value);
      await runner.runExperiment(output, { id: engine, engine, maxAttempts: 1, maxSteps: 1 } as any);
      const key = engine === 'native' ? 'native-artifact' : 'artifact';
      const artifact: any = await files.read(key);
      await files.write(key, { ...artifact, ...(engine === 'native' ? { code: 'changed' } : { content: Buffer.from('changed').toString('base64') }) });
      await assert.rejects(() => runner.runExperiment(output), /Frozen executable artifact changed/);
      const task = await runner.runTask({ id: 'probe', seed: 1 } as never, { id: engine, engine, maxAttempts: 1, maxSteps: 1 } as any, 1, files as any);
      assert.equal(task.status, 'fault');
      assert.match(task.error ?? '', /Frozen executable artifact changed/);
      await files.write(key, artifact);
      assert.deepEqual(await files.read(key), artifact);
      await writeFile(source, 'changed');
      await assert.rejects(() => runner.runExperiment(output), /Executable source changed; rebuild/);
      await writeFile(source, 'original');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('one experiment owns one controlled provider across task commits and keeps Contexts independent', async () => {
  const { compileJavaScript } = await import('@bear-forge/compiler');
  const { ProgramExecution } = await import('../../runtime-controlled/src/execution.ts');
  const directory = await mkdtemp(join(tmpdir(), 'bear-shared-provider-'));
  const controlled = join(directory, 'program.bin');
  const artifact = compileJavaScript(`let counter=0;
    const schema={_zod:{def:{type:'unknown'}},parse(value){return value;}};
    export const program={schemas:{setup:schema,result:schema,ports:{}},
      async run(setup){return {counter:++counter,setup};}};`);
  await writeFile(controlled, artifact.content);
  const schema = { parse: (value: unknown) => value };
  const tasks = Array.from({length: 4}, (_, i) => ({id: 'task-' + i, seed: i}));
  const runner = createExperimentRunner({
    module: {contract: {schemas: {view: schema, result: schema}, ports: {},
      finish: (result: unknown) => ({view: null, result})}} as any,
    parseRegistration: (value: unknown) => value as any,
    tasks: () => tasks,
    setup: (task: any) => task.seed,
    policies: () => ({}), facts: () => [],
    summarize: (value: any) => ({id: value.id, status: value.status, result: value.result}),
    identity: async () => ({sourceDigest: 'provider-lifetime'}),
    artifacts: {native: 'unused', controlled}
  });
  const original = ProgramExecution.prototype.admitSchemas;
  let admissions = 0;
  ProgramExecution.prototype.admitSchemas = function() { admissions++; return original.call(this); };
  try {
    for (const concurrency of [1, 2]) {
      admissions = 0;
      const output = await runner.runExperiment(join(directory, String(concurrency)), {
        id: 'shared', engine: 'controlled', maxAttempts: 1, maxSteps: 2,
        computeStepBudget: 1000000, memoryBudgetMB: 4096, concurrency
      } as any);
      assert.equal(admissions, tasks.length + 1, 'one load admission plus one initialization per task');
      assert.deepEqual(output.results.sort((a: any,b: any) => a.id.localeCompare(b.id)), tasks.map(task => ({
        id: task.id, status: 'ended', result: {counter: 1, setup: task.seed}
      })));
    }
  } finally {
    ProgramExecution.prototype.admitSchemas = original;
    await rm(directory, {recursive: true, force: true});
  }
});
