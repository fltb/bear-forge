import * as pools from '../../../pools.ts';
import type {CharacterCardPools} from '../../../rules/adventures.types.ts';
/** Keep the source's distinct ordered pools to preserve seeded draws. */
export const ironcladCardPools:CharacterCardPools={
  color:0,rarity:[pools.commonIronclad,pools.uncommonIronclad,pools.rareIronclad],typeRarity:pools.ironcladTypeRarity,
  random:pools.trulyRandomIronclad,transform:pools.transformIronclad,
  combat:[pools.combatAttackPool,pools.combatSkillPool,pools.combatPowerPool,pools.combatCardPool,pools.combatColorlessPool],
  startingBasics:['STRIKE_RED','DEFEND_RED'],
};
