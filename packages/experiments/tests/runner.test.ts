import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExperimentRunner } from '../src/runner.ts';
import { ExperimentFiles } from '../src/files.ts';
import { createHash } from 'node:crypto';

test('bounded runner accounts for prior work, stops on faults, and does not restart exhausted batches', async () => {
  type G = {setup:number;ports:{};programResult:number;view:number;player:'0';observation:number;actions:{};event:never;playerEvent:never;result:number;control:never};
  const {createNativeLoader} = await import('@bear-forge/runtime-native');
  const {z} = await import('zod');
  const directory = await mkdtemp(join(tmpdir(),'bear-bounded-runner-'));
  let starts = 0, fail = false;
  const runner = createExperimentRunner<G,{id:string;seed:number},any,{id:string;status:string}>({
    contract:{schemas:{view:z.number(),result:z.number()},ports:{},finish:(result:number)=>({view:result,result})} as any,
    execution:{identity:{kind:'bounded-fixture'},load:()=>createNativeLoader().load({schemas:{setup:z.number(),result:z.number(),ports:{}},async run(value:number){starts++;if(fail)throw Error('fixture-fault');return value;}})},
    parseRegistration:(v:unknown)=>v as any,tasks:()=>[{id:'a',seed:1},{id:'b',seed:2}],setup:(t:any)=>t.seed,
    policies:()=>({}),facts:()=>[],summarize:(row:any)=>({id:row.id,status:row.status}),identity:async()=>({version:1}),
  });
  const config={id:'bounded',engine:'native',maxAttempts:1,maxSteps:2,concurrency:1,batchMilliseconds:60_000,taskMilliseconds:10_000,stopOnFault:true};
  try {
    const aborted=new AbortController();aborted.abort();
    assert.equal((await runner.runExperiment(join(directory,'cancelled'),config as any,undefined,{signal:aborted.signal})).results.length,0);
    assert.equal(starts,0);
    const cancelledFiles=new ExperimentFiles(join(directory,'cancelled'),v=>v);
    const wallWindow:any=await cancelledFiles.read('wall-budget');
    assert.equal(wallWindow.milliseconds,config.batchMilliseconds);
    await cancelledFiles.write('wall-budget',{...wallWindow,startedAt:Date.now()-config.batchMilliseconds-1});
    const expired=await runner.runExperiment(join(directory,'cancelled'));
    assert.equal(expired.stopReason,'wall-budget');assert.equal(expired.results.length,0);assert.equal(starts,0);
    await cancelledFiles.write('wall-budget',{...wallWindow,milliseconds:config.batchMilliseconds+1});
    await assert.rejects(runner.runExperiment(join(directory,'cancelled')),/Invalid experiment wall budget/);
    const spent=join(directory,'spent'),files=new ExperimentFiles<{id:string;status:string;cost:{milliseconds:number}}>(spent,v=>v);
    await files.register(config,[{id:'a',seed:1},{id:'b',seed:2}]);
    await files.commit('a',{id:'a',status:'ended',cost:{milliseconds:60_001}});
    assert.equal((await runner.runExperiment(spent)).results.length,1);assert.equal(starts,0);
    fail=true;
    const failed=join(directory,'failed'),first=await runner.runExperiment(failed,config as any);
    assert.equal(first.results.length,1);assert.equal(first.results[0]!.status,'fault');assert.equal(starts,1);
    assert.equal((await runner.runExperiment(failed)).results.length,1);assert.equal(starts,1);
  } finally {await rm(directory,{recursive:true,force:true});}
});

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
  const heapSizeLimit = frozen.runtime.heapSizeLimit;
  assert.ok(heapSizeLimit > 0);
  frozen.runtime.heapSizeLimit = heapSizeLimit + 1;
  await files.write('implementation', frozen);
  await assert.rejects(() => runner.runExperiment(directory), /Experiment runtime version changed/);
  frozen.runtime.heapSizeLimit = heapSizeLimit;
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

test('an injected provider is shared by tasks and rejects historical or changed artifacts before loading', async () => {
  type G = { setup: number; ports: {}; programResult: number; view: number; player: 'a'; observation: number;
    actions: {}; event: never; playerEvent: never; result: number; control: { request: never; input: never } };
  const { createNativeLoader } = await import('@bear-forge/runtime-native');
  const { z } = await import('zod');
  const directory = await mkdtemp(join(tmpdir(), 'bear-injected-provider-'));
  let loads = 0;
  const tasks = [{ id: 'a', seed: 1 }, { id: 'b', seed: 2 }];
  const definition = {
    contract: { schemas: { view: z.number(), result: z.number() }, ports: {},
      finish: (result: number) => ({ view: result, result }) } as any,
    execution: { identity: { kind: 'test-provider', rule: 'same-definition' }, async load() {
      loads++;
      return createNativeLoader().load({ schemas: { setup: z.number(), result: z.number(), ports: {} }, async run(setup: number) { return setup; } });
    } },
    parseRegistration: (value: unknown) => value as any, tasks: () => tasks,
    setup: (task: any) => task.seed, policies: () => ({}), facts: () => [],
    summarize: (value: any) => ({ id: value.id, result: value.result }), identity: async () => ({ source: 'fixed' })
  };
  try {
    const runner = createExperimentRunner<G, typeof tasks[number], any, { id: string; result: unknown }>(definition);
    const output = await runner.runExperiment(directory, { id: 'injected', engine: 'native', maxAttempts: 1, maxSteps: 2 } as any);
    assert.equal(loads, 1);
    assert.deepEqual(output.results, [{ id: 'a', result: 1 }, { id: 'b', result: 2 }]);
    const files = new ExperimentFiles(directory, value => value);
    const frozen = await files.read('native-artifact');
    assert.deepEqual(frozen, definition.execution.identity);
    for (const wrong of [{ code: 'historical', exportName: 'program' }, { kind: 'test-provider', rule: 'changed' }]) {
      await files.write('native-artifact', wrong);
      await assert.rejects(() => runner.runExperiment(directory), /another provider/);
      assert.equal((await runner.runTask(tasks[0]!, { id: 'injected', engine: 'native', maxSteps: 2 } as any, 1, files as any)).status, 'fault');
      assert.equal(loads, 1);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
