import { typedValue } from '../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {powers} from "../../rules/powers.ts";
import {turns} from "../../rules/turns.ts";
import type {TurnActor} from "../../rules/turns.types.ts";
import {effectAbility} from './utils.ts';
export function ownsTurn(){return rules.defineQuery({input:typedValue<rules.ReactionContext<TurnActor>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.actor===c.owner&&r.query(powers.exports.enabled,c.source)});}
/** Reusable content hook. Event and source priority are explicit, not hidden in the turn owner. */
export function expireCounter(event:rules.RuleEvent<TurnActor>,priority:number,skipFirst:boolean){
  return effectAbility(rules.on(event,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority},effect:rules.defineEffect<rules.ReactionContext<TurnActor>,void>(b=>rules.when(b.read(v=>skipFirst&&v.query(powers.exports.current,v.input.source).justApplied),
    rules.call(powers.exports.clearJustApplied,b.read(v=>v.input.source)),rules.call(powers.exports.decrement,{entity:b.read(v=>v.input.source),amount:1}),
  ))}),null);
}
