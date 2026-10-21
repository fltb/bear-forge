import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {resources} from '../../../../rules/resources.ts';
import {powers} from '../../../../rules/powers.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {volibearDomain} from '../mechanics/domain.ts';
import {volibearEngage} from '../mechanics/engage.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,block,compose,queued} from './programs.ts';

export const volibearDomainCards=rules.defineRules({requires:[volibearCardPrograms,volibearDomain,volibearEngage,volibearEngagePreparation,basicPowers],build(){
  const open=(turns:number|null)=>rules.defineEffect<CardUse,void>(b=>rules.call(volibearDomain.exports.open,{battle:b.read(v=>v.input.battle),turns}));
  const extend=rules.defineEffect<CardUse,void>(b=>rules.call(volibearDomain.exports.extend,{battle:b.read(v=>v.input.battle),turns:b.read(v=>v.input.state.upgraded?2:1)}));
  const face=rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(volibearCardPrograms.exports.singleTargets,b.input),target=>rules.call(volibearEngage.exports.execute,{use:b.input,target})));
  // Select the branch when this effect resolves, before opening a new domain.
  const returnToWild=rules.defineEffect<CardUse,void>(b=>rules.when(rules.query(volibearDomain.exports.active,b.read(v=>v.input.battle)),
    rules.call(resources.exports.heal,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.input.state.upgraded?9:6)}),
    rules.sequence(rules.call(open(1),b.input),rules.call(powers.exports.apply,{
      registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),
      actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,debuff:false,amount:b.read(v=>v.input.state.upgraded?3:2),
    })),
  ));
  return {exports:{
    ManifestDivinity:card(cards.C18,compose(block([10,14]),queued(open(1)))),
    OnlyCombat:card(cards.U18,compose(queued(open(1)),queued(face)),{created:registerCardAbilities(volibearEngagePreparation.exports.declaresEngage)}),
    LingeringStorm:card(cards.U19,queued(extend)),
    MyLawAlone:card(cards.R01,queued(open(null))),
    ReturnToWild:card(cards.R13,queued(returnToWild)),
  }};
}});
