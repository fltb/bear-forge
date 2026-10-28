import { test } from 'node:test';
import { cardDefinition } from '../src/card.ts';
import { contract } from '../src/module.ts';
import { game as reference } from './reference/module.ts';
import { verifyInteractiveGames } from '@bear-forge/runtime-card/tests/game-benchmark';

test('complete DDZ GameHosts preserve real player requests, choices and event deliveries in both modes', async () => {
  await verifyInteractiveGames({ definition: cardDefinition, contract, reference,
    setups: [11, 31].map(seed => ({ game: { profile: 'competitive-2016-bear-1', firstBidder: '0', initialGameTime: 0 }, seed })),
    players: ['0', '1', '2'],
    choose: request => request.options.values.find((action: any) => action.kind === 'play') ?? request.options.values.at(-1)
  });
});
