import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {battles} from '../../../../rules/battles.ts';
import {enemies} from '../../../../rules/enemies.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import {cardUseSchema} from '../../../../rules/card-instances.schemas.ts';
import {enemyActionReceiptSchema} from '../../../../rules/enemies.schemas.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import type {EnemyActionReceipt} from '../../../../rules/enemies.types.ts';

export type EngageReceipt={use:CardUse;target:number;action:EnemyActionReceipt};
const receiptSchema=z.object({use:cardUseSchema,target:z.int32().nonnegative(),action:enemyActionReceiptSchema});
export const volibearEngage=rules.defineRules({requires:[enemies,battles],build(m){
  const completed=m.own(rules.defineEvent({payload:receiptSchema,dispatch:'immediate'}));
  const announce=m.atom({input:receiptSchema,output:z.undefined(),reads:[],writes:[],emits:[completed],run(_r,payload){return{writes:[],events:[{event:completed,payload}],result:undefined};}});
  const notify=rules.defineEffect<EngageReceipt,void>(b=>rules.call(announce,b.input));
  const execute=rules.defineEffect<{use:CardUse;target:number},EnemyActionReceipt>(b=>{
    const controller=b.local<number|null>(),result=b.local<EnemyActionReceipt>();
    return rules.sequence(
      b.assign(result,{action:null,performed:false,absorbed:0,blockSpent:0}),
      rules.when(b.read(v=>v.query(battles.exports.status,v.input.use.battle).outcome!==0),b.return(result)),
      b.assign(controller,rules.query(enemies.exports.forActor,b.read(v=>v.input.target))),
      rules.when(b.read(v=>v.get(controller)===null),b.return(result)),
      rules.when(b.read(v=>v.query(enemies.exports.current,v.get(controller)!).battle!==v.input.use.battle),b.return(b.read(()=>{throw Error('Engage target belongs to another battle');}))),
      b.assign(result,rules.call(enemies.exports.takeTurnDetailed,b.read(v=>v.get(controller)!))),
      rules.when(b.read(v=>v.get(result).performed&&v.query(battles.exports.status,v.input.use.battle).outcome===0),
        ruleModules.runTaskGroup(actionQueue,notify,{use:b.read(v=>v.input.use),target:b.read(v=>v.input.target),action:result})),
      b.return(result),
    );
  });
  const text='立即通过正常敌人行动入口让指定敌人使用本轮行动机会；已用过机会不再行动，正常敌人阶段跳过。本次实际行动且战斗未结束后才派发迎战完成响应。';
  return {exports:{execute,completed:completed.public,text}};
}});
