import {describeProgram} from '../../../rules/program-descriptions.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {areaDamage} from '../../shared/area-damage.ts';
import {combatPrivate,observeCounter} from "../../../program/combat-state.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {powers} from "../../../rules/powers.ts";
import {battles} from "../../../rules/battles.ts";
import {turns} from "../../../rules/turns.ts";
import {resources} from "../../../rules/resources.ts";
import {combatGeneration} from "../../../program/card-generation.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {counterPolicies,attachAbilities,defineDescribedPower,defineDescribedPowerWithLifecycle,describedAbility,powerDescription} from "../../powers/utils.ts";
import {ownsTurn} from "../../powers/turn-hooks.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {PS} from "../../../combat-identifiers.ts";
import type {TurnActor} from "../../../rules/turns.types.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {PowerApplication,PowerMerged,PowerLifecycle} from "../../../rules/powers.types.ts";
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,when,forEach,call,query,enqueue,on,modify,updateLocalComponent,readComponent}=rules;
export const colorlessAdditionalPowers=defineRules({requires:[areaDamage,combatPrivate,powers,battles,turns,combatGeneration,basicPowers],build(){
  const damageAll=areaDamage.exports.hit;
  const bombSlots:[number,number,number]=[0,0,0];
  const bombPriority=-1,bombNarrowShift=24;
  const bombCountdown=defineComponent({schema:z.tuple([z.int32(),z.int32(),z.int32()]),initial:()=>[...bombSlots] as [number,number,number]});
  const bombTick=on(turns.exports.playerEndPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:bombPriority},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>{const amount=b.local<number>();return sequence(b.assign(amount,b.read(v=>v.get(readComponent(v.input.source,bombCountdown))[0])),updateLocalComponent(b.read(v=>v.input.source),bombCountdown,n=>[n[1],n[2],0] as [number,number,number]),when(b.read(v=>v.get(amount)!==0),enqueue(damageAll,{battle:b.read(v=>v.input.event.battle),actor:b.read(v=>v.input.owner),amount},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'})));})});
  const bombContinue=modify(battles.exports.canContinue,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),reads:[bombCountdown],dependencies:[battles.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,c.input).actor===c.owner&&r.component(c.source,bombCountdown).some(n=>n!==0)}),transform:()=>true});
  const bombMerged=describeProgram(defineEffect<PowerMerged,void>(b=>updateLocalComponent(b.read(v=>v.input.entity),bombCountdown,b.read(v=>{const old=v.get(readComponent(v.input.entity,bombCountdown));return[old[0],old[1],((old[2]+v.input.change.amount)<<bombNarrowShift)>>bombNarrowShift] as [number,number,number];}))),`叠加时将新增层数累加至${bombSlots.length}回合后的槽位，按${32-bombNarrowShift}位有符号整数保存。`);
  const bombAttach=describeProgram((abilities:rules.Effect<PowerLifecycle,void>)=>defineEffect<PowerLifecycle,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.entity),bombCountdown,b.read(v=>[bombSlots[0],bombSlots[1],(v.input.setup.amount<<bombNarrowShift)>>bombNarrowShift] as [number,number,number])),call(abilities,b.input))),`首次附着将施加层数按${32-bombNarrowShift}位有符号整数记录到${bombSlots.length}回合后的槽位，其余槽位保持初始值，然后安装能力。`);
  const TheBombProgram=defineDescribedPowerWithLifecycle('炸弹',{...counterPolicies({bits:16,zeroIsNoop:true}),merged:bombMerged},{components:[bombCountdown],attach:bombAttach},
    describedAbility(`自身回合结束的能力阶段，以优先级${bombPriority}推进倒计时；取出到期槽位，非零时排队对全体敌人造成记录值的非攻击伤害。`,bombTick),
    describedAbility('公开炸弹倒计时槽位。',observeCounter('bombs',bombCountdown)),
    describedAbility('自身战斗中倒计时存在非零槽位时允许战斗继续。',bombContinue));
  const TheBomb=TheBombProgram.definition;
  const panacheInitial=0,panacheThreshold=5,panacheDecrement=1,panacheTrigger=0;
  const panacheCount=defineComponent({schema:z.int32(),initial:()=>panacheInitial});
  const panache=on(battles.exports.used,{condition:defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.owner===c.owner&&r.query(powers.exports.enabled,c.source)}),effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.source),panacheCount,n=>n-panacheDecrement),when(b.read(v=>v.get(readComponent(v.input.source,panacheCount))<=panacheTrigger),enqueue(damageAll,{battle:b.read(v=>v.input.event.battle),actor:b.read(v=>v.input.owner),amount:query(powers.exports.level,b.read(v=>v.input.source))},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'}))))});
  const resetPanache=on(turns.exports.playerPostDrawPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.PANACHE},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),panacheCount,panacheThreshold))});
  const PanacheProgram=defineDescribedPowerWithLifecycle('神气制胜',{presentation:{key:PS.PANACHE,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true})},{components:[panacheCount]},
    describedAbility(`计数初始为${panacheInitial}；状态生效时，自身每打出一张牌计数减${panacheDecrement}，减至${panacheTrigger}及以下时对全体敌人造成等同层数的非攻击伤害。`,panache),
    describedAbility(`自身每回合抽牌后将计数重置为${panacheThreshold}。`,resetPanache),
    describedAbility('公开神气制胜计数。',observeCounter('panacheCounter',panacheCount)));
  const Panache=PanacheProgram.definition;
  const mayhem=on(turns.exports.playerStartPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.MAYHEM},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>{const target=b.local<number|null>();return forEach(b.read(v=>Array.from({length:v.query(powers.exports.level,v.input.source)},(_,index)=>index)),()=>sequence(b.assign(target,call(combatGeneration.exports.randomTarget,b.read(v=>v.input.event.battle))),enqueue(combatGeneration.exports.playTop,{battle:b.read(v=>v.input.event.battle),target,exhaust:false},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'})));})});
  const MayhemProgram=defineDescribedPower('混乱',{presentation:{key:PS.MAYHEM,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true})},describedAbility('每回合开始时，按层数次随机选择目标并打出抽牌堆顶的牌，不强制消耗。',mayhem));
  const Mayhem=MayhemProgram.definition;
  const magnetismAttach=describeProgram(attachAbilities(),'此状态当前未装配实际效果。');
  const Magnetism=defineEntity(powers.exports.kind,{presentation:{key:PS.MAGNETISM,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),attach:magnetismAttach});
  const MagnetismProgram=Object.freeze({name:'磁力',definition:Magnetism,...powerDescription([],magnetismAttach)});
  const sadistic=on(powers.exports.applied,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number;application:PowerApplication}>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.current,resources.exports.side],base:(r,c)=>c.event.application.registry===r.query(powers.exports.current,c.source).registry&&c.event.application.debuff&&r.query(resources.exports.side,c.event.application.actor)===1&&r.query(powers.exports.enabled,c.source)}),effect:defineEffect<rules.ReactionContext<{entity:number;application:PowerApplication}>,void>(b=>enqueue(battles.exports.hit,{battle:b.read(v=>{const id=v.query(battles.exports.forRegistry,v.input.event.application.registry);if(id===null)throw Error('Sadistic Nature needs a battle');return id;}),source:b.read(v=>v.input.owner),target:b.read(v=>v.input.event.application.actor),amount:query(powers.exports.level,b.read(v=>v.input.source)),attack:false,selfDamage:false},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>{const id=v.query(battles.exports.forRegistry,v.input.event.application.registry);if(id===null)throw Error('Sadistic Nature needs a battle');return v.query(battles.exports.status,id).actionScope;}),eligible:'captured'}))});
  const SadisticNatureProgram=defineDescribedPower('虐杀本性',{presentation:{key:PS.SADISTIC,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true})},describedAbility('同一战斗中敌人实际获得负面状态时，对该敌人造成等同层数的非攻击伤害。',sadistic));
  const SadisticNature=SadisticNatureProgram.definition;
  const programs={TheBomb:TheBombProgram,Panache:PanacheProgram,Mayhem:MayhemProgram,Magnetism:MagnetismProgram,SadisticNature:SadisticNatureProgram};
  const statusTexts={THE_BOMB:TheBombProgram.text,PANACHE:PanacheProgram.text,MAYHEM:MayhemProgram.text,MAGNETISM:MagnetismProgram.text,SADISTIC:SadisticNatureProgram.text};
  return{exports:{TheBomb,Panache,Mayhem,Magnetism,SadisticNature,programs,statusTexts}};
}});
