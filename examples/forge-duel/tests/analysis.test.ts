import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/experiment/analysis.ts';
import { createTasks, RegistrationSchema } from '../src/experiment/execution.ts';
import type { TaskResult } from '../src/experiment/experiment.types.ts';
const config = RegistrationSchema.parse({
  version: 1,
  game: 'forge-duel-v1',
  id: 'stats',
  blocks: 64,
  seed: 1,
  policies: ['first'],
  opponents: ['last'],
  maxSteps: 100,
  maxAttempts: 2,
  minimumBlocks: 64,
  margin: 0.05,
  bootstrap: 2000,
  analysisSeed: 7
});
const rows = createTasks(config).map(input => ({
  id: input.id,
  input,
  attempt: 1,
  status: 'ended',
  result: {
    scores: {
      '0': input.seat === '0' ? input.replacement ? 1 : 0 : input.replacement ? 0 : 1,
      '1': input.seat === '1' ? input.replacement ? 1 : 0 : input.replacement ? 0 : 1
    }
  },
  packets: [],
  facts: [],
  decisions: [],
  policy: {},
  cost: {
    milliseconds: 1,
    steps: 1
  }
}) as TaskResult);
test('paired seed blocks combine seats, estimate effects, freeze candidates and confirm independently', () => {
  const a = analyze(config, rows),
    replacement = a.relations.find(r => r.kind === 'replacement' && r.phase === 'discovery')!;
  assert.equal(replacement.blocks, 64);
  assert.equal(replacement.effect, 1);
  assert.equal(replacement.status, 'positive');
  assert.ok(a.relations.some(r => r.kind === 'replacement' && r.phase === 'confirmation' && r.status === 'positive'));
  const changed = analyze(config, rows.map(r => r.input.phase === 'confirmation' ? {
    ...r,
    result: {
      scores: {
        '0': 0.5,
        '1': 0.5
      }
    }
  } : r));
  assert.deepEqual(changed.candidates, a.candidates);
  assert.equal(changed.relations.find(r => r.kind === 'replacement' && r.phase === 'confirmation')!.status, 'equivalent');
});
test('missing/fault do not score zero; no significance is not equivalence', () => {
  const missing = analyze(config, []);
  assert.ok(missing.relations.every(r => r.status === 'missing' && r.effect === null));
  const small = analyze({
    ...config,
    blocks: 1
  }, rows.filter(r => r.input.block === 0));
  assert.ok(small.relations.every(r => r.status === 'unknown'));
  const incomplete = analyze(config, rows.map((r, i) => i === 0 ? {
    ...r,
    status: 'fault'
  } : r));
  assert.equal(incomplete.relations.find(r => r.kind === 'replacement')!.blocks, 63);
});
test('duplicate retries or branch cells cannot be counted as independent observations', () => {
  assert.throws(() => analyze(config, [...rows, rows[0]!]), /not independent/);
  assert.throws(() => analyze(config, rows.map((r, i) => i === 0 ? {
    ...r,
    lineage: {
      rootTaskId: 'parent',
      parentTaskId: 'parent',
      kind: 'branch'
    }
  } : r)), /not independent/);
  assert.throws(() => analyze(config, [...rows, {
    ...rows[0]!,
    id: 'branch-copy'
  }]), /not independent/);
});
