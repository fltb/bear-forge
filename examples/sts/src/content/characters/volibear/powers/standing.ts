import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {powerMergeSchema,powerMutableSchema} from '../../../../rules/powers.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {turns} from '../../../../rules/turns.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle,describedAbility} from '../../../powers/utils.ts';
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
      kind:'change',value:b.read(v=>({...v.input.value,amount:Math.min(v.query(powers.exports.level,v.input.source),v.input.value.amount)})),
    })),
  });
  const Standing=defineDescribedPowerWithLifecycle('屹立',{
    ...counterPolicies({bits:32}),
    merge:rules.defineQuery({input:powerMergeSchema,output:powerMutableSchema,base:(_r,{state,change})=>({level:Math.min(state.level,change.amount),active:true,justApplied:false})}),
  },{display:true,components:[deployedTurn],attach:describeProgram((abilities:rules.Effect<PowerLifecycle,void>)=>rules.defineEffect<PowerLifecycle,void>(b=>rules.sequence(
      rules.updateLocalComponent(b.read(v=>v.input.entity),deployedTurn,b.read(v=>{
        const battle=v.get(rules.query(battles.exports.forRegistry,v.input.setup.registry));
        if(battle===null)throw Error('Standing requires a battle');return v.get(rules.query(battles.exports.current,battle)).turn;
      })),
      rules.call(abilities,b.input),
    )),'部署时记录当前战斗回合，再安装能力响应。'),
  },describedAbility('从部署后的回合开始，将格挡重置的损耗替换为层数与当前格挡中的较小值；重复获得取较低层数。这不是获得格挡，不触发敏捷、脆弱或格挡获得响应。',retention));
  return {exports:{Standing:Standing.definition,programs:{Standing},statusTexts:{Standing:Standing.text}}};
}});
