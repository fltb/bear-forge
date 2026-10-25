import { cardDefinition } from '../src/card.ts';
import { contract } from '../src/module.ts';
import { game } from './reference/module.ts';
import { benchmarkCards } from '../../../packages/runtime-card/tests/benchmark-support.ts';
import { benchmarkInteractiveGames } from '../../../packages/runtime-card/tests/game-benchmark.ts';
const workload={
  definition:cardDefinition,contract,reference:game,players:['0','1','2'],
  setups:[11,31].map(seed=>({game:{profile:'competitive-2016-bear-1' as const,firstBidder:'0' as const,initialGameTime:0},seed})),
  choose:(request:any)=>request.options.values.find((action:any)=>action.kind==='play')??request.options.values.at(-1)
};
if(!process.argv[2]||process.argv[2].startsWith('game-'))await benchmarkInteractiveGames(workload);
else await benchmarkCards(workload);
