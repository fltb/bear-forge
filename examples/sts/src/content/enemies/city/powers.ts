import {enemyCardOperations} from '../shared/card-operations.ts';
import {enemyPowerAbilities,defineDescribedEnemyPower,contribution} from '../shared/abilities.ts';
import {usedCard,ownCardCategory,queuedCard,cardBattle,hpLost,ownAttackDamagedPlayer,registryBattle} from '../shared/status-programs.ts';
import {pileCards} from '../../cards/statuses/definitions.ts';
import {rules} from '../../../rules/execution.ts';
import {powers} from '../../../rules/powers.ts';
import {battles} from '../../../rules/battles.ts';
import {counterPolicies} from '../../powers/utils.ts';
import {PS,MS} from '../../../combat-identifiers.ts';
import type {HpLost} from '../../../rules/resources.types.ts';

export const cityPowers=rules.defineRules({requires:[enemyCardOperations,powers,battles,pileCards],build(){
  const hexCard={definition:pileCards.exports.Dazed,name:'晕眩',destination:0,shuffle:true} as const;
  const woundCard={definition:pileCards.exports.Wound,name:'伤口',destination:2,shuffle:false} as const;
  const hex=usedCard({condition:ownCardCategory(false),effect:queuedCard(cardBattle(),hexCard)});
  const Hex=defineDescribedEnemyPower('妖术',{presentation:{key:PS.HEX,flag:true},...counterPolicies({bits:16,harmful:true,zeroIsNoop:true,resetWhenInactive:true})},{},enemyPowerAbilities(contribution(hex)));
  const stab=hpLost({condition:ownAttackDamagedPlayer(),effect:queuedCard(registryBattle<HpLost>('Painful Stabs needs a battle'),woundCard)});
  const PainfulStabs=defineDescribedEnemyPower('痛苦之刺',{presentation:{key:MS.PAINFUL_STABS,flag:true},...counterPolicies({bits:32,flag:true})},{},enemyPowerAbilities(contribution(stab)));
  return{exports:{Hex:Hex.definition,PainfulStabs:PainfulStabs.definition,programs:{Hex,PainfulStabs},statusTexts:{HEX:Hex.text,PAINFUL_STABS:PainfulStabs.text}}};
}});
