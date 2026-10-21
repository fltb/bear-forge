import {cardTargets} from '../../../../rules/card-targets.ts';
import {ironcladDrawPowers} from "../powers/draw.ts";
import {ironcladAdditionalPowers} from "../powers/combust.ts";
import {rules} from '../../../../rules/execution.ts';
import {battles} from "../../../../rules/battles.ts";
import {powers} from "../../../../rules/powers.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {ironcladPowers} from "../powers/definitions.ts";
import {concreteCard,composePrograms,cardPower} from "../../../cards/shared/programs.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
export const powerCards=rules.defineRules({requires:[cardTargets,ironcladPowers,ironcladDrawPowers,ironcladAdditionalPowers],build(){
  const berserk=rules.defineEffect<CardUse,void>(b=>rules.sequence(rules.call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.owner),definition:ironcladPowers.exports.Berserk,amount:1,source:b.read(v=>v.input.owner),debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)}),rules.call(cardPower(basicPowers.exports.PlayerVulnerable,[2,1],false,true),b.input)));
  return{exports:{Combust:concreteCard('COMBUST',cardPower(ironcladAdditionalPowers.exports.Combust,[5,7])),
    Berserk:concreteCard('BERSERK',berserk),
    Brutality:concreteCard('BRUTALITY',cardPower(ironcladPowers.exports.Brutality,1)),
    Corruption:concreteCard('CORRUPTION',cardPower(ironcladPowers.exports.Corruption,1)),
    DarkEmbrace:concreteCard('DARK_EMBRACE',cardPower(ironcladDrawPowers.exports.DarkEmbrace,1)),
    Evolve:concreteCard('EVOLVE',cardPower(ironcladDrawPowers.exports.Evolve,[1,2])),
    FeelNoPain:concreteCard('FEEL_NO_PAIN',cardPower(ironcladDrawPowers.exports.FeelNoPain,[3,4])),
    FireBreathing:concreteCard('FIRE_BREATHING',cardPower(ironcladPowers.exports.FireBreathing,[6,10])),
    Juggernaut:concreteCard('JUGGERNAUT',cardPower(ironcladPowers.exports.Juggernaut,[5,7])),
    Rupture:concreteCard('RUPTURE',cardPower(ironcladPowers.exports.Rupture,[1,2])),
    Rage:concreteCard('RAGE',cardPower(ironcladPowers.exports.Rage,[3,5])),
    DoubleTap:concreteCard('DOUBLE_TAP',cardPower(ironcladPowers.exports.DoubleTap,[1,2])),
    Flex:concreteCard('FLEX',composePrograms(cardPower(basicPowers.exports.Strength,[2,4]),cardPower(ironcladPowers.exports.LoseStrength,[2,4],false,true)))}};
}});
