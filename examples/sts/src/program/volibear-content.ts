import {volibearCardDescriptions} from '../content/characters/volibear/cards/metadata.ts';
import {createVolibearCatalog} from '../content/characters/volibear/catalog.ts';
import {volibearStart} from '../content/characters/volibear/start.ts';
import {volibearHearts} from '../content/characters/volibear/relics/heart.ts';
import {combatChoices,booleanCombatAdapter,booleanCombatDependencies,createBooleanCardChoiceHistory} from '../adapters/ports.ts';
import {CardScreen} from '../adapters/selection-presentations.ts';
import {createAdventureStart} from './start.ts';

const cards=createVolibearCatalog(combatChoices,{
  discard:CardScreen.VolibearDiscard,exhaust:CardScreen.VolibearExhaust,discardToTop:CardScreen.Headbutt,scry:CardScreen.VolibearScry,
  retain:CardScreen.VolibearRetain,copy:CardScreen.VolibearCopy,recover:CardScreen.VolibearRecover,train:CardScreen.VolibearTrain,
},booleanCombatAdapter,booleanCombatDependencies);
const history=createBooleanCardChoiceHistory(cards.exports.optionalChoices,[cards]);
/** Production port composition, shared by the character's normal adventure root. */
export const volibearContent={cards,history,start:createAdventureStart(volibearStart,volibearCardDescriptions.B03.id),hearts:volibearHearts};
