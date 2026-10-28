import {faceTarget} from './operations.ts';
import {powers} from '../../../../rules/powers.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {z} from 'zod';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {enemies} from '../../../../rules/enemies.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {registerCardAbilities} from '../../../cards/shared/lifecycle.ts';
import {volibearEngage} from '../mechanics/engage.ts';
import {volibearEngagePreparation} from '../mechanics/engage-preparation.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,compose,queued} from './programs.ts';

/** The two formerly optional cards now engage automatically. Existing host
 * history ports remain inert so the public composition contract stays stable. */
export function createVolibearOptionalEngageCards<W,R>(adapter:rules.ChoiceAdapter<boolean,CardUse,W,R>,requires:readonly rules.RuleModule<unknown>[]){
  return rules.defineRules({requires:[powers,basicPowers,volibearCardPrograms,volibearEngage,volibearEngagePreparation,enemies,...requires],build(m){
    const requesting=m.own(rules.defineEvent({payload:cardUseSchema,dispatch:'immediate'}));
    const selected=m.own(rules.defineEvent({payload:z.object({use:cardUseSchema,value:z.boolean()}),dispatch:'immediate'}));
    const engage=faceTarget();
    const weak=rules.defineEffect<CardUse,void>(b=>rules.forEach(rules.query(volibearCardPrograms.exports.singleTargets,b.input),target=>rules.call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),actor:target,source:b.read(v=>v.input.owner),definition:basicPowers.exports.EnemyWeak,amount:1,debuff:true})));
    describeProgram(weak,'施加1虚弱。');
    const declaration={created:describeProgram(registerCardAbilities(volibearEngagePreparation.exports.declaresEngage),'')};
    return {exports:{requesting:requesting.public,selected:selected.public,
      FirstToStrike:card(cards.C04,compose(attack([9,12]),queued(weak),queued(engage)),declaration),
      FaceTheEnemy:card(cards.C11,compose(block([8,11]),queued(engage)),declaration),
    }};
  }});
}
