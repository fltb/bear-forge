import { writeFile, readFile } from 'node:fs/promises';
import { createCardLoader, replayCard, readCardTrace } from '@bear-forge/runtime-card';
import { createGameBinder } from '@bear-forge/game-host';
import { cardDefinition as forge, game as forgeGame, baseDeck } from '@bear-forge/forge-duel';
import { cardDefinition as ddz, game as ddzGame } from '@bear-forge/doudizhu';

/** A production route through Card Core → Instance → the existing BaseGame. */
export async function runCardGame(options: { game: 'forge-duel' | 'doudizhu'; controlled: boolean; seed: number; records?: string }) {
  const unwrap = (r: any): any => { if (!r.ok) throw Error(JSON.stringify(r.error)); return r.value; };
  const definition: any = options.game === 'forge-duel' ? forge : ddz;
  const contract: any = options.game === 'forge-duel' ? forgeGame.contract : ddzGame.contract;
  const setup = options.game === 'forge-duel'
    ? { profile: 'forge-duel-v1', seed: options.seed, first: '0', decks: { '0': [...baseDeck], '1': [...baseDeck] } }
    : { game: { profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0 }, seed: options.seed };
  const loaded: any = unwrap(await createCardLoader({ controlled: options.controlled, recordCore: options.controlled || !!options.records }).load(definition));
  const instance = unwrap(await loaded.core.start(setup));
  const game = unwrap(await createGameBinder().bind({ instance, contract, ...(loaded.persistence ? { persistence: loaded.persistence } : {}) }));
  try {
    for (const player of options.game === 'forge-duel' ? ['0', '1'] : ['0', '1', '2']) unwrap(await game.bind({ player, async onRequest(request: any) {
      if (request.options.kind !== 'exact') throw Error('Example requires exact choices');
      const values = request.options.values;
      const action = options.game === 'doudizhu' ? values.find((a: any) => a.kind === 'play') ?? values.at(-1) : values[0];
      return { kind: 'reply', value: action };
    }, async onEvent() { return { kind: 'reply', value: null }; } }));
    let steps = 0, state = unwrap(await game.inspect());
    while (!['ended', 'fault'].includes(state.kind)) { if (++steps > 2000) throw Error('Card example exceeded decision limit'); state = unwrap(await game.run()).state; }
    let count = 0, replayVerified = false;
    if (options.records) {
      const records = unwrap(await loaded.capture.read(instance.id, { after: null, limit: 10000 })).records;
      const coreTrace = unwrap(readCardTrace(loaded, instance.id));
      unwrap(await replayCard(definition, records, { controlled: options.controlled, coreTrace }));
      await writeFile(options.records, JSON.stringify({ rule: definition.id, records, coreTrace }, null, 2));
      count = records.length; replayVerified = true;
    }
    return { backend: 'card', controlled: options.controlled, game: options.game, steps, state, records: count, replayVerified };
  } finally { await game.close(); await loaded.capture?.release(instance.id); }
}

export async function replayCardGame(options: { game: 'forge-duel' | 'doudizhu'; records: string; controlled: boolean }) {
  const definition: any = options.game === 'forge-duel' ? forge : ddz;
  const data = JSON.parse(await readFile(options.records, 'utf8'));
  if (data.rule !== definition.id || !Array.isArray(data.records)) throw Error('Record rule mismatch');
  const result = await replayCard(definition, data.records, { controlled: options.controlled, ...(Array.isArray(data.coreTrace) ? { coreTrace: data.coreTrace } : {}) });
  if (!result.ok) throw Error(result.error.message);
  return { game: options.game, replayVerified: true, records: data.records.length, coreSteps: data.coreTrace?.length ?? null };
}
