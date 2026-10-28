import {volibearS2Powers} from '../powers/s2.ts';
import {randomStorm} from './s2-operations.ts';
import {deployPower,amountFormula} from './operations.ts';
import {describeProgram,describeAmount,amountText} from '../../../cards/shared/program-facts.ts';
import {cardAmount,describeAmounts} from '../../../cards/shared/programs.ts';
import {volibearBattleBody} from '../powers/battle-body.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {rules} from '../../../../rules/execution.ts';
import {resources} from '../../../../rules/resources.ts';
import {battles} from '../../../../rules/battles.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {zones} from '../../../../rules/zones.ts';
import {powers} from '../../../../rules/powers.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {volibearTraining} from '../mechanics/training.ts';
import {volibearHunt} from '../powers/hunt.ts';
import {volibearImmovable} from '../powers/immovable.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,thunder,compose,queued,draw} from './programs.ts';

export const volibearRareCards=rules.defineRules({requires:[volibearS2Powers,volibearBattleBody,volibearCardPrograms,volibearTraining,basicPowers,volibearHunt,volibearImmovable],build(){
  const becomeImmovable=deployPower(volibearImmovable.exports.programs.ImmovableBody,1);
  const hunt=deployPower(volibearHunt.exports.programs.EndlessHunt,1);
  const unifyStrength=deployPower(basicPowers.exports.programs.Strength,[3,4]);
  const blockMultiplier=2;
  const tripleBlock=rules.defineEffect<CardUse,void>(b=>rules.call(cardEffects.exports.gainBlock,{
    use:b.input,amount:b.read(v=>blockMultiplier*v.get(rules.query(resources.exports.current,v.input.owner)).block),
  }));
  describeProgram(tripleBlock,`额外获得当前格挡×${blockMultiplier}的格挡，不重复计算敏捷或脆弱。`);
  const upgradedBlock=8;
  const battleBody=deployPower(volibearBattleBody.exports.programs.BattleBody,1);
  return {exports:{
    BattleBody:card(cards.R16,compose(queued(battleBody),describeAmounts(rules.defineEffect<CardUse,void>(b=>rules.when(b.read(v=>v.input.state.upgraded),rules.call(block(upgradedBlock),b.input))),[upgradedBlock],n=>`升级后获得${n}格挡。`))),
    ImmovableBody:card(cards.R02,compose(queued(becomeImmovable),block([10,15]))),
    EndlessHunt:card(cards.R14,compose(queued(hunt),draw([0,1]))),
    WholeBodyStrength:card(cards.R05,queued(tripleBlock)),
    HeavenAndMan:card(cards.R06,compose(queued(unifyStrength),block([10,14]),queued(volibearS2Powers.exports.deployUnify))),
    HeavenAndEarth:card(cards.R07,thunder(describeAmount((v:rules.ReadView<CardUse>)=>v.get(rules.query(resources.exports.current,v.input.owner)).block,'当前格挡（不消耗格挡）'))),
    ThunderousMight:card(cards.R08,randomStorm([10,13],[5,8],4)),
    UnleashInstinct:card(cards.R12,draw(amountFormula([7,9],(maximum,v)=>{
      const battle=v.get(rules.query(battles.exports.current,v.input.battle)),piles=v.get(rules.query(cardPiles.exports.current,battle.piles));
      return maximum-v.get(rules.query(zones.exports.members,piles.hand)).length;
    },maximum=>`max(0,${maximum}−当前手牌数)`))),
  }};
}});
