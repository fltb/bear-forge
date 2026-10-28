import {cardEffects,type AttackSegment} from '../../../../rules/card-effects.ts';
import {ruleModules} from '@bear-forge/card-engine';
import {volibearNextPlayDiscount} from '../mechanics/next-play-discount.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {battles} from '../../../../rules/battles.ts';
import {powers} from '../../../../rules/powers.ts';
import {resources} from '../../../../rules/resources.ts';
import {attributes} from '../../../../rules/attributes.ts';
import {cardInstances} from '../../../../rules/card-instances.ts';
import {cardPiles} from '../../../../rules/card-piles.ts';
import {turns} from '../../../../rules/turns.ts';
import {actionQueue} from '../../../../rules/combat-actions.ts';
import type {CardUse} from '../../../../rules/card-instances.types.ts';
import type {TurnActor} from '../../../../rules/turns.types.ts';
import {basicPowers} from '../../../powers/attributes.ts';
import {describeAmounts,cardAmount,type CardAmount} from '../../../cards/shared/programs.ts';
import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {stormCharge} from '../mechanics/storm-charge.ts';
import {lightning,type LightningReceipt} from '../mechanics/lightning.ts';
import {volibearEngage,type EngageReceipt} from '../mechanics/engage.ts';
import {volibearDomain} from '../mechanics/domain.ts';
import {volibearPlayCounts,type CountedAttack} from '../mechanics/play-counts.ts';
import {volibearAttackDiscount} from '../mechanics/attack-discount.ts';
import {volibearDamageTraining} from '../mechanics/damage-training.ts';
import {volibearCardPrograms} from '../cards/programs.ts';

/** Every deployment has its own serializable counters; installing a later copy
 * never resets a previously deployed instance's once-per-turn allowance. */
