import {describeProgram} from '../../../cards/shared/program-facts.ts';
import {areaDamage} from '../../../shared/area-damage.ts';
import {combatPrivate,observeCounter} from "../../../../program/combat-state.ts";
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {powers} from "../../../../rules/powers.ts";
import {battles} from "../../../../rules/battles.ts";
import {turns} from "../../../../rules/turns.ts";
import {resources} from "../../../../rules/resources.ts";
import {combatGeneration} from "../../../../program/card-generation.ts";
import {basicPowers} from "../../../powers/attributes.ts";
import {counterPolicies,defineDescribedPowerWithLifecycle,describedAbility} from "../../../powers/utils.ts";
import {ownsTurn} from "../../../powers/turn-hooks.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {PS} from "../../../../combat-identifiers.ts";
import type {TurnActor} from "../../../../rules/turns.types.ts";
import type {PowerMerged} from "../../../../rules/powers.types.ts";
const {defineRules,defineComponent,defineQuery,defineEffect,defineEntity,sequence,when,forEach,call,query,enqueue,on,modify,updateLocalComponent,readComponent}=rules;
export const ironcladAdditionalPowers=defineRules({requires:[areaDamage,combatPrivate,powers,battles,turns,combatGeneration,basicPowers],build(){
  const damageAll=areaDamage.exports.hit;
  const healthLoss=defineEffect<{battle:number;actor:number;amount:number},void>(b=>sequence(call(resources.exports.loseHp,{entity:b.read(v=>v.input.actor),amount:b.read(v=>Math.max(0,v.input.amount)),selfDamage:true}),call(battles.exports.checkOutcome,b.read(v=>v.input.battle))));
  const lossPerApplication=1;
  const combustStacks=defineComponent({schema:z.int32(),initial:()=>lossPerApplication});
  const combust=on(turns.exports.playerEndPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.COMBUST},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>when(b.read(v=>v.query(battles.exports.targets,v.input.event.battle).length>0),sequence(
    enqueue(healthLoss,{battle:b.read(v=>v.input.event.battle),actor:b.read(v=>v.input.owner),amount:readComponent(b.read(v=>v.input.source),combustStacks)},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope),eligible:'captured'}),
    enqueue(damageAll,{battle:b.read(v=>v.input.event.battle),actor:b.read(v=>v.input.owner),amount:query(powers.exports.level,b.read(v=>v.input.source))},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'}),
  )))});
  const Combust=defineDescribedPowerWithLifecycle('自燃',{presentation:{key:PS.COMBUST,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true}),merged:describeProgram(defineEffect<PowerMerged,void>(b=>updateLocalComponent(b.read(v=>v.input.entity),combustStacks,n=>((n+lossPerApplication)<<24)>>24)),`每次重复施加，生命损失计数增加${lossPerApplication}，按8位有符号计数保存。`)},{components:[combustStacks]},describedAbility(`自身回合结束且仍有敌人时，先排队失去生命（标记为自伤，损失不低于0，随后检查战斗结果），再对全体敌人造成层数伤害。生命损失计数从${lossPerApplication}开始。`,combust),describedAbility('公开当前生命损失计数。',observeCounter('combustHpLoss',combustStacks)));
  return{exports:{Combust:Combust.definition,programs:{Combust},statusTexts:{COMBUST:Combust.text}}};
}});
