import { cardDefinition } from '../src/card.ts';
import { contract } from '../src/module.ts';
import { game } from './reference/module.ts';
import { baseDeck } from './reference/rules.ts';
import { benchmarkCards } from '@bear-forge/runtime-card/tests/benchmark-support';
import { benchmarkInteractiveGames } from '@bear-forge/runtime-card/tests/game-benchmark';
const workload={
  definition:cardDefinition,contract,reference:game,players:['0','1'],
  setups:[87,991].map(seed=>({profile:'forge-duel-v1' as const,seed,first:'0' as const,decks:{'0':[...baseDeck],'1':[...baseDeck]}})),
  choose:(request:any)=>request.options.values[0]
};
if(!process.argv[2]||process.argv[2].startsWith('game-'))await benchmarkInteractiveGames(workload);
else await benchmarkCards(workload);
