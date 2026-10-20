import {rules} from '@bear-forge/card-engine';
import {battles} from '../rules/battles.ts';
import {cardPiles} from '../rules/card-piles.ts';
import {resources} from '../rules/resources.ts';
import {actionQueue} from '../rules/combat-actions.ts';
import type {PermanentCardDefinition} from '../rules/permanent-decks.types.ts';
import type {EnemyAction} from '../rules/enemies.types.ts';
export function enemyCards(definition:PermanentCardDefinition,count:number,destination:0|1|2|3,shuffle=false,queued=true){
  const make=rules.defineEffect<EnemyAction,void>(b=>rules.forEach(Array.from({length:count},(_,i)=>i),()=>rules.call(cardPiles.exports.create,{piles:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).piles),definition,upgraded:false,specialData:0,destination,shuffle,mutable:null})));
  return rules.defineEffect<EnemyAction,void>(b=>queued?rules.enqueue(make,b.input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}):rules.call(make,b.input));
}
/** Source suicide with relic triggers uses ordinary damage; fading bypasses death reactions. */
export function enemySuicide(triggerReactions:boolean){return rules.defineEffect<EnemyAction,void>(b=>rules.enqueue(rules.defineEffect<EnemyAction,void>(b=>rules.sequence(
  triggerReactions?rules.call(battles.exports.hit,{battle:b.read(v=>v.input.battle),source:null,target:b.read(v=>v.input.actor),amount:b.read(v=>v.get(rules.query(resources.exports.current,v.input.actor)).hp),attack:false,selfDamage:false}):rules.call(resources.exports.setHealth,{entity:b.read(v=>v.input.actor),hp:0,maxHp:b.read(v=>v.get(rules.query(resources.exports.current,v.input.actor)).maxHp)}),
  rules.call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
)),b.input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.get(rules.query(battles.exports.current,v.input.battle)).actionScope),eligible:'captured'}));}
