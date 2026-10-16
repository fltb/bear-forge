import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argumentsOf } from '../src/main.ts';
test('CLI parses explicit output, resume and invalid positional input', () => {
  assert.deepEqual(argumentsOf(['--resume', '--output', 'data']), {
    resume: true,
    output: 'data'
  });
  assert.throws(() => argumentsOf(['unexpected']));
});
test('command-specific options reject ignored flags and frozen-budget changes on resume', async () => {
  const {
    main
  } = await import('../src/main.ts');
  await assert.rejects(() => main(['serve', '--resume']), /Unknown option/);
  await assert.rejects(() => main(['experiment', '--resume', '--concurrency', '2']), /frozen registered budgets/);
});

test('documented analyze experiment id selects only its registered directory', async () => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {ExperimentFiles, RegistrationSchema} = await import('@bear-forge/forge-duel/experiment/execution');
  const {main} = await import('../src/main.ts');
  const directory = await mkdtemp(join(tmpdir(), 'bear-cli-analysis-'));
  const files = new ExperimentFiles(directory);
  try {
    await files.write('registration', {config:RegistrationSchema.parse({
      version:1,game:'forge-duel-v1',id:'registered',blocks:1,seed:7,
      policies:['first'],opponents:['last'],maxSteps:100,maxAttempts:1,
      minimumBlocks:64,margin:0.05,bootstrap:2000,analysisSeed:11
    })});
    await assert.rejects(() => main(['analyze','--experiment','--output',directory]), /requires an id/);
    await assert.rejects(() => main(['analyze','--experiment','other','--output',directory]), /does not match/);
    assert.equal(await files.read('analysis'), null);
    await main(['analyze','--experiment','registered','--output',directory]);
    const selected: any = await files.read('analysis');
    assert.equal(selected.experimentId,'registered');
    assert.equal(selected.cost.tasks,0);
    await main(['analyze','--output',directory]);
    assert.deepEqual(await files.read('analysis'),selected);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
