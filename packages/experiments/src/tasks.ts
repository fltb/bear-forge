import { baseDeck } from '@bear-forge/forge-duel';
import type { Registration, TaskInput } from './experiment.types.ts';
export function createTasks(config: Registration): TaskInput[] {
  const tasks: TaskInput[] = [];
  for (const phase of ['discovery', 'confirmation'] as const) for (let block = 0; block < config.blocks; block++) for (const policy of config.policies) for (const opponent of config.opponents) for (const seat of ['0', '1'] as const) for (const replacement of [0, 1] as const) for (const support of [0, 1] as const) {
    const seed = config.seed + Math.imul(phase === 'discovery' ? block : block + config.blocks, 2654435761) >>> 0;
    const deck = [...baseDeck];
    if (replacement) deck[8] = 'blast';
    if (support) deck[2] = 'repair';
    const decks = {
      '0': [...baseDeck],
      '1': [...baseDeck]
    };
    decks[seat] = deck;
    tasks.push({
      id: [phase, block, policy, opponent, seat, replacement, support].join('-'),
      phase,
      block,
      seed,
      seat,
      policy,
      opponent,
      replacement,
      support,
      decks
    });
  }
  return tasks;
}
