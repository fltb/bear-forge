import {enemyOperations} from './operations.ts';
import {defineDescribedEnemyPower,describedEnemyAbility,strengthAbility} from './abilities.ts';
import {rules} from '../../../rules/execution.ts';
import {powers} from "../../../rules/powers.ts";
import {turns} from "../../../rules/turns.ts";
import {battles} from "../../../rules/battles.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {counterPolicies} from "../../powers/utils.ts";
import {ownsTurn} from "../../powers/turn-hooks.ts";
import {MS} from "../../../combat-identifiers.ts";
import type {TurnActor} from "../../../rules/turns.types.ts";
const {defineRules,defineEntity,defineEffect,on,when,call,query,enqueue}=rules;
export const enemyTurnPowers=defineRules({requires:[enemyOperations,turns,basicPowers],build(){
  const application=(b:rules.Builder<rules.ReactionContext<TurnActor>,void>)=>({registry:b.read(v=>v.query(battles.exports.status,v.input.event.battle).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:query(powers.exports.level,b.read(v=>v.input.source)),source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.event.battle).scope)});
  const ritual=on(turns.exports.enemyRoundEnd,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:0},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>when(b.read(v=>v.query(powers.exports.current,v.input.source).justApplied),call(enemyOperations.exports.clearApplicationMarker,b.read(v=>v.input.source)),
    call(enemyOperations.exports.applyPower,application(b)),
  ))});
  const EnemyRitual=defineDescribedEnemyPower('仪式',{presentation:{key:MS.RITUAL,flag:false,slot:0},...counterPolicies({bits:32,markOnBuff:true})},{},describedEnemyAbility('敌方整轮结束时，若刚施加则仅清除施加标记；否则自身获得层数对应的力量。',strengthAbility(ritual)));
  return{exports:{EnemyRitual:EnemyRitual.definition,programs:{EnemyRitual},statusTexts:{RITUAL:EnemyRitual.text}}};
}});
