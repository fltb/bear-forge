import {rules} from '../rules/execution.ts';
import {createAdventureProgram,adventureContent} from './adventure.ts';
import {volibearContent} from './volibear-content.ts';

export const volibearAdventureProgram=createAdventureProgram({
  start:volibearContent.start,
  catalog:{
    starterRelic:volibearContent.hearts.exports.HuntersHeart,
    cards:[...adventureContent.cards.exports.definitions,...volibearContent.cards.exports.definitions],
    cardPools:volibearContent.cards.exports.cardPools,
    relics:[...adventureContent.acquisition.exports.definitions,
      {id:'VOLIBEAR_HUNTERS_HEART',definition:volibearContent.hearts.exports.HuntersHeart},
      {id:'VOLIBEAR_IMMORTAL_HEART',definition:volibearContent.hearts.exports.ImmortalHeart}],
  },
  initialize:b=>rules.call(volibearContent.history.exports.initialize,b.input),
  modules:[adventureContent.cards,adventureContent.acquisition,volibearContent.cards,volibearContent.history,volibearContent.hearts],
});
