import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearnerClient } from '../src/training/client.ts';
import { createModelRunner, learningRows } from '../src/training/execution.ts';
import { RegistrationSchema } from '../src/experiment/registration.schemas.ts';
import { summarize } from '../src/experiment/execution.ts';
import { ExperimentFiles } from '@bear-forge/experiments';
import type { TaskResult } from '@bear-forge/experiments';
import type { ModelTask } from '../src/training/training.types.ts';

test('real TS game feeds accepted decisions into upstream DouZero and reloads the updated model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ddz-train-'));
  const client = new LearnerClient();
  let restored: LearnerClient | undefined;
  try {
    await client.request({ command: 'configure', batchSamples: 1 });
    const initial = await client.request({ command: 'status' });
    const row = await createModelRunner(client)({ id: 'learning', seed: 7, seats: ['first', 'first', 'first'],
      model: { players: ['0', '1', '2'], version: initial.version, epsilon: 0.05 } },
    RegistrationSchema.parse({ id: 'learning', seats: ['first', 'first', 'first'] }));
    assert.equal(row.status, 'ended', row.error ?? 'model must complete our full game');
    const rows = learningRows(row);
    assert.ok(rows.length > 3);
    assert.deepEqual(new Set(rows.map(item => item.observation.observation.actor)), new Set(['0', '1', '2']));
    assert.ok(rows.every(item => item.observation.observation.phase === 'playing' && item.observation.observation.result === null));
    assert.deepEqual(learningRows({ ...row, status: 'truncated' }), []);
    const controlled = await createModelRunner(client)(row.input,
      RegistrationSchema.parse({ id: 'learning', seats: ['first', 'first', 'first'], engine: 'controlled' }), 1,
      new ExperimentFiles<TaskResult<ModelTask>, ReturnType<typeof summarize>>(directory, summarize));
    assert.equal(controlled.status, 'ended', controlled.error ?? 'controlled model game must end');
    assert.deepEqual(controlled.result, row.result);
    assert.deepEqual(learningRows(controlled), rows, 'same model must produce identical accepted training data in both modes');
    for (const decision of row.decisions.filter(d => d.proposal.encoderVersion === initial.encoder)) {
      assert.ok(Number.isFinite(decision.proposal.logProbability));
      assert.ok(decision.proposal.logProbability <= 0);
    }
    const updated = await client.request({ command: 'learn', version: initial.version, rows });
    assert.equal(updated.samples, rows.length);
    assert.equal(Object.values<number>(updated.updates).reduce((a, b) => a + b, 0), rows.length);
    assert.notEqual(updated.version, initial.version);
    const first = rows[0]!;
    const query = { command: 'score', observation: first.observation, actions: [first.action] };
    const scores = await client.request(query);
    const path = join(directory, 'model.pt');
    await client.request({ command: 'save', path, metadata: { nextSeed: 8 } });
    restored = new LearnerClient(900);
    const loaded = await restored.request({ command: 'load', path });
    assert.equal(loaded.metadata.nextSeed, 8);
    assert.deepEqual(await restored.request(query), scores);
    const continued = await restored.request({ command: 'learn', version: loaded.version, rows });
    assert.equal(Object.values<number>(continued.updates).reduce((a, b) => a + b, 0), 2 * rows.length);
    assert.equal(continued.samples, 2 * rows.length);
    await restored.close();
    await assert.rejects(restored.request({ command: 'status' }), /closed/);
  } finally {
    await client.close();
    if (restored) await restored.close();
    await rm(directory, { recursive: true, force: true });
  }
});
