import { cardDefinition } from '../src/card.ts';
import { contract } from '../src/module.ts';
import { game } from './reference/module.ts';
import { benchmarkCards } from '../../../packages/runtime-card/tests/benchmark-support.ts';
import { benchmarkInteractiveGames } from '../../../packages/runtime-card/tests/game-benchmark.ts';
const fixtures = [];
for (const seed of [11, 31]) {
  const setup = { game: { profile: 'competitive-2016-bear-1' as const, firstBidder: '0' as const, initialGameTime: 0 }, seed }, tape: any[] = [];
  const result = await game.program.run(setup, { async call(call: any) {
    const saved = structuredClone(call); let output = null;
    if (call.port === 'decision') {
      const port = game.contract.ports.decision, { view, requests } = port.receive(call.input), request = requests[0]!;
      const options: any = game.contract.inputs.action.describe(view, request), action = options.values.find((a: any) => a.kind === 'play') ?? options.values.at(-1);
      const reply: any = port.respond(view, request, action); if (!reply.valid) throw Error('Reference reply invalid'); output = reply.output;
    }
    tape.push({ call: saved, output: structuredClone(output) }); return output;
  } } as any);
  fixtures.push({ setup, tape, result });
}
if (!process.argv[2] || process.argv[2].startsWith('game-')) await benchmarkInteractiveGames({
  definition: cardDefinition, contract, reference: game, setups: fixtures.map(f => f.setup), players: ['0', '1', '2'],
  choose: request => request.options.values.find((action: any) => action.kind === 'play') ?? request.options.values.at(-1)
});
else await benchmarkCards(cardDefinition, fixtures, contract);
