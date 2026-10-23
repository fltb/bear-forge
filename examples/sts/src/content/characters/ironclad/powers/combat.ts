import { typedValue } from '../../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../../rules/execution.ts';
import {powers} from "../../../../rules/powers.ts";
import {damage} from "../../../../rules/damage.ts";
import {resources} from "../../../../rules/resources.ts";
import {battles} from "../../../../rules/battles.ts";
import {turns} from "../../../../rules/turns.ts";
import {actionQueue} from "../../../../rules/combat-actions.ts";
import {counterPolicies,defineDescribedPower,describedAbility} from "../../../powers/utils.ts";
import {ownsTurn} from "../../../powers/turn-hooks.ts";
import {PS} from "../../../../combat-identifiers.ts";
import type {TurnActor} from "../../../../rules/turns.types.ts";
import type {HpDamageRequest} from "../../../../rules/damage.types.ts";

const {defineRules,defineEntity,defineQuery,defineEffect,on,query,enqueue,call}=rules;
export const combatPowers=defineRules({requires:[powers,damage,turns],build(){
  const metallicize=on(turns.exports.playerEndPreCards,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.METALLICIZE},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>enqueue(resources.exports.gainBlock,{entity:b.read(v=>v.input.owner),amount:query(powers.exports.level,b.read(v=>v.input.source))},
    {queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'}))});
  const flameCondition=defineQuery({input:typedValue<rules.ReactionContext<HpDamageRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled,resources.exports.side],base:(r,c)=>c.event.request.target===c.owner&&c.event.request.attack&&c.event.request.source!==null&&r.query(resources.exports.side,c.event.request.source)===1&&r.query(powers.exports.enabled,c.source)});
  const flame=on(damage.exports.blocked,{condition:flameCondition,effect:defineEffect<rules.ReactionContext<HpDamageRequest>,void>(b=>enqueue(battles.exports.hit,{battle:b.read(v=>v.input.event.request.battle),source:b.read(v=>v.input.owner),target:b.read(v=>v.input.event.request.source!),amount:query(powers.exports.level,b.read(v=>v.input.source)),attack:false,selfDamage:false},
    {queue:actionQueue,position:'front',source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.request.battle).actionScope),eligible:'captured'}))});
  const expireFlame=on(turns.exports.playerStartPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:PS.FLAME_BARRIER},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>call(powers.exports.deactivate,b.read(v=>v.input.source)))});
  const Metallicize=defineDescribedPower('金属化',{presentation:{key:PS.METALLICIZE,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true})},describedAbility('自身回合结束的卡牌处理前，排队获得层数对应的格挡。',metallicize));
  const FlameBarrier=defineDescribedPower('火焰屏障',{presentation:{key:PS.FLAME_BARRIER,flag:false},...counterPolicies({bits:16,resetWhenInactive:true,zeroIsNoop:true})},describedAbility('自身受到敌人的攻击完成格挡结算时，对攻击者排队造成层数对应的非攻击伤害。',flame),describedAbility('自身下回合开始失效。',expireFlame));
  return{exports:{Metallicize:Metallicize.definition,FlameBarrier:FlameBarrier.definition,programs:{Metallicize,FlameBarrier},statusTexts:{METALLICIZE:Metallicize.text,FLAME_BARRIER:FlameBarrier.text}}};
}});
