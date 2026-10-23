import {defineOperation,OperationKind} from '../../../rules/combat-operations.ts';
import {rules} from '../../../rules/execution.ts';
import {battles} from "../../../rules/battles.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {resources} from "../../../rules/resources.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import type {PermanentCardDefinition} from "../../../rules/permanent-decks.types.ts";
import type {EnemyAction} from "../../../rules/enemies.types.ts";
export function enemyCards(definition:PermanentCardDefinition,count:number|((v:rules.ReadView<EnemyAction>)=>number),destination:0|1|2|3,shuffle=false,queued=true,upgraded:boolean|((v:rules.ReadView<EnemyAction>)=>boolean)=false){
  const make=defineOperation<EnemyAction,void>(OperationKind.CreateCard,undefined,b=>rules.forEach(b.read(v=>Array.from({length:typeof count==='number'?count:count(v)},(_,i)=>i)),()=>rules.call(cardPiles.exports.create,{piles:b.read(v=>v.query(battles.exports.status,v.input.battle).piles),definition,upgraded:b.read(v=>typeof upgraded==='boolean'?upgraded:upgraded(v)),specialData:0,destination,shuffle,mutable:null})));
  return rules.defineEffect<EnemyAction,void>(b=>queued?rules.enqueue(make,b.input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}):rules.call(make,b.input));
}
/** Source suicide with relic triggers uses ordinary damage; fading bypasses death reactions. */
export function enemySuicide(triggerReactions:boolean){return rules.defineEffect<EnemyAction,void>(b=>rules.enqueue(rules.defineEffect<EnemyAction,void>(b=>rules.sequence(
  triggerReactions?rules.call(battles.exports.hit,{battle:b.read(v=>v.input.battle),source:null,target:b.read(v=>v.input.actor),amount:b.read(v=>v.query(resources.exports.vitality,v.input.actor).hp),attack:false,selfDamage:false}):rules.call(resources.exports.setHealth,{entity:b.read(v=>v.input.actor),hp:0,maxHp:b.read(v=>v.query(resources.exports.vitality,v.input.actor).maxHp)}),
  rules.call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
)),b.input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));}
