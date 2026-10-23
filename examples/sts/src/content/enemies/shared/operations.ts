import {rules} from '../../../rules/execution.ts';
import {combatOperations,defineOperation,OperationKind} from '../../../rules/combat-operations.ts';
import {enemies} from '../../../rules/enemies.ts';
import {battles} from '../../../rules/battles.ts';
import {resources} from '../../../rules/resources.ts';
import {powers} from '../../../rules/powers.ts';
import {basicPowers} from '../../powers/attributes.ts';
import type {HitRequest} from '../../../rules/damage.types.ts';
import type {PowerApplication,PowerMutable,PowerDefinition} from '../../../rules/powers.types.ts';

/** Closed semantic commands. Enemy move bodies cannot supply arbitrary effects
 * to a privileged operation or write the underlying resources themselves. */
export const enemyOperations=rules.defineRules({requires:[combatOperations,basicPowers,enemies,battles,resources,powers],build(){
  const cleanseBody=rules.defineEffect<{battle:number;actor:number;only:PowerDefinition|null},void>(b=>rules.forEach(b.read(v=>{
    const registry=v.query(battles.exports.status,v.input.battle).registry;
    return v.query(powers.exports.entries,registry).filter(e=>v.query(powers.exports.current,e.entity).actor===v.input.actor&&v.query(powers.exports.polarity,e.entity)<0&&(v.input.only===null||e.entity===v.query(powers.exports.find,{registry,actor:v.input.actor,definition:v.input.only}))).map(e=>e.entity);
  }),entity=>rules.call(powers.exports.set,{entity,next:{level:0,active:false,justApplied:false}})));
  const cleanse=defineOperation<{battle:number;actor:number;only:PowerDefinition|null},void>(OperationKind.Cleanse,undefined,b=>rules.call(cleanseBody,b.input));
  const revive=defineOperation<{enemy:number;hp:number;maxHp:number;move:number|null;cleanse:boolean;powers:readonly{definition:PowerDefinition;amount:number}[]},boolean>(OperationKind.Revive,false,b=>rules.sequence(
    rules.when(b.read(v=>{const enemy=v.query(enemies.exports.current,v.input.enemy);return !enemy.halfDead||enemy.escaped;}),b.return(false)),
    rules.when(b.read(v=>!Number.isInteger(v.input.hp)||!Number.isInteger(v.input.maxHp)||v.input.hp<=0||v.input.hp>v.input.maxHp),b.return(b.read(()=>{throw Error('Invalid revival health');}))),
    rules.call(enemies.exports.finishRevival,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.input.move)}),
    rules.call(resources.exports.setHealth,{entity:b.read(v=>v.query(enemies.exports.current,v.input.enemy).actor),hp:b.read(v=>v.input.hp),maxHp:b.read(v=>v.input.maxHp)}),
    rules.when(b.read(v=>v.input.cleanse),rules.call(cleanseBody,{battle:b.read(v=>v.query(enemies.exports.current,v.input.enemy).battle),actor:b.read(v=>v.query(enemies.exports.current,v.input.enemy).actor),only:null})),
    rules.forEach(b.read(v=>v.input.powers),entry=>rules.call(powers.exports.restore,{registry:b.read(v=>v.query(battles.exports.status,v.query(enemies.exports.current,v.input.enemy).battle).registry),actor:b.read(v=>v.query(enemies.exports.current,v.input.enemy).actor),definition:b.read(v=>v.get(entry).definition),amount:b.read(v=>v.get(entry).amount),source:b.read(v=>v.query(enemies.exports.current,v.input.enemy).actor),debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.query(enemies.exports.current,v.input.enemy).battle).scope)})),
    b.return(true),
  ));
  const escape=defineOperation<number,void>(OperationKind.Escape,undefined,b=>rules.sequence(
    rules.call(enemies.exports.setFlags,{enemy:b.input,escaped:true}),
    rules.call(battles.exports.checkOutcome,b.read(v=>v.query(enemies.exports.current,v.input).battle)),
  ));
  const heal=defineOperation<{entity:number;amount:number},number>(OperationKind.Heal,0,b=>{const result=b.local<number>();return rules.sequence(b.assign(result,rules.call(resources.exports.heal,{entity:b.read(v=>v.input.entity),amount:b.read(v=>v.input.amount)})),b.return(result));});
  const block=defineOperation<{entity:number;amount:number},number>(OperationKind.Block,0,b=>{const result=b.local<number>();return rules.sequence(b.assign(result,rules.call(resources.exports.gainBlock,b.input)),b.return(result));});
  // Power application retains its definition's grant category (notably
  // Strength and battle tags); it must not be wrapped in a second Special gate.
  const applyPower=rules.defineEffect<PowerApplication,number|null>(b=>{const result=b.local<number|null>();return rules.sequence(b.assign(result,rules.call(powers.exports.apply,b.input)),b.return(result));});
  const consumePower=defineOperation<{entity:number;amount:number},void>(OperationKind.Settlement,undefined,b=>rules.call(powers.exports.decrement,b.input));
  const dismissPower=defineOperation<number,void>(OperationKind.Settlement,undefined,b=>rules.call(powers.exports.remove,b.input));
  const deactivatePower=defineOperation<number,void>(OperationKind.Settlement,undefined,b=>rules.call(powers.exports.deactivate,b.input));
  const setCounter=defineOperation<{entity:number;next:PowerMutable},void>(OperationKind.Settlement,undefined,b=>rules.call(powers.exports.set,b.input));
  const restoreHealth=defineOperation<{entity:number;hp:number;maxHp:number},void>(OperationKind.Heal,undefined,b=>rules.call(resources.exports.setHealth,b.input));
  const enterRebirth=defineOperation<{enemy:number;move:number;clear:'all'|'negative';remove:readonly PowerDefinition[];clearBlock:boolean;clearCards:boolean},boolean>(OperationKind.Revive,false,b=>rules.sequence(
    rules.forEach(b.read(v=>{const actor=v.query(enemies.exports.current,v.input.enemy).actor,registry=v.query(battles.exports.status,v.query(enemies.exports.current,v.input.enemy).battle).registry;return v.query(powers.exports.entries,registry).filter(e=>v.query(powers.exports.current,e.entity).actor===actor&&(v.input.clear==='all'||v.query(powers.exports.polarity,e.entity)<0)).map(e=>e.entity);}),entity=>rules.call(powers.exports.set,{entity,next:b.read(v=>{const power=v.query(powers.exports.current,v.get(entity)),strength=v.query(powers.exports.find,{registry:power.registry,actor:power.actor,definition:basicPowers.exports.Strength});return{level:v.input.clear==='negative'||v.get(entity)===strength?0:power.level,active:false,justApplied:false};})})),
    rules.forEach(b.read(v=>v.input.remove),definition=>rules.forEach(b.read(v=>{const state=v.query(enemies.exports.current,v.input.enemy),registry=v.query(battles.exports.status,state.battle).registry,power=v.query(powers.exports.find,{registry,actor:state.actor,definition:v.get(definition)});return power===null?[]:[power];}),power=>rules.call(powers.exports.remove,power))),
    rules.when(b.read(v=>v.input.clearBlock),rules.call(resources.exports.consumeBlock,b.read(v=>{const entity=v.query(enemies.exports.current,v.input.enemy).actor;return{entity,amount:v.query(resources.exports.defense,entity).block};}))),
    rules.call(enemies.exports.setFlags,{enemy:b.read(v=>v.input.enemy),halfDead:true}),
    rules.call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.input.move)}),
    rules.when(b.read(v=>v.input.clearCards),rules.call(battles.exports.clearCardQueue,b.read(v=>v.query(enemies.exports.current,v.input.enemy).battle))),
    b.return(true),
  ));
  const stealGold=defineOperation<{source:number;target:number;amount:number},number>(OperationKind.StealGold,0,b=>{const taken=b.local<number>();return rules.sequence(b.assign(taken,rules.call(resources.exports.seizeGold,b.input)),b.return(taken));});
  const retaliate=defineOperation<HitRequest,void>(OperationKind.Retaliate,undefined,b=>rules.call(battles.exports.hit,b.input));
  const clearApplicationMarker=defineOperation<number,void>(OperationKind.Settlement,undefined,b=>rules.call(powers.exports.clearJustApplied,b.input));
  const forceEndTurn=defineOperation<number,void>(OperationKind.EndTurn,undefined,b=>rules.call(battles.exports.endTurnEarly,b.input));
  return{exports:{cleanse,revive,escape,heal,block,applyPower,consumePower,dismissPower,deactivatePower,setCounter,restoreHealth,enterRebirth,stealGold,retaliate,clearApplicationMarker,forceEndTurn}};
}});
