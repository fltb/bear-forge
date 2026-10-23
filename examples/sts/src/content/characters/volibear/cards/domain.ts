import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {powers} from '../../../../rules/powers.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {cardAmount,describeAmounts} from '../../../cards/shared/programs.ts';
import {describeProgram,programText} from '../../../cards/shared/program-facts.ts';
import {volibearDomain} from '../mechanics/domain.ts';
import {volibearEngage} from '../mechanics/engage.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,compose,queued} from './programs.ts';
import {openDomain,deployPower,faceTarget,conditional,ordered} from './operations.ts';

export const volibearDomainCards=rules.defineRules({requires:[volibearCardPrograms,volibearDomain,volibearEngage,volibearEngagePreparation,basicPowers],build(){
  const extension=[1,2] as const,healing=[4,6] as const,weakAmount=[2,3] as const;
  const extend=describeAmounts(rules.defineEffect<CardUse,void>(b=>rules.call(volibearDomain.exports.extend,{battle:b.read(v=>v.input.battle),turns:b.read(v=>cardAmount(extension,v))})),[extension],n=>volibearDomain.exports.describe(n));
  const face=faceTarget(),open=openDomain(1),strength=deployPower(basicPowers.exports.programs.Strength,[2,3]);
  // Select the branch when this effect resolves, before opening a new domain.
  const active=describeProgram((v:rules.ReadView<CardUse>)=>v.query(volibearDomain.exports.active,v.input.battle),'结算时已有领域，');
  const heal=describeAmounts(rules.defineEffect<CardUse,void>(b=>rules.call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>cardAmount(healing,v))})),[healing],n=>`恢复${n}生命。`);
  const returnToWild=conditional(active,ordered(heal,strength),ordered(open,strength));
  const weaken=describeAmounts(rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(battles.exports.targets,b.read(v=>v.input.battle)),target=>rules.call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),actor:target,source:b.read(v=>v.input.owner),definition:basicPowers.exports.EnemyWeak,amount:b.read(v=>cardAmount(weakAmount,v)),debuff:true}))),[weakAmount],n=>`对全体敌人施加${n}虚弱。`);
  return {exports:{
    ManifestDivinity:card(cards.C18,compose(queued(open),queued(weaken))),
    OnlyCombat:card(cards.U18,compose(queued(open),queued(face)),{created:describeProgram(registerCardAbilities(volibearEngagePreparation.exports.declaresEngage),'')}),
    LingeringStorm:card(cards.U19,queued(extend)),
    MyLawAlone:card(cards.R01,queued(openDomain(null))),
    ReturnToWild:card(cards.R13,queued(returnToWild)),
  }};
}});
