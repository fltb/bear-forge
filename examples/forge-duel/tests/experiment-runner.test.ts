import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentFiles, createTasks, runTask, RegistrationSchema } from '@bear-forge/forge-duel/experiment/execution';
const config = RegistrationSchema.parse({
  version: 1,
  game: 'forge-duel-v1',
  id: 'test',
  blocks: 1,
  seed: 19,
  policies: ['rule'],
  opponents: ['last'],
  maxSteps: 1000,
  maxAttempts: 2,
  minimumBlocks: 64,
  margin: 0.05,
  bootstrap: 2000,
  analysisSeed: 51
});
test('real production game, policies, private packets, audit facts and durable receipt', async () => {
  const input = createTasks(config)[0]!,
    result = await runTask(input, config);
  assert.equal(result.status, 'ended', JSON.stringify(result.error));
  assert.ok(result.facts.some(e => e.kind === 'carry'));
  assert.ok(result.facts.some(e => e.kind === 'available'));
  assert.ok(result.decisions.length);
  assert.equal(result.lineage?.rootTaskId, input.id);
  for (const p of result.packets) {
    assert.ok(!('seed' in (p.value.observation ?? {})));
    if (p.kind === 'event') assert.notEqual(p.value.event.visibility, 'audit');
  }
  const path = await mkdtemp(join(tmpdir(), 'bear-experiment-')),
    files = new ExperimentFiles(path);
  await files.register(config, [input]);
  await files.commit(input.id, result);
  await files.commit(input.id, { ...result, result: null });
  const restarted = new ExperimentFiles(path);
  assert.deepEqual(await restarted.results(), [result]);
  assert.deepEqual(await restarted.receipt(input.id, 0), result.commits![0]);
  await assert.rejects(() => restarted.register({
    ...config,
    seed: 20
  }, [input]), /mismatch/);
});
test('bounded concurrent batches reproduce independent sequential tasks; memory exhaustion is truncated without a fabricated result', async () => {
  const {
    runExperiment
  } = await import('@bear-forge/forge-duel/experiment/execution');
  const sequential = await runExperiment(await mkdtemp(join(tmpdir(), 'bear-sequential-')), config);
  const concurrent = await runExperiment(await mkdtemp(join(tmpdir(), 'bear-concurrent-')), {
    ...config,
    concurrency: 2
  });
  const semantic = (rows: any[]) => rows.map(row => ({
    id: row.id,
    result: row.result,
    facts: row.facts,
    decisions: row.decisions.map((d: any) => ({
      action: d.proposal.action,
      probability: d.proposal.probability
    }))
  }));
  assert.deepEqual(semantic(await sequential.files.results()), semantic(await concurrent.files.results()));
  const input = createTasks(config)[0]!;
  const exhausted = await runTask(input, {
    ...config,
    memoryBudgetMB: 32
  });
  assert.equal(exhausted.status, 'truncated');
  assert.equal(exhausted.result, null);
  assert.equal(exhausted.cost.steps, 0);
  assert.equal(RegistrationSchema.safeParse({
    ...config,
    concurrency: 5
  }).success, false);
});

test('experiment classification uses failure identity and protocol codes, never message keywords', async () => {
  const {createExperimentRunner}=await import('@bear-forge/experiments');
  const {game}=await import('./generic/module.ts');
  const input=createTasks(config)[0]!;
  const failures=[Error('budget exceeded'),Error('timed out'),Object.assign(Error('budget'),{code:'budget_exceeded',name:'NativeBudgetError'})];
  const definition={
    module:game,parseRegistration:()=>config,tasks:()=>[input],
    setup:()=>({profile:'forge-duel-v1' as const,seed:input.seed,first:'0' as const,decks:input.decks}),
    policies:()=>({}),facts:()=>[],summarize:(value:{id:string})=>({id:value.id}),
    identity:async()=>({}),artifacts:{native:'unused',controlled:'unused'}
  };
  for(const error of failures){
    const early=createExperimentRunner({...definition,setup(){throw error;}});
    assert.equal((await early.runTask(input,config)).status,'fault');
    const running=createExperimentRunner(definition);
    const result=await running.runTask(input,config,1,undefined,{point(){throw error;}});
    assert.equal(result.status,'fault');
    assert.ok(result.error?.includes(error.message));
  }
  const invalid=createExperimentRunner({...definition,setup:()=>({...definition.setup(),seed:'budget exceeded'} as any)});
  const invalidResult=await invalid.runTask(input,config);
  assert.equal(invalidResult.status,'fault');assert.match(invalidResult.error!,/invalid_input/);
  const rejecting=createExperimentRunner({...definition,module:{...game,program:{...game.program,schemas:{...game.program.schemas,
    setup:game.program.schemas.setup.refine(()=>false,'budget exceeded')
  }}}});
  const rejected=await rejecting.runTask(input,config);
  assert.equal(rejected.status,'fault');assert.match(rejected.error!,/invalid_input/);assert.match(rejected.error!,/ZodError/);
  const throwingSchema=createExperimentRunner({...definition,module:{...game,program:{...game.program,schemas:{...game.program.schemas,
    setup:game.program.schemas.setup.refine(()=>{throw Error('budget exceeded');})
  }}}});
  const thrownInput=await throwingSchema.runTask(input,config);
  assert.equal(thrownInput.status,'fault');assert.match(thrownInput.error!,/invalid_input/);assert.match(thrownInput.error!,/budget exceeded/);
  const {NativeBudgetError}=await import('@bear-forge/runtime-native');
  let inspections=0;
  const trap=()=>{inspections++;throw Error('must not inspect');};
  for(const error of [Object.create(NativeBudgetError.prototype),new Proxy({},{get:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap}),{toString:trap}]){
    const early=createExperimentRunner({...definition,setup(){throw error;}});
    const result=await early.runTask(input,config);
    assert.equal(result.status,'fault');assert.equal(result.error,'Thrown object');
    const active=await createExperimentRunner(definition).runTask(input,config,1,undefined,{point(){throw error;}});
    assert.equal(active.status,'fault');assert.equal(active.error,'Thrown object');
  }
  assert.equal(inspections,0);
  const exhausted=createExperimentRunner({...definition,setup(){throw new NativeBudgetError('limit reached');}});
  assert.equal((await exhausted.runTask(input,config)).status,'truncated');
  assert.equal((await createExperimentRunner(definition).runTask(input,{...config,memoryBudgetMB:0})).status,'truncated');
});
