import { createCardLoader, fileSnapshotStore } from '@bear-forge/runtime-card';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperimentRunner } from '@bear-forge/experiments';
import type { Registration, TaskInput, TaskResult } from '@bear-forge/experiments';
import { createScript } from '@bear-forge/policies';
import { game } from '../src/index.ts';
import type { DouDizhuTypes } from '../src/index.ts';

test('the shared experiment runner completes a real three-player Dou Dizhu game', async () => {
  const runner = createExperimentRunner<DouDizhuTypes, TaskInput, Registration, TaskResult>({
    contract: game.contract,
    execution: {
      identity: { kind: 'card', rule: game.definition.id },
      load: ({ controlled, stepBudget, snapshotDirectory }) => createCardLoader({ controlled, stepBudget, recordCore: true,
        ...(snapshotDirectory ? { snapshots: fileSnapshotStore(snapshotDirectory) } : {})
      }).load(game.definition)
    },
    parseRegistration: () => { throw Error('This test runs an individual task'); },
    tasks: () => [{ id: 'three-player', seed: 7 }],
    setup: task => ({ seed: task.seed, game: {
      profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0
    } }),
    policies: () => Object.fromEntries(['0', '1', '2'].map(player => [player, createScript('last')])),
    facts: () => [],
    summarize: value => value,
    identity: async () => ({ game: 'doudizhu' })
  });
  const result = await runner.runTask({ id: 'three-player', seed: 7 }, {
    id: 'three-player', maxSteps: 600, maxAttempts: 1
  });
  assert.equal(result.status, 'ended', result.error ?? 'expected complete game');
  assert.deepEqual(Object.keys(result.result.scores).sort(), ['0', '1', '2']);
  assert.equal(Object.values<number>(result.result.scores).reduce((sum, value) => sum + value, 0), 0);
  for (const player of ['0', '1', '2']) {
    assert.ok(result.packets.some(packet => packet.player === player && packet.kind === 'request'));
  }
  assert.ok(result.decisions.length > 3);
});
