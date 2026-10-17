import { cardDefinition } from '../src/card.ts';
import { contract } from '../src/module.ts';
import { game } from './reference/module.ts';
import { baseDeck, legal } from './reference/rules.ts';
import { benchmarkCards } from '../../../packages/runtime-card/tests/benchmark-support.ts';
import { benchmarkInteractiveGames } from '../../../packages/runtime-card/tests/game-benchmark.ts';
const fixtures = [];
for (const seed of [87, 991]) {
  const setup = { profile: 'forge-duel-v1' as const, seed, first: '0' as const, decks: { '0': [...baseDeck], '1': [...baseDeck] } }, tape: any[] = [];
  const result = await game.program.run(setup, { async call(call: any) { const saved = structuredClone(call), output = call.port === 'event' ? null : legal(call.input)[0]!; tape.push({ call: saved, output: structuredClone(output) }); return output; } } as any);
  fixtures.push({ setup, tape, result });
}
if (!process.argv[2] || process.argv[2].startsWith('game-')) await benchmarkInteractiveGames({
  definition: cardDefinition, contract, reference: game, setups: fixtures.map(f => f.setup), players: ['0', '1'],
  choose: request => request.options.values[0]
});
else await benchmarkCards(cardDefinition, fixtures, contract);
