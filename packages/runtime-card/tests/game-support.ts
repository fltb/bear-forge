import type { CardDefinition } from '@bear-forge/card-engine';
import type { GameContract, GameTypes } from '@bear-forge/contracts/authoring';
import type { GameHandle } from '@bear-forge/contracts/loading';
import { createGameBinder } from '@bear-forge/game-host';
import { createCardLoader } from '../src/index.ts';

export async function nativeGame<S, G extends GameTypes>(game: { definition: CardDefinition<S, G['setup'], G['ports'], G['programResult']>; contract: GameContract<G> }, setup: G['setup']): Promise<GameHandle<G>> {
  const loaded = await createCardLoader({ controlled: false }).load(game.definition);
  if (!loaded.ok) throw Error(loaded.error.message);
  const instance = await loaded.value.core.start(setup);
  if (!instance.ok) throw Error(instance.error.message);
  const bound = await createGameBinder().bind<G>({ instance: instance.value, contract: game.contract });
  if (!bound.ok) throw Error(bound.error.message);
  return bound.value;
}
