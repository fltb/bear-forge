import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {enemies} from '../../../../rules/enemies.ts';
import {powers} from '../../../../rules/powers.ts';
import {resources} from '../../../../rules/resources.ts';
import type {EnemyActionReceipt} from '../../../../rules/enemies.types.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {counterPolicies,defineDescribedPowerWithLifecycle as defineDescribedPower,describedAbility} from '../../../powers/utils.ts';
import {volibearEngage,type EngageReceipt} from '../mechanics/engage.ts';

export const volibearEngagePowers=rules.defineRules({requires:[volibearEngage,enemies,powers,resources,basicPowers],build(){
  const triggeredTurn=rules.defineComponent({schema:z.int32().nonnegative(),initial:()=>0});
  const restore=rules.on(enemies.exports.completed,{
    order:{phase:enemies.exports.completionStages.restoration},
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<EnemyActionReceipt>>(),output:z.boolean(),dependencies:[powers.exports.enabled,battles.exports.status,resources.exports.vitality],base:(r,c)=>
      c.event.action!==null&&c.event.blockSpent>0&&r.query(powers.exports.enabled,c.source)&&r.query(battles.exports.status,c.event.action.battle).actor===c.owner&&r.query(resources.exports.vitality,c.owner).hp>0}),
    effect:rules.defineEffect<rules.ReactionContext<EnemyActionReceipt>,void>(b=>rules.call(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.input.event.blockSpent)})),
  });
  const firstAbsorption=rules.defineQuery({input:z.custom<rules.ReactionContext<EngageReceipt>>(),output:z.boolean(),reads:[triggeredTurn],dependencies:[powers.exports.enabled,battles.exports.status,resources.exports.vitality],base:(r,c)=>
    c.event.use.owner===c.owner&&c.event.action.absorbed>0&&r.query(powers.exports.enabled,c.source)&&r.query(resources.exports.vitality,c.owner).hp>0&&r.component(c.source,triggeredTurn)!==r.query(battles.exports.status,c.event.use.battle).turn});
  const consume=rules.defineEffect<rules.ReactionContext<EngageReceipt>,void>(b=>rules.updateLocalComponent(b.read(v=>v.input.source),triggeredTurn,b.read(v=>v.query(battles.exports.status,v.input.event.use.battle).turn)));
  const scar=rules.on(volibearEngage.exports.completed,{condition:firstAbsorption,effect:rules.defineEffect<rules.ReactionContext<EngageReceipt>,void>(b=>rules.sequence(
    rules.call(consume,b.input),rules.call(powers.exports.apply,{
      registry:b.read(v=>v.query(battles.exports.status,v.input.event.use.battle).registry),scope:b.read(v=>v.query(battles.exports.status,v.input.event.use.battle).scope),
      actor:b.read(v=>v.input.owner),source:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,debuff:false,amount:b.read(v=>v.query(powers.exports.level,v.input.source)),
    }),
  ))});
  const grow=rules.on(volibearEngage.exports.completed,{condition:firstAbsorption,effect:rules.defineEffect<rules.ReactionContext<EngageReceipt>,void>(b=>rules.sequence(
    rules.call(consume,b.input),rules.call(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>v.input.event.action.absorbed*v.query(powers.exports.level,v.input.source))}),
  ))});
  const ThunderForged=defineDescribedPower('雷霆铸躯',counterPolicies({bits:32,flag:true}),{display:true},describedAbility('敌人完整行动结束且自身存活时，恢复该次行动中攻击实际消耗的格挡；重复获得此状态不重复恢复。',restore));
  const BattleScars=defineDescribedPower('战痕',counterPolicies({bits:32,zeroIsNoop:true}),{display:true,components:[triggeredTurn]},describedAbility('每回合首次迎战实际吸收伤害且自身存活后，按层数获得力量；未吸收不消耗机会。',scar));
  const EndlessBattle=defineDescribedPower('战无止境',counterPolicies({bits:32,zeroIsNoop:true}),{display:true,components:[triggeredTurn]},describedAbility('每回合首次迎战实际吸收伤害且自身存活后，获得吸收量乘层数的格挡；未吸收不消耗机会。',grow));
  return {exports:{ThunderForged:ThunderForged.definition,BattleScars:BattleScars.definition,EndlessBattle:EndlessBattle.definition,programs:{ThunderForged,BattleScars,EndlessBattle},statusTexts:{ThunderForged:ThunderForged.text,BattleScars:BattleScars.text,EndlessBattle:EndlessBattle.text}}};
}});
