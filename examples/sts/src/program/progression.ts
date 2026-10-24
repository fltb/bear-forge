import {rules} from '../rules/execution.ts';
import {adventures} from "../rules/adventures.ts";
import {random} from "../rules/random.ts";
import {resources} from "../rules/resources.ts";
import {encounterPlans} from "../content/enemies/plans.ts";
import {maps} from "../rules/maps.ts";
import type {SpireMap} from "../map.types.ts";
import {encounterId} from "../identifiers.ts";
import * as pools from "../pools.ts";
import type {MonsterPlan} from "../encounters.types.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query}=rules;
/** The transition's healing operand and its public explanation share this constructor. */
function missingHealthRecovery(fraction:number){
  return Object.freeze({
    amount:(hp:number,maxHp:number)=>Math.round(Math.fround(Math.fround(maxHp-hp)*Math.fround(fraction))),
    text:`进入下一幕时，按缺失生命的${fraction*100}%计算治疗量（单精度运算后四舍五入）；实际恢复仍受治疗修正影响。`,
  });
}
export const actRecovery=missingHealthRecovery(.75);
export const adventureProgression=defineRules({requires:[adventures,encounterPlans,maps],build(){
  const reseedFloor=defineEffect<number,void>(b=>forEach(['misc','shuffle','cardRandom'] as const,key=>call(random.exports.reseed,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams[v.get(key)]),seed:b.read(v=>{const s=v.query(adventures.exports.status,v.input);return BigInt.asUintN(64,s.seed+BigInt(s.floor));})})));
  const nextAct=defineEffect<number,void>(b=>{const act=b.local<number>(),plan=b.local<MonsterPlan>(),map=b.local<SpireMap>();return sequence(
    b.assign(act,b.read(v=>v.query(adventures.exports.position,v.input).act+1)),
    when(b.read(v=>v.query(random.exports.current,v.query(adventures.exports.bindings,v.input).streams.card).counter<750),call(random.exports.advanceCounter,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.card),count:b.read(v=>{const n=v.query(random.exports.current,v.query(adventures.exports.bindings,v.input).streams.card).counter;return n<250?250:n<500?500:750;})})),
    call(resources.exports.heal,b.read(v=>{const entity=v.query(adventures.exports.bindings,v.input).actor,p=v.query(resources.exports.vitality,entity);return{entity,amount:actRecovery.amount(p.hp,p.maxHp)};})),
    when(b.read(v=>v.get(act)===4),b.assign(plan,{monsterList:[],eliteList:[encounterId.SHIELD_AND_SPEAR],boss:encounterId.THE_HEART,secondBoss:b.read(v=>v.query(adventures.exports.plan,v.input).secondBoss)}),b.assign(plan,call(encounterPlans.exports.generate,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.monster),act,ascension:b.read(v=>v.query(adventures.exports.bindings,v.input).ascension)}))),
    b.assign(map,call(maps.exports.generate,b.read(v=>{const s=v.query(adventures.exports.status,v.input);return{seed:s.seed,ascension:s.ascension,act:v.get(act),burning:!s.keys.green};}))),
    call(adventures.exports.beginAct,b.read(v=>{const s=v.query(adventures.exports.status,v.input),nextAct=v.get(act),nextPlan=v.get(plan);return{run:v.input,act:nextAct,map:v.get(map),...nextPlan,eventList:nextAct===2?[...pools.act2Events]:nextAct===3?[...pools.act3Events]:[],shrineList:nextAct===2?[...pools.act2Shrines]:nextAct===3?[...pools.act3Shrines]:[],colorlessPool:pools.colorlessPool.map(id=>v.query(adventures.exports.card,{run:v.input,id}))};})),
  );});
  return{exports:{reseedFloor,nextAct}};
}});
