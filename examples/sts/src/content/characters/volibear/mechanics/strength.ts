import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {ironcladPowers} from '../../ironclad/powers/definitions.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';

/** Reuse the existing temporary-strength definition also used by Flex Potion
 * and Mutagenic Strength. A second independent recovery counter would make
 * Strength Reclaimed cancel only this character's temporary strength.
 */
export const volibearStrength=rules.defineRules({requires:[battles,powers,basicPowers,ironcladPowers],build(){
  const charge=rules.defineEffect<CardUse,void>(b=>{
    const amount=b.read(v=>v.input.state.upgraded?6:4);
    const common={registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
      actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),amount,
      scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope)};
    return rules.sequence(
      rules.call(powers.exports.apply,{...common,definition:basicPowers.exports.Strength,debuff:false}),
      rules.call(powers.exports.apply,{...common,definition:ironcladPowers.exports.LoseStrength,debuff:true}),
    );
  });
  const reclaim=rules.defineEffect<CardUse,void>(b=>{
    const recovery=b.local<number|null>();
    return rules.sequence(
      rules.call(powers.exports.apply,{
        registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
        actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),amount:b.read(v=>v.input.state.upgraded?3:2),
        scope:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).scope),definition:basicPowers.exports.Strength,debuff:false,
      }),
      b.assign(recovery,rules.query(powers.exports.find,{
        registry:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).registry),
        actor:b.read(v=>v.input.owner),definition:ironcladPowers.exports.LoseStrength,
      })),
      rules.when(b.read(v=>v.get(recovery)!==null),rules.call(powers.exports.deactivate,b.read(v=>v.get(recovery)!))),
    );
  });
  return {exports:{charge,reclaim}};
}});
