import {potionId} from '../../identifiers.ts';

/** Shared by legal-action production and operator presentation. */
export function potionRequiresEnemy(id:number):boolean{
  return id===potionId.FEAR_POTION||id===potionId.FIRE_POTION||id===potionId.WEAK_POTION;
}
