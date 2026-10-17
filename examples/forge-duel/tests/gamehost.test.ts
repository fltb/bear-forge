import { test } from 'node:test';
import { cardDefinition } from '../src/card.ts';
import { contract } from '../src/module.ts';
import { baseDeck } from '../src/rules.ts';
import { game as reference } from './reference/module.ts';
import { verifyInteractiveGames } from '../../../packages/runtime-card/tests/game-benchmark.ts';

test('complete Forge GameHosts preserve real player requests, choices and event deliveries in both modes', async () => {
  await verifyInteractiveGames({ definition: cardDefinition, contract, reference,
    setups: [87, 991].map(seed => ({ profile: 'forge-duel-v1', seed, first: '0', decks: { '0': [...baseDeck], '1': [...baseDeck] } })),
    players: ['0', '1'], choose: request => request.options.values[0]
  });
});
