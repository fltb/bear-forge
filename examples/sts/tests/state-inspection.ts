// Exact observations of production owners. No old World or alternate evaluator.
import {inspectRuleQuery,inspectRuleQueue} from '@bear-forge/card-engine/rules-inspection';
import {cardDefinition} from '../src/card.ts';
import {adventures} from '../src/rules/adventures.ts';
import {combatSessions} from '../src/rules/combat-sessions.ts';
import {actionQueue} from '../src/rules/combat-actions.ts';
import {adventureViews} from "../src/adapters/adventure-views.ts";
import {combatViews} from "../src/adapters/combat-views.ts";
import {combatChoices} from "../src/adapters/ports.ts";
import type {Frame} from '../src/game.schemas.ts';
import type {rules} from '../src/rules/execution.ts';
import type {CardDefinition} from '@bear-forge/card-engine';
export function ownerQuery<I,O>(state:unknown,query:rules.Query<I,O>,input:I):O{return inspectRuleQuery(cardDefinition,state,query,input);}
export function adventureIdentity(state:unknown):number{
  const ids=ownerQuery(state,adventures.exports.instances,undefined);if(ids.length!==1)throw Error('Normal STS Context must contain one adventure');return ids[0]!;
}
export function adventureView(state:unknown){return ownerQuery(state,adventureViews.exports.privateGame,adventureIdentity(state));}
export function battleView(state:unknown){
  const run=adventureIdentity(state),session=ownerQuery(state,combatSessions.exports.forRun,run);if(session===null)return null;
  const current=ownerQuery(state,combatSessions.exports.current,session),pending=ownerQuery(state,combatChoices.exports.pending,current.battle);
  return ownerQuery(state,combatViews.exports.privateBattle,{run,selection:pending?{screen:pending.screen,cards:pending.cards,pickCount:pending.maximum??1,canPickZero:false,canPickAnyNumber:false}:null,actionQueueSize:inspectRuleQueue(cardDefinition,state,actionQueue,{includeStaged:true})});
}
export function oracleView(state:unknown,frame:Frame){
  const current=ownerQuery(state,adventures.exports.current,adventureIdentity(state));
  return{game:adventureView(state),battle:battleView(state),actions:frame.actions,decisions:current.history.length,heartDefeated:current.outcome===2&&current.act===4,history:current.history};
}
/** The same owner observations for explicitly constructed content fixtures. */
export function oracleViewOf(definition:CardDefinition<any,any,any,any>,state:unknown,frame:Frame){
  const read=<I,O>(q:rules.Query<I,O>,input:I):O=>inspectRuleQuery(definition,state,q,input);
  const ids=read(adventures.exports.instances,undefined);if(ids.length!==1)throw Error('Expected one fixture adventure');const run=ids[0]!,current=read(adventures.exports.current,run),session=read(combatSessions.exports.forRun,run);
  let battle=null;
  if(session!==null){const board=read(combatSessions.exports.current,session),pending=read(combatChoices.exports.pending,board.battle);battle=read(combatViews.exports.privateBattle,{run,selection:pending?{screen:pending.screen,cards:pending.cards,pickCount:pending.maximum??1,canPickZero:false,canPickAnyNumber:false}:null,actionQueueSize:inspectRuleQueue(definition,state,actionQueue,{includeStaged:true})});}
  return{game:read(adventureViews.exports.privateGame,run),battle,actions:frame.actions,decisions:current.history.length,heartDefeated:current.outcome===2&&current.act===4,history:current.history};
}
