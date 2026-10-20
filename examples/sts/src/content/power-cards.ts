import {rules} from '@bear-forge/card-engine';
import {battles} from '../rules/battles.ts';
import {powers} from '../rules/powers.ts';
import {basicPowers} from './basic-powers.ts';
import {drawPowers} from './draw-powers.ts';
import {additionalPowers} from './additional-powers.ts';
import {ironcladPowers} from './ironclad-powers.ts';
import {concreteCard,composePrograms,cardPower} from './combat-card-utils.ts';
import type {CardUse} from '../rules/card-instances.types.ts';
export const powerCards=rules.defineRules({requires:[ironcladPowers,drawPowers,additionalPowers],build(){
  const berserk=rules.defineEffect<CardUse,void>(b=>rules.sequence(rules.call(powers.exports.apply,{registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),actor:b.read(v=>v.input.owner),definition:ironcladPowers.exports.Berserk,amount:1,source:b.read(v=>v.input.owner),debuff:false,scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)}),rules.call(cardPower(basicPowers.exports.PlayerVulnerable,[2,1],false,true),b.input)));
  return{exports:{
    Combust:concreteCard('COMBUST',cardPower(additionalPowers.exports.Combust,[5,7])),TheBomb:concreteCard('THE_BOMB',cardPower(additionalPowers.exports.TheBomb,[40,50])),Panache:concreteCard('PANACHE',cardPower(additionalPowers.exports.Panache,[10,14])),Mayhem:concreteCard('MAYHEM',cardPower(additionalPowers.exports.Mayhem,1)),Magnetism:concreteCard('MAGNETISM',cardPower(additionalPowers.exports.Magnetism,1)),SadisticNature:concreteCard('SADISTIC_NATURE',cardPower(additionalPowers.exports.SadisticNature,[5,7])),
    Berserk:concreteCard('BERSERK',berserk),Brutality:concreteCard('BRUTALITY',cardPower(ironcladPowers.exports.Brutality,1)),Corruption:concreteCard('CORRUPTION',cardPower(ironcladPowers.exports.Corruption,1)),
    DarkEmbrace:concreteCard('DARK_EMBRACE',cardPower(drawPowers.exports.DarkEmbrace,1)),Evolve:concreteCard('EVOLVE',cardPower(drawPowers.exports.Evolve,[1,2])),FeelNoPain:concreteCard('FEEL_NO_PAIN',cardPower(drawPowers.exports.FeelNoPain,[3,4])),
    FireBreathing:concreteCard('FIRE_BREATHING',cardPower(ironcladPowers.exports.FireBreathing,[6,10])),Juggernaut:concreteCard('JUGGERNAUT',cardPower(ironcladPowers.exports.Juggernaut,[5,7])),Rupture:concreteCard('RUPTURE',cardPower(ironcladPowers.exports.Rupture,[1,2])),
    Rage:concreteCard('RAGE',cardPower(ironcladPowers.exports.Rage,[3,5])),DoubleTap:concreteCard('DOUBLE_TAP',cardPower(ironcladPowers.exports.DoubleTap,[1,2])),Flex:concreteCard('FLEX',composePrograms(cardPower(basicPowers.exports.Strength,[2,4]),cardPower(ironcladPowers.exports.LoseStrength,[2,4],false,true))),
  }};
}});
