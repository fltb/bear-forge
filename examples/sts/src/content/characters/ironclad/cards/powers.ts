import {describeProgram,inheritPrograms} from '../../../cards/shared/program-facts.ts';
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
  const berserkAmount=1,berserkPower=ironcladPowers.exports.programs.Berserk;
  const berserkGain=describeProgram(rules.defineEffect<CardUse,void>(b=>rules.call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.owner),definition:berserkPower.definition,amount:berserkAmount,source:b.read(v=>v.input.owner),debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),`获得${berserkAmount}层${berserkPower.name}。${berserkPower.text}`);
  const berserk=composePrograms(berserkGain,cardPower(basicPowers.exports.programs.PlayerVulnerable,[2,1],false,true));
  return{exports:{Combust:concreteCard('COMBUST',cardPower(ironcladAdditionalPowers.exports.programs.Combust,[5,7])),
    Berserk:concreteCard('BERSERK',berserk),
    Brutality:concreteCard('BRUTALITY',cardPower(ironcladPowers.exports.programs.Brutality,1)),
    Corruption:concreteCard('CORRUPTION',cardPower(ironcladPowers.exports.programs.Corruption,1)),
    DarkEmbrace:concreteCard('DARK_EMBRACE',cardPower(ironcladDrawPowers.exports.programs.DarkEmbrace,1)),
    Evolve:concreteCard('EVOLVE',cardPower(ironcladDrawPowers.exports.programs.Evolve,[1,2])),
    FeelNoPain:concreteCard('FEEL_NO_PAIN',cardPower(ironcladDrawPowers.exports.programs.FeelNoPain,[3,4])),
    FireBreathing:concreteCard('FIRE_BREATHING',cardPower(ironcladPowers.exports.programs.FireBreathing,[6,10])),
    Juggernaut:concreteCard('JUGGERNAUT',cardPower(ironcladPowers.exports.programs.Juggernaut,[5,7])),
    Rupture:concreteCard('RUPTURE',cardPower(ironcladPowers.exports.programs.Rupture,[1,2])),
    Rage:concreteCard('RAGE',cardPower(ironcladPowers.exports.programs.Rage,[3,5])),
    DoubleTap:concreteCard('DOUBLE_TAP',cardPower(ironcladPowers.exports.programs.DoubleTap,[1,2])),
    Flex:concreteCard('FLEX',composePrograms(cardPower(basicPowers.exports.programs.Strength,[2,4]),cardPower(ironcladPowers.exports.programs.LoseStrength,[2,4],false,true)))}};
}});
