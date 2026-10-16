import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTasks } from '../src/experiment/tasks.ts';
import { RegistrationSchema } from '../src/experiment/registration.schemas.ts';
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
test('registered disjoint phases, seats and complete factorial conditions', () => {
  const tasks = createTasks(config);
  assert.equal(tasks.length, 16);
  assert.equal(new Set(tasks.map(t => t.id)).size, 16);
  const seeds = tasks.filter(t => t.phase === 'discovery').map(t => t.seed);
  assert.ok(tasks.filter(t => t.phase === 'confirmation').every(t => !seeds.includes(t.seed)));
});
