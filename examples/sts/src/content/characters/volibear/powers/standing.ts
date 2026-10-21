import {volibearCardDescriptions as descriptions} from '../cards/metadata.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {turns} from '../../../../rules/turns.ts';
import {counterPolicies,attachAbilities} from '../../../powers/utils.ts';
import type {PowerLifecycle} from '../../../../rules/powers.types.ts';
import type {ResourceAmount} from '../../../../rules/resources.types.ts';

/** A reset replacement, not block generation: no Dexterity, Frail or gain hook. */
export const volibearStanding=rules.defineRules({requires:[battles,powers,turns],build(){
  const deployedTurn=rules.defineComponent({schema:z.int32().nonnegative(),initial:()=>0});
  const active=rules.defineQuery({
    input:z.custom<rules.ReplacementContext<ResourceAmount>>(),output:z.boolean(),reads:[deployedTurn],
    dependencies:[powers.exports.enabled,battles.exports.forActor,battles.exports.current],
    base:(r,c)=>{
      if(c.value.entity!==c.owner||!r.query(powers.exports.enabled,c.source))return false;
      const battle=r.query(battles.exports.forActor,c.owner);
      return battle!==null&&r.query(battles.exports.current,battle).turn>r.component(c.source,deployedTurn);
    },
  });
  const retention=rules.replace(turns.exports.beforeBlockReset,{condition:active,
    effect:rules.defineEffect<rules.ReplacementContext<ResourceAmount>,rules.ReplacementResult<ResourceAmount>>(b=>b.return({
      kind:'change',value:b.read(v=>({...v.input.value,amount:Math.min(15,v.input.value.amount)})),
    })),
  });
  const Standing=rules.defineEntity(powers.exports.kind,{display:{name:descriptions.U03.metadata.name,text:descriptions.U03.text},
    ...counterPolicies({bits:32,flag:true}),
    attach:rules.defineEffect<PowerLifecycle,void>(b=>rules.sequence(
      rules.updateLocalComponent(b.read(v=>v.input.entity),deployedTurn,b.read(v=>{
        const battle=v.get(rules.query(battles.exports.forRegistry,v.input.setup.registry));
        if(battle===null)throw Error('Standing requires a battle');return v.get(rules.query(battles.exports.current,battle)).turn;
      })),
      rules.call(attachAbilities(retention),b.input),
    )),
  },{components:[deployedTurn]});
  return {exports:{Standing}};
}});
