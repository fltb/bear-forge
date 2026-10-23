import {typedValue} from '../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {describeProgram} from '../../rules/program-descriptions.ts';
import {powers} from '../../rules/powers.ts';
import {turns} from '../../rules/turns.ts';
import type {TurnActor} from '../../rules/turns.types.ts';
import {effectAbility,powerAbilities} from './utils.ts';
import {onProgram} from './reaction-programs.ts';
const counterDecay=1;
export const playerRoundExpiry=(priority:number,skipFirst:boolean)=>powerAbilities(expireCounter(turns.exports.playerRoundEnd,priority,skipFirst));
export const enemyRoundExpiry=(priority:number,skipFirst:boolean)=>powerAbilities(expireCounter(turns.exports.enemyRoundEnd,priority,skipFirst));
export const enemyActionExpiry=(priority:number,skipFirst:boolean)=>powerAbilities(expireCounter(turns.exports.enemyEnd,priority,skipFirst));
export function ownsTurn(){return describeProgram(rules.defineQuery({input:typedValue<rules.ReactionContext<TurnActor>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.actor===c.owner&&r.query(powers.exports.enabled,c.source)}),'状态生效且当前回合属于持有者');}
/** Event/condition/order project the actual reaction; the branch is owned by this counter primitive. */
export function expireCounter(event:rules.RuleEvent<TurnActor>,priority:number,skipFirst:boolean){
  const decay=describeProgram(rules.defineEffect<rules.ReactionContext<TurnActor>,void>(b=>rules.when(b.read(v=>skipFirst&&v.query(powers.exports.current,v.input.source).justApplied),
    rules.call(powers.exports.clearJustApplied,b.read(v=>v.input.source)),rules.call(powers.exports.decrement,{entity:b.read(v=>v.input.source),amount:counterDecay}),
  )),`${skipFirst?'有新施加标记时只清除标记，否则':''}减少${counterDecay}层。`);
  return effectAbility(onProgram(event,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority},effect:decay}),null);
}
