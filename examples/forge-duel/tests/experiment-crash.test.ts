import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ExperimentFiles, RegistrationSchema, createTasks, runExperiment } from '@bear-forge/forge-duel/experiment/execution';
const config = RegistrationSchema.parse({
  version: 1,
  game: 'forge-duel-v1',
  id: 'recovery',
  blocks: 1,
  seed: 97,
  policies: ['first'],
  opponents: ['last'],
  maxSteps: 1000,
  maxAttempts: 3,
  minimumBlocks: 64,
  margin: 0.05,
  bootstrap: 2000,
  analysisSeed: 21
});
test('real process death before/after advance, before commit and after durable receipt resumes without duplicate samples', async () => {
  const baselineDirectory = await mkdtemp(join(tmpdir(), 'bear-baseline-'));
  const baseline = await runExperiment(baselineDirectory, config);
  for (const stage of ['before-advance', 'after-advance', 'before-commit', 'after-commit']) {
    const directory = await mkdtemp(join(tmpdir(), 'bear-crash-')),
      files = new ExperimentFiles(directory);
    await files.register(config, createTasks(config));
    await assert.rejects(() => promisify(execFile)(process.execPath, ['--experimental-strip-types', new URL('./crash-child.ts', import.meta.url).pathname, directory, stage]));
    const committed = await files.results<any>();
    assert.equal(committed.length, stage === 'after-commit' ? 1 : 0);
    const recovered = await runExperiment(directory);
    assert.equal(recovered.results.length, 16);
    assert.equal(new Set(recovered.results.map(r => r.id)).size, 16);
    assert.deepEqual((await recovered.files.results<any>()).map(r => ({
      id: r.id,
      result: r.result,
      facts: r.facts
    })), (await baseline.files.results<any>()).map(r => ({
      id: r.id,
      result: r.result,
      facts: r.facts
    })));
    assert.equal((await runExperiment(directory)).results.length, 16);
  }
});