export const volibearS2Powers=rules.defineRules({requires:[cardEffects,volibearNextPlayDiscount,battles,powers,resources,attributes,cardInstances,cardPiles,turns,basicPowers,stormCharge,lightning,volibearEngage,volibearDomain,volibearPlayCounts,volibearAttackDiscount,volibearDamageTraining,volibearCardPrograms],build(m){
  const schema=z.object({battle:z.int32(),owner:z.int32(),level:z.int32(),name:z.string(),text:z.string(),turn:z.int32()});
  const state=m.own(rules.defineComponent({schema:schema.nullable(),initial:()=>null}));
  const writeState=m.atom({input:z.object({entity:z.int32(),value:schema}),output:z.undefined(),reads:[],writes:[state],emits:[],run(_r,i){return{writes:[{entity:i.entity,component:state,value:i.value}],events:[],result:undefined};}});
  const get=rules.defineQuery({input:z.int32(),output:schema,reads:[state],base:(r,id)=>r.component(id,state)!});
  const fresh=(r:rules.QueryRead,source:number,battle:number)=>r.query(get,source).battle===battle&&r.query(get,source).turn!==r.query(battles.exports.status,battle).turn;
  const mark=rules.defineEffect<number,void>(b=>rules.call(writeState,{entity:b.input,value:b.read(v=>{const s=v.query(get,v.input);return{...s,turn:v.query(battles.exports.status,s.battle).turn};})}));
  const strength=rules.defineEffect<number,void>(b=>rules.call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.query(get,v.input).battle).registry),scope:b.read(v=>v.query(battles.exports.status,v.query(get,v.input).battle).scope),actor:b.read(v=>v.query(get,v.input).owner),source:b.read(v=>v.query(get,v.input).owner),definition:basicPowers.exports.Strength,debuff:false,amount:b.read(v=>v.query(get,v.input).level)}));
  const force=(level:boolean)=>rules.defineEffect<number,void>(b=>rules.call(stormCharge.exports.gain,{battle:b.read(v=>v.query(get,v.input).battle),owner:b.read(v=>v.query(get,v.input).owner),amount:level?b.read(v=>v.query(get,v.input).level):1}));
  const coupon=rules.defineEffect<number,void>(b=>rules.call(volibearAttackDiscount.exports.prepare,{battle:b.read(v=>v.query(get,v.input).battle),amount:b.read(v=>v.query(get,v.input).level)}));
  const strike=rules.defineEffect<number,void>(b=>rules.call(lightning.exports.strike,{battle:b.read(v=>v.query(get,v.input).battle),owner:b.read(v=>v.query(get,v.input).owner),base:b.read(v=>v.query(get,v.input).level),exclude:null}));
  const drawAndExtend=rules.defineEffect<number,void>(b=>rules.sequence(rules.call(cardPiles.exports.draw,{piles:b.read(v=>v.query(battles.exports.status,v.query(get,v.input).battle).piles),count:1}),rules.call(volibearDomain.exports.open,{battle:b.read(v=>v.query(get,v.input).battle),turns:1})));
  const onEngage=(effect:rules.Effect<number,void>,once=true)=>rules.on(volibearEngage.exports.completed,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<EngageReceipt>>(),output:z.boolean(),dependencies:[get,battles.exports.status],base:(r,c)=>c.event.use.owner===c.owner&&r.query(get,c.source).battle===c.event.use.battle&&(!once||fresh(r,c.source,c.event.use.battle))}),
    effect:rules.defineEffect<rules.ReactionContext<EngageReceipt>,void>(b=>rules.sequence(...(once?[rules.call(mark,b.read(v=>v.input.source))]:[]),rules.call(effect,b.read(v=>v.input.source)))),
  });
  const scars=onEngage(rules.defineEffect<number,void>(b=>rules.sequence(rules.call(strength,b.input),rules.call(force(false),b.input))));
  const fury=rules.on(volibearPlayCounts.exports.counted,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CountedAttack>>(),output:z.boolean(),dependencies:[get,battles.exports.status],base:(r,c)=>c.event.use.owner===c.owner&&c.event.ordinal===2&&fresh(r,c.source,c.event.use.battle)}),
    effect:rules.defineEffect<rules.ReactionContext<CountedAttack>,void>(b=>rules.sequence(rules.call(mark,b.read(v=>v.input.source)),rules.enqueue(rules.defineEffect<number,void>(b=>rules.sequence(rules.call(strength,b.input),rules.call(force(true),b.input))),b.read(v=>v.input.source),{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.use.battle).scope),eligible:'captured'}))),
  });
  const aftershockReward=rules.defineEffect<number,void>(b=>rules.call(resources.exports.gainEnergy,{entity:b.read(v=>v.query(get,v.input).owner),amount:1}));
  const aftershockDeploy=rules.defineEffect<number,void>(b=>rules.when(b.read(v=>v.query(stormCharge.exports.current,v.query(get,v.input).battle).strikes>=2),rules.call(aftershockReward,b.input)));
  const aftershock=rules.on(lightning.exports.settled,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<LightningReceipt>>(),output:z.boolean(),dependencies:[get,stormCharge.exports.current],base:(r,c)=>r.query(get,c.source).battle===c.event.battle&&c.event.owner===c.owner&&r.query(stormCharge.exports.current,c.event.battle).strikes%2===0}),
    effect:rules.defineEffect<rules.ReactionContext<LightningReceipt>,void>(b=>rules.call(aftershockReward,b.read(v=>v.input.source))),
  });
  const armor=rules.on(lightning.exports.settled,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<LightningReceipt>>(),output:z.boolean(),dependencies:[get],base:(r,c)=>r.query(get,c.source).battle===c.event.battle&&c.event.owner===c.owner}),
    effect:rules.defineEffect<rules.ReactionContext<LightningReceipt>,void>(b=>rules.call(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:b.read(v=>Math.max(0,v.query(attributes.exports.blockAmount,{actor:v.input.owner,base:v.query(get,v.input.source).level})))})),
  });
  const conduction=rules.on(cardEffects.exports.attackSegmentResolved,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<AttackSegment>>(),output:z.boolean(),dependencies:[get,cardInstances.exports.metadata],base:(r,c)=>r.query(get,c.source).battle===c.event.use.battle&&c.event.use.owner===c.owner&&c.event.use.triggerOnUse&&!c.event.use.purgeOnUse&&r.query(cardInstances.exports.metadata,c.event.use.card).type===0}),
    effect:rules.defineEffect<rules.ReactionContext<AttackSegment>,void>(b=>rules.call(strike,b.read(v=>v.input.source))),
  });
  const drawObserver=rules.defineEntity(cardPiles.exports.drawObserverKind,{observed:rules.defineEffect<{observer:number;piles:number;card:number},void>(b=>rules.when(b.read(v=>v.query(cardInstances.exports.metadata,v.input.card).type===0),rules.call(volibearNextPlayDiscount.exports.grant,{battle:b.read(v=>v.query(cardPiles.exports.bindings,v.input.piles).battle),card:b.read(v=>v.input.card)})))});
  const prey=rules.on(battles.exports.finished,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[get,cardInstances.exports.metadata,volibearPlayCounts.exports.count,battles.exports.status],base:(r,c)=>c.event.owner===c.owner&&c.event.target!==null&&c.event.triggerOnUse&&!c.event.purgeOnUse&&r.query(cardInstances.exports.metadata,c.event.card).type===0&&r.query(cardInstances.exports.metadata,c.event.card).variants[c.event.state.upgraded?1:0].target&&fresh(r,c.source,c.event.battle)&&r.query(volibearPlayCounts.exports.count,{battle:c.event.battle,turn:r.query(battles.exports.status,c.event.battle).turn,target:c.event.target})===2}),
    effect:rules.defineEffect<rules.ReactionContext<CardUse>,void>(b=>{const observer=b.local<number>();return rules.sequence(
      rules.call(mark,b.read(v=>v.input.source)),
      b.assign(observer,rules.spawnEntity({definition:drawObserver,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope)})),
      ruleModules.runTaskGroup(actionQueue,cardPiles.exports.drawObserved,{piles:b.read(v=>v.query(battles.exports.status,v.input.event.battle).piles),count:b.read(v=>v.query(get,v.input.source).level),observer}),
      rules.despawnEntity({entity:observer,reason:{drawCompleted:true}}),
    );}),
  });
  const poolContinues=rules.modify(battles.exports.canContinue,{condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,boolean>>(),output:z.boolean(),dependencies:[get],base:(r,c)=>r.query(get,c.source).battle===c.input}),transform:()=>true});
  const endPool=rules.on(turns.exports.playerEndPowers,{
    condition:rules.defineQuery({input:z.custom<rules.ReactionContext<TurnActor>>(),output:z.boolean(),dependencies:[get],base:(r,c)=>r.query(get,c.source).battle===c.event.battle&&c.event.actor===c.owner}),
    effect:rules.defineEffect<rules.ReactionContext<TurnActor>,void>(b=>rules.call(strike,b.read(v=>v.input.source))),
  });
  const trained=rules.defineQuery({input:z.int32(),output:z.boolean(),dependencies:[cardInstances.exports.metadata,volibearCardPrograms.exports.thunderSpell,cardInstances.exports.behaviorEntity],base:(r,card)=>r.query(cardInstances.exports.metadata,card).type===0||r.query(volibearCardPrograms.exports.thunderSpell,r.query(cardInstances.exports.behaviorEntity,card))});
  const trainThunder=rules.modify(volibearDamageTraining.exports.permanentBonus,{condition:rules.defineQuery({input:z.custom<rules.ModifierContext<number,number>>(),output:z.boolean(),dependencies:[trained],base:(r,c)=>r.query(trained,c.input)}),dependencies:[get],transform:(r,c)=>c.value+r.query(get,c.source).level});
  const trainAttack=rules.modify(attributes.exports.playerAttack,{order:attributes.exports.stages.addition,condition:rules.defineQuery({input:z.custom<rules.ModifierContext<{source:number;card:number|null},number>>(),output:z.boolean(),base:(_r,c)=>c.input.source===c.owner&&c.input.card!==null}),dependencies:[get],transform:(r,c)=>c.value+r.query(get,c.source).level});
  function deploy(name:string,text:string,level:CardAmount,abilities:rules.Ability[],after?:rules.Effect<number,void>){
    const kind=m.kind({config:z.undefined(),setup:schema,components:[state],initialize:rules.defineEffect<rules.EntityLifecycle<z.infer<typeof schema>>,void>(b=>rules.sequence(
      rules.call(writeState,{entity:b.read(v=>v.input.entity),value:b.read(v=>v.input.setup)}),
      ...abilities.map(ability=>rules.install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.owner),environment:{},lifetime:b.read(v=>v.input.scope)})),
      ...(after?[rules.call(after,b.read(v=>v.input.entity))]:[]),
    ))});
    const definition=rules.defineEntity(kind,undefined);
    return describeAmounts(rules.defineEffect<CardUse,void>(b=>rules.spawnEntity({definition,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope),setup:b.read(v=>({battle:v.input.battle,owner:v.input.owner,level:cardAmount(level,v),name,text,turn:-1}))})),[level],n=>`部署${name}（${n}）。${text}`);
  }
  const effects=rules.defineQuery({input:z.int32(),output:z.array(schema),reads:[state],base:(r,battle)=>r.entities(state).flatMap(id=>{const s=r.component(id,state);return s?.battle===battle?[s]:[];})});
  return{exports:{effects,
    deployConduction:deploy('狂雷渐起','每段普通攻击结算后，对全体造成指定雷伤；全体攻击的一段只触发一次，重演可再次触发。',[3,4],[conduction]),
    deployPrey:deploy('猎物未倒','每实例每回合首次对同一目标打出第2张单体攻击后抽1（2）张，其中攻击本回合减费1。',[1,2],[prey]),
    deployScars:deploy('战痕','每实例每回合首次迎战后，获得指定力量与1雷势。',[1,2],[scars]),
    deployFury:deploy('愈战愈烈','每实例每回合第2张实际攻击支付后、牌效前，获得指定力量及雷势。',[1,2],[fury]),
    deployAftershock:deploy('雷霆余威','每实例在本回合第2、4、6…次雷伤后获得1能量，不限触发次数；部署时本回合已有至少2次雷伤，立即获得1能量。',1,[aftershock],aftershockDeploy),
    deployArmor:deploy('雷甲','每次雷伤后，获得指定格挡。',[2,3],[armor]),
    deployWelcome:deploy('迎雷','每实例每回合首次迎战后，下一张攻击本回合减指定费用。',[1,2],[onEngage(coupon)]),
    deployLingering:deploy('风暴不散','每次迎战后抽1张牌并延长领域1轮。',1,[onEngage(drawAndExtend,false)]),
    deployPool:deploy('雷池','回合结束及每实例每回合首次迎战后，造成指定全体雷伤。',[4,6],[endPool,onEngage(strike),poolContinues]),
    deployUnify:deploy('天人合一','本战全部攻击与雷法的自身攻击、原生雷伤强化3。',3,[trainThunder,trainAttack]),
  }};
}});
