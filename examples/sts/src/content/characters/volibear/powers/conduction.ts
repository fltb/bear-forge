import {volibearCardDescriptions as descriptions} from '../cards/metadata.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {cardEffects,type CardHitReceipt} from '../../../../rules/card-effects.ts';
import {powers} from '../../../../rules/powers.ts';
import {counterPolicies,attachAbilities} from '../../../powers/utils.ts';
import {lightning} from '../mechanics/lightning.ts';

export const volibearConduction=rules.defineRules({requires:[cardEffects,powers,lightning],build(){
  const conduct=rules.on(cardEffects.exports.hitResolved,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardHitReceipt>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>
      c.event.use.owner===c.owner&&c.event.targeted&&c.event.request.attack&&c.event.request.target===c.event.use.target&&r.query(powers.exports.enabled,c.source)}),
    effect:rules.defineEffect<rules.ReactionContext<CardHitReceipt>,void>(b=>rules.call(lightning.exports.resolve,{
      battle:b.read(v=>v.input.event.use.battle),owner:b.read(v=>v.input.owner),exclude:b.read(v=>v.input.event.use.target),
      // unblocked includes overkill; lost is capped by remaining HP.
      base:b.read(v=>v.input.event.result.unblocked*v.query(powers.exports.level,v.input.source)),
    })),
  });
  return{exports:{StormConduction:rules.defineEntity(powers.exports.kind,{display:{name:descriptions.U02.metadata.name,text:descriptions.U02.text},...counterPolicies({bits:32,zeroIsNoop:true}),attach:attachAbilities(conduct)})}};
}});
