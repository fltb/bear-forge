import {rules} from '../../../../rules/execution.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,compose} from './programs.ts';

export const volibearBasicCards=rules.defineRules({requires:[volibearCardPrograms],build(){
  return {exports:{
    Strike:card(cards.B01,attack([6,9])),
    Defend:card(cards.B02,block([5,8])),
    ThunderClaw:card(cards.B03,compose(attack([7,9]),block([4,6]))),
  }};
}});
