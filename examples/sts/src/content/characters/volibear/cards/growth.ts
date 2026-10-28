import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import {describeProgram,describeAmount,registerAmountBase} from '../../../cards/shared/program-facts.ts';
import {cardAmount} from '../../../cards/shared/programs.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {volibearCardDescriptions as cards} from './metadata.ts';
import {volibearCardPrograms,card,attack,block,compose,type CardHitReceipt} from './programs.ts';

export const volibearGrowthCards=rules.defineRules({requires:[battles,stormCharge,volibearCardPrograms],build(m){
  const markSchema=z.object({battle:z.int32(),owner:z.int32(),target:z.int32(),firstPlay:z.int32()});
  const mark=m.own(rules.defineComponent({schema:markSchema.nullable(),initial:()=>null}));
  const writeState=m.atom({input:z.object({entity:z.int32(),value:markSchema}),output:z.undefined(),reads:[],writes:[mark],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:mark,value:i.value}],events:[],result:undefined};}});
  const marked=rules.defineQuery({input:z.object({battle:z.int32(),owner:z.int32(),target:z.int32(),play:z.int32()}),output:z.boolean(),reads:[mark],base:(r,i)=>r.entities(mark).some(id=>{const s=r.component(id,mark);return s!==null&&s.battle===i.battle&&s.owner===i.owner&&s.target===i.target&&s.firstPlay!==i.play;})});
  const kind=m.kind({config:z.undefined(),setup:markSchema,components:[mark],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof markSchema>>,void>(b=>rules.call(writeState,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}))});
  const definition=rules.defineEntity(kind,undefined);
  const bite=describeProgram(rules.defineEffect<CardHitReceipt,void>(b=>rules.spawnEntity({definition,owner:b.read(v=>v.input.use.owner),scope:b.read(v=>v.query(battles.exports.status,v.input.use.battle).scope),setup:b.read(v=>({battle:v.input.use.battle,owner:v.input.use.owner,target:v.input.target,firstPlay:v.input.use.play}))})),'实际普通攻击命中后施加咬痕（完全格挡和致死也登记）；同次重演读取出牌前的标记。');
  const biteAmount=registerAmountBase(describeAmount((v:rules.ReadView<CardUse>)=>cardAmount([10,14],v)+(v.input.target!==null&&v.query(marked,{battle:v.input.battle,owner:v.input.owner,target:v.input.target,play:v.input.play})?cardAmount([6,9],v):0),'10（14）＋出牌前有咬痕时6（9）'),[10,14]);
  return{exports:{marked,
    NeverLetGo:card(cards.U08,compose(block([6,9]),attack(biteAmount,1,false,true,bite))),
    TemperingClaw:card(cards.U27,compose(attack([8,11]),block(describeAmount((v:rules.ReadView<CardUse>)=>2*v.query(stormCharge.exports.current,v.input.battle).strikes,'本回合雷伤次数×2')))),
  }};
}});
