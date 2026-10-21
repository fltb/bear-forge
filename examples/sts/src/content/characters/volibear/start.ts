import {rules} from '../../../rules/execution.ts';
import {createCharacterStart,standardRelicPools} from '../start.ts';
import {volibearBasicCards} from './cards/basic.ts';
import {volibearEngageCards} from './cards/engage.ts';
import {volibearHearts} from './relics/heart.ts';
import {volibearPlayCounts} from './mechanics/play-counts.ts';

export const volibearStart=createCharacterStart({
  relicPools:{...standardRelicPools,boss:standardRelicPools.boss.map(id=>id==='BLACK_BLOOD'?'VOLIBEAR_IMMORTAL_HEART':id)},
  maxHp:80,ascensionMaxHpLoss:5,relic:volibearHearts.exports.HuntersHeart,
  deck:[
    {definition:volibearBasicCards.exports.Strike,count:4},
    {definition:volibearBasicCards.exports.Defend,count:4},
    {definition:volibearBasicCards.exports.ThunderClaw,count:1},
    {definition:volibearEngageCards.exports.StandAndFight,count:1},
  ],
  initializeActor:b=>rules.call(volibearPlayCounts.exports.trackBattles,{actor:b.input,scope:0}),
},[volibearBasicCards,volibearEngageCards,volibearHearts,volibearPlayCounts]);
