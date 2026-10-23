import {targetAttack,cardBlock,cardDraw,composePrograms as compose,concreteCard as card} from '../shared/programs.ts';
import {cardTargets} from '../../../rules/card-targets.ts';
import {cardEffects} from '../../../rules/card-effects.ts';
import {rules} from '../../../rules/execution.ts';
import {battles} from "../../../rules/battles.ts";
import {basicPowers} from "../../powers/attributes.ts";
const {defineRules}=rules;

/** Concrete programs share typed authoring utilities, never a name-based action dispatcher. */
export const colorlessBasicCards=defineRules({requires:[cardTargets,cardEffects,battles,basicPowers],build(){
  function attack(base:number,upgraded:number){return targetAttack([base,upgraded]);}
  function block(base:number,upgraded:number,twice=false){return cardBlock([base,upgraded],twice);}
  function draw(base:number,upgraded:number){return cardDraw([base,upgraded]);}
  return{exports:{FlashOfSteel:card('FLASH_OF_STEEL',compose(attack(3,6),draw(1,1))),
    Finesse:card('FINESSE',compose(block(2,4),draw(1,1)))}};
}});
