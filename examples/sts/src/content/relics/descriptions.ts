import {adventureContent} from '../../program/adventure.ts';
import {adventureDraws} from '../rewards/draws.ts';
import {startingRelics} from '../characters/ironclad/relics/burning-blood.ts';
import {volibearHearts} from '../characters/volibear/relics/heart.ts';
import {potionRelics} from '../potions/relics.ts';
import {frozenEyePublication} from '../../adapters/combat-views.ts';
import {runicDomePublication} from '../../contract.ts';

/** Read-only projection of the actual installed owners, including split adventure effects. */
const projected:Record<string,string>={};
for(const source of [
  adventureContent.acquisition.exports.texts,
  adventureContent.rooms.exports.relicTexts,
  adventureContent.rooms.exports.loot.exports.relicTexts,
  adventureContent.merchant.exports.relicTexts,
  adventureContent.events.exports.relicTexts,
  adventureDraws.exports.relicTexts,
  startingRelics.exports.texts,
  potionRelics.exports.relicTexts,
  {FROZEN_EYE:frozenEyePublication.text,RUNIC_DOME:runicDomePublication.text},
])for(const [id,text] of Object.entries(source))projected[id]=(projected[id]??'')+text;

// Volibear's catalog replaces these definitions rather than installing Ironclad fallbacks.
export const relicTexts:Readonly<Record<string,string>>=Object.freeze({...projected,...volibearHearts.exports.texts,INVALID:'无遗物。'});
