import {cardTargets} from '../../../rules/card-targets.ts';
import {colorlessAdditionalPowers} from "./power-effects.ts";
import {rules} from '../../../rules/execution.ts';
import {ironcladPowers} from "../../characters/ironclad/powers/definitions.ts";
import {concreteCard,cardPower} from "../shared/programs.ts";

export const colorlessPowerCards=rules.defineRules({requires:[cardTargets,ironcladPowers,colorlessAdditionalPowers],build(){

  return{exports:{TheBomb:concreteCard('THE_BOMB',cardPower(colorlessAdditionalPowers.exports.programs.TheBomb,[40,50])),
    Panache:concreteCard('PANACHE',cardPower(colorlessAdditionalPowers.exports.programs.Panache,[10,14])),
    Mayhem:concreteCard('MAYHEM',cardPower(colorlessAdditionalPowers.exports.programs.Mayhem,1)),
    Magnetism:concreteCard('MAGNETISM',cardPower(colorlessAdditionalPowers.exports.programs.Magnetism,1)),
    SadisticNature:concreteCard('SADISTIC_NATURE',cardPower(colorlessAdditionalPowers.exports.programs.SadisticNature,[5,7]))}};
}});
