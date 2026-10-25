import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCardGame } from '../src/card.ts';
import {main} from '../src/main.ts';
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
  test(`production dedicated ${game} through BaseGame records only its actual execution, controlled ${controlled}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'card-cli-'));
    try {
      const records = join(directory, 'records.json');
      const result = await runCardGame({ game, controlled, seed: 31, records });
      assert.equal(result.state.kind,'ended');assert.equal('replayVerified' in result,false);
      const saved=JSON.parse(await readFile(records,'utf8'));
      assert.equal(saved.records.length,result.records);assert.ok(saved.coreTrace.length>0);
      assert.equal(saved.records.at(-1).kind,'completed');
      assert.equal(saved.records.filter((row:any)=>row.kind==='started').length,1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test('ordinary native CLI games finish without collecting or replaying an unrequested audit', async () => {
  for (const game of ['forge-duel', 'doudizhu'] as const) {
    const result = await runCardGame({ game, controlled: false, seed: 31 });
    assert.equal(result.state.kind, 'ended');
    assert.equal(result.records,0);assert.equal('replayVerified' in result,false);
  }
});

test('STS rejects generic execution and replay before starting a game', async () => {
  await assert.rejects(runCardGame({game:'sts',controlled:true,seed:'18446744073709551615'}), /dedicated sts play/);
  for(const game of ['sts','forge-duel','doudizhu'])await assert.rejects(main(['card:replay','--game',game,'--records','/must-not-be-read']),/Historical replay is disabled/);
});
