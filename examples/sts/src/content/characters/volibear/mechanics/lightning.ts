import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {stormCharge} from './storm-charge.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {damage} from '../../../../rules/damage.ts';
import {entityId} from '../../../../rules/resources.schemas.ts';

export type Lightning = {battle:number;owner:number;base:number;exclude:number|null;release?:boolean|undefined;target?:number|undefined};
export type LightningReceipt = Lightning & {amount:number;targets:number[]};
const request=z.object({battle:entityId,owner:entityId,base:z.int32().nonnegative(),exclude:entityId.nullable(),release:z.boolean().optional(),target:entityId.optional()});
const receipt=request.extend({amount:z.int32().nonnegative(),targets:z.array(entityId)});

/** Character content composed through ordinary queries, effects and events.
 * One batch is one strike, including a fully blocked strike; an empty batch is none.
 * The existing damage pipeline still owns block, prevention, limits and death.
 */
export const lightning=rules.defineRules({requires:[battles,damage,stormCharge],build(m){
  const chargeCost=1,chargeBonus=3;
  const amount=rules.defineQuery({input:request,output:z.int32().nonnegative(),base:(_r,i)=>i.base});
  const settled=m.own(rules.defineEvent({payload:receipt,dispatch:'immediate'}));
  describeProgram(amount,'整批雷伤基础值');
  describeProgram(settled.public,'非空雷伤批次的全部命中请求已结算');
  const announce=m.atom({input:receipt,output:z.undefined(),reads:[],writes:[],emits:[settled],run(_r,payload){
    return {writes:[],events:[{event:settled,payload}],result:undefined};
  }});
  const resolve=rules.defineEffect<Lightning,void>(b=>{
    const targets=b.local<number[]>(),value=b.local<number>(),charged=b.local<number>();
    return rules.sequence(
      b.assign(targets,b.read(v=>v.get(rules.query(battles.exports.targets,v.input.battle)).filter(id=>id!==v.input.exclude&&(v.input.target===undefined||id===v.input.target)))),
      rules.when(b.read(v=>v.get(targets).length===0),b.return(undefined)),
      b.assign(value,rules.query(amount,b.input)),
      b.assign(charged,0),
      rules.when(b.read(v=>v.input.release!==false),b.assign(charged,rules.call(stormCharge.exports.consume,{battle:b.read(v=>v.input.battle),owner:b.read(v=>v.input.owner),amount:chargeCost}))),
      b.assign(value,b.read(v=>v.get(value)+chargeBonus*v.get(charged))),
      rules.forEach(targets,target=>rules.call(damage.exports.hit,{
        battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.owner),target,amount:value,attack:false,selfDamage:false,
      })),
      rules.call(announce,b.read(v=>({...v.input,amount:v.get(value),targets:v.get(targets)}))),
    );
  });
  const strike=rules.defineEffect<Lightning,void>(b=>rules.sequence(
    rules.call(resolve,b.input),rules.call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
  ));
  const text='独立的非攻击伤害批次，不增加攻击打出次数，不使用普通攻击力量加成；结算后触发雷击响应。';
  const chargeText=`每批雷伤有存活目标且未禁用自动释放时，消耗${chargeCost}蓄雷，使整批伤害增加${chargeBonus}；群体只消费一次，多批分别消费。`;
  return {exports:{amount,resolve,strike,settled:settled.public,text,chargeText}};
}});
