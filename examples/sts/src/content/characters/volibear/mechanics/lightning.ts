import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {stormCharge} from './storm-charge.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {damage} from '../../../../rules/damage.ts';
import {entityId} from '../../../../rules/resources.schemas.ts';

export type Lightning = {battle:number;owner:number;base:number;exclude:number|null;target?:number|undefined};
export type LightningReceipt = Lightning & {amount:number;targets:number[]};
const request=z.object({battle:entityId,owner:entityId,base:z.int32().nonnegative(),exclude:entityId.nullable(),target:entityId.optional()});
const receipt=request.extend({amount:z.int32().nonnegative(),targets:z.array(entityId)});

/** Character content composed through ordinary queries, effects and events.
 * One batch is one strike, including a fully blocked strike; an empty batch is none.
 * The existing damage pipeline still owns block, prevention, limits and death.
 */
export const lightning=rules.defineRules({requires:[battles,damage,stormCharge],build(m){
  const amount=rules.defineQuery({input:request,output:z.int32().nonnegative(),dependencies:[stormCharge.exports.current],base:(r,i)=>i.base+r.query(stormCharge.exports.current,i.battle).amount});
  const settled=m.own(rules.defineEvent({payload:receipt,dispatch:'immediate'}));
  describeProgram(amount,'整批雷伤基础值');
  describeProgram(settled.public,'非空雷伤批次的全部命中请求已结算');
  const announce=m.atom({input:receipt,output:z.undefined(),reads:[],writes:[],emits:[settled],run(_r,payload){
    return {writes:[],events:[{event:settled,payload}],result:undefined};
  }});
  const resolve=rules.defineEffect<Lightning,void>(b=>{
    const targets=b.local<number[]>(),value=b.local<number>();
    return rules.sequence(
      b.assign(targets,b.read(v=>v.get(rules.query(battles.exports.targets,v.input.battle)).filter(id=>id!==v.input.exclude&&(v.input.target===undefined||id===v.input.target)))),
      rules.when(b.read(v=>v.get(targets).length===0),b.return(undefined)),
      b.assign(value,rules.query(amount,b.input)),
      rules.forEach(targets,target=>rules.call(damage.exports.hit,{
        battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target,amount:value,attack:false,selfDamage:false,
      })),
      rules.call(stormCharge.exports.noteStrike,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner)}),
      rules.call(announce,b.read(v=>({...v.input,amount:v.get(value),targets:v.get(targets)}))),
    );
  });
  const strike=rules.defineEffect<Lightning,void>(b=>rules.sequence(
    rules.call(resolve,b.input),rules.call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
  ));
  const text='独立的非攻击伤害批次，不增加攻击打出次数，不使用普通攻击力量加成；结算后触发雷击响应。';
  const chargeText='每段雷伤加当前雷势；全体雷伤也只记1次雷伤，多段分别计数。';
  return {exports:{amount,resolve,strike,settled:settled.public,text,chargeText}};
}});
