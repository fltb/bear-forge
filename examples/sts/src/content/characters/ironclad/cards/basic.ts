import {targetAttack,cardPower,cardBlock,cardDraw,cardEnergy,type DescribedPower,composePrograms as compose,concreteCard as card} from '../../../cards/shared/programs.ts';
import {cardTargets} from '../../../../rules/card-targets.ts';
import {cardEffects} from '../../../../rules/card-effects.ts';
import {drawPowers} from "../../../powers/draw.ts";
import {turnPowers} from "../powers/turn.ts";
import {rules} from '../../../../rules/execution.ts';
import {battles} from "../../../../rules/battles.ts";
import {resources} from "../../../../rules/resources.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import type {CardUse} from "../../../../rules/card-instances.types.ts";
import type {PowerDefinition} from "../../../../rules/powers.types.ts";
const {defineRules,defineEffect,enqueue}=rules;

/** Concrete programs share typed authoring utilities, never a name-based action dispatcher. */
export const basicCards=defineRules({requires:[cardTargets,cardEffects,battles,basicPowers,drawPowers,turnPowers],build(){
  function attack(base:number,upgraded:number){return targetAttack([base,upgraded]);}
  function block(base:number,upgraded:number){return cardBlock([base,upgraded]);}
  function power(definition:DescribedPower,base:number,upgraded:number,targeted=false,debuff=false){return cardPower(definition,[base,upgraded],targeted,debuff);}
  function draw(base:number,upgraded:number){return cardDraw([base,upgraded]);}
  return{exports:{StrikeRed:card('STRIKE_RED',attack(6,9)),
    DefendRed:card('DEFEND_RED',block(5,8)),
    Bash:card('BASH',compose(attack(8,10),power(basicPowers.exports.programs.EnemyVulnerable,2,3,true,true))),
    DemonForm:card('DEMON_FORM',power(turnPowers.exports.programs.DemonForm,2,3)),
    Inflame:card('INFLAME',power(basicPowers.exports.programs.Strength,2,3)),
    BattleTrance:card('BATTLE_TRANCE',compose(draw(3,4),power(drawPowers.exports.programs.NoDraw,1,1,false,true))),
    PommelStrike:card('POMMEL_STRIKE',compose(attack(9,10),draw(1,2))),
    ShrugItOff:card('SHRUG_IT_OFF',compose(block(8,11),draw(1,1))),
    IronWave:card('IRON_WAVE',compose(block(5,7),attack(5,7))),
    SeeingRed:card('SEEING_RED',cardEnergy(2))}};
}});
