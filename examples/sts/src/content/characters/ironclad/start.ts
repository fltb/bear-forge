import {rules} from '../../../rules/execution.ts';
import {createCharacterStart,standardRelicPools} from '../start.ts';
import {basicCards} from './cards/basic.ts';
import {startingRelics} from './relics/burning-blood.ts';

export const ironcladStart=createCharacterStart({
  relicPools:standardRelicPools,
  maxHp:80,ascensionMaxHpLoss:5,relic:startingRelics.exports.BurningBlood,
  deck:[{definition:basicCards.exports.StrikeRed,count:5},{definition:basicCards.exports.DefendRed,count:4},{definition:basicCards.exports.Bash,count:1}],
  initializeActor:b=>b.return(undefined),
},[basicCards,startingRelics]);
