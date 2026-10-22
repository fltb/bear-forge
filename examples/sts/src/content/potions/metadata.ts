import {potionId} from '../../identifiers.ts';

/** Shared by legal-action production and operator presentation. */
export function potionRequiresEnemy(id:number):boolean{
  return id===potionId.FEAR_POTION||id===potionId.FIRE_POTION||id===potionId.WEAK_POTION;
}

/** Blood Potion uses the same 20%-per-potency multiplier in and out of combat. */
export function bloodPotionHealing(maxHp:number,multiplier:1|2):number{return Math.trunc(Math.fround(Math.fround(maxHp)*Math.fround(multiplier===2?.4:.2)));}
