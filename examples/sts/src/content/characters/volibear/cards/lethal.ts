import {rules} from '../../../../rules/execution.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,compose} from './programs.ts';
import {nativeThunder} from './s2-operations.ts';
export const volibearLethalCards=rules.defineRules({requires:[volibearCardPrograms],build(){return{exports:{BloodBattle:card(cards.U24,compose(attack([21,28]),nativeThunder(3,false,true)))}};}});
