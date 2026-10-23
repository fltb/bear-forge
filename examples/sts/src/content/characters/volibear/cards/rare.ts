import {deployPower,amountFormula} from './operations.ts';
import {describeProgram,describeAmount,amountText} from '../../../cards/shared/program-facts.ts';
import {cardAmount,describeAmounts} from '../../../cards/shared/programs.ts';
import {volibearStormSelf} from '../powers/storm-self.ts';
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
import {volibearInscription} from '../powers/inscription.ts';
import {volibearHunt} from '../powers/hunt.ts';
import {volibearImmovable} from '../powers/immovable.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,thunder,compose,queued,draw} from './programs.ts';

export const volibearRareCards=rules.defineRules({requires:[volibearStormSelf,volibearBattleBody,volibearCardPrograms,volibearTraining,basicPowers,volibearInscription,volibearHunt,volibearImmovable],build(){
  const becomeImmovable=deployPower(volibearImmovable.exports.programs.ImmovableBody,1);
  const hunt=deployPower(volibearHunt.exports.programs.EndlessHunt,1);
  const inscribe=deployPower(volibearInscription.exports.programs.ThunderInscription,[4,6]);
  const unifyStrength=deployPower(basicPowers.exports.programs.Strength,[3,4]);
  const handGrowth=[3,4] as const;
  const trainHand=rules.defineEffect<CardUse,void>(b=>rules.forEach(b.read(v=>{
    const piles=v.get(rules.query(cardPiles.exports.current,v.get(rules.query(battles.exports.current,v.input.battle)).piles));
    return v.get(rules.query(zones.exports.members,piles.hand)).filter(id=>v.get(rules.query(volibearTraining.exports.eligible,id)));
  }),card=>rules.call(volibearTraining.exports.add,{battle:b.read(v=>v.input.battle),card,amount:b.read(v=>cardAmount(handGrowth,v))})));
  describeAmounts(trainHand,[handGrowth],n=>`手牌中所有固定伤害攻击：${volibearTraining.exports.describe(n)}`);
  const blockMultiplier=2;
  const tripleBlock=rules.defineEffect<CardUse,void>(b=>rules.call(cardEffects.exports.gainBlock,{
    use:b.input,amount:b.read(v=>blockMultiplier*v.get(rules.query(resources.exports.current,v.input.owner)).block),
  }));
  describeProgram(tripleBlock,`额外获得当前格挡×${blockMultiplier}的格挡，不重复计算敏捷或脆弱。`);
  const upgradedBlock=8;
  const battleBody=deployPower(volibearBattleBody.exports.programs.BattleBody,1);
  const stormSelf=deployPower(volibearStormSelf.exports.programs.StormIsMe,1);
  return {exports:{
    StormIsMe:card(cards.R15,compose(queued(stormSelf),draw([0,2]))),
    BattleBody:card(cards.R16,compose(queued(battleBody),describeAmounts(rules.defineEffect<CardUse,void>(b=>rules.when(b.read(v=>v.input.state.upgraded),rules.call(block(upgradedBlock),b.input))),[upgradedBlock],n=>`升级后获得${n}格挡。`))),
    ImmovableBody:card(cards.R02,compose(queued(becomeImmovable),block([6,12]))),
    ThunderInscription:card(cards.R04,queued(inscribe)),
    EndlessHunt:card(cards.R14,compose(queued(hunt),draw([0,1]))),
    WholeBodyStrength:card(cards.R05,queued(tripleBlock)),
    HeavenAndMan:card(cards.R06,compose(queued(unifyStrength),block([10,14]),queued(trainHand))),
    HeavenAndEarth:card(cards.R07,thunder(describeAmount((v:rules.ReadView<CardUse>)=>v.get(rules.query(resources.exports.current,v.input.owner)).block,'当前格挡（不消耗格挡）'))),
    ThunderousMight:card(cards.R08,compose(attack([10,13],4),thunder([5,8]))),
    UnleashInstinct:card(cards.R12,draw(amountFormula([7,9],(maximum,v)=>{
      const battle=v.get(rules.query(battles.exports.current,v.input.battle)),piles=v.get(rules.query(cardPiles.exports.current,battle.piles));
      return maximum-v.get(rules.query(zones.exports.members,piles.hand)).length;
    },maximum=>`max(0,${maximum}−当前手牌数)`))),
  }};
}});
