import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCardGame, replayCardGame } from '../src/card.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCardLoader } from '@bear-forge/runtime-card';
import { fileURLToPath } from 'node:url';

test('default game build links Card definitions in both modes without creating a generic program', async () => {
  const root = new URL('../../../', import.meta.url);
  await promisify(execFile)(process.execPath, ['--experimental-strip-types', 'packages/cli/src/main.ts', 'build:games'], { cwd: fileURLToPath(root) });
  for (const name of ['forge-duel', 'doudizhu', 'sts']) {
    const { game } = await import(new URL('build/' + name + '.card.mjs', root).href);
    assert.equal(Object.hasOwn(game, 'program'), false);
    assert.equal(typeof game.definition.initialize, 'function');
    for (const controlled of (name === 'sts' ? [true] : [false, true])) {
      let executed = 0;
      const result = await createCardLoader({ controlled, trace: () => { executed++; } }).load(game.definition);
      if (!result.ok) throw Error(result.error.message);
      const deck = ['scout', 'guard', 'beast', 'witness', 'spark', 'blast', 'supply', 'repair', 'scout', 'guard', 'beast', 'witness'];
      const setup = name === 'forge-duel'
        ? { profile: 'forge-duel-v1', seed: 87, first: '0', decks: { '0': deck, '1': [...deck] } }
        : name === 'sts' ? { seed: '31' } : { game: { profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0 }, seed: 31 };
      const started = await result.value.core.start(setup);
      if (!started.ok) throw Error(started.error.message);
      assert.ok(executed > 0, 'both modes must actually execute card instructions');
      assert.equal((await started.value.inspect()).ok, true);
      await started.value.close();
      await result.value.capture?.release(started.value.id);
    }
  }
});
for (const game of ['forge-duel', 'doudizhu'] as const) for (const controlled of [false, true]) {
  test(`production dedicated ${game} through BaseGame, record and replay, controlled ${controlled}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'card-cli-'));
    try {
      const records = join(directory, 'records.json');
      const result = await runCardGame({ game, controlled, seed: 31, records });
      assert.equal(result.state.kind, 'ended'); assert.equal(result.replayVerified, true);
      const replay = await replayCardGame({ game, records, controlled }); assert.equal(replay.replayVerified, true);
      if (controlled) assert.ok(replay.coreSteps > 0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test('ordinary native CLI games finish without collecting or replaying an unrequested audit', async () => {
  for (const game of ['forge-duel', 'doudizhu'] as const) {
    const result = await runCardGame({ game, controlled: false, seed: 31 });
    assert.equal(result.state.kind, 'ended');
    assert.equal(result.records, 0); assert.equal(result.replayVerified, false);
  }
});

test('STS rejects generic execution and replay before starting a game', async () => {
  await assert.rejects(runCardGame({game:'sts',controlled:true,seed:'18446744073709551615'}), /dedicated sts play/);
  await assert.rejects(replayCardGame({game:'sts',controlled:true,records:'/must-not-be-read'}), /replay is disabled/);
});
