import {potionId} from '../../identifiers.ts';
import {potionPrograms} from './programs.ts';
export {bloodPotionHealing} from './vitality.ts';

/** Legal actions and operator presentation project the executing composition. */
export function potionRequiresEnemy(id:number):boolean {
  return Object.entries(potionPrograms).some(([name,program])=>potionId[name as keyof typeof potionPrograms]===id&&program.targeted);
}
