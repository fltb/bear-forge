import {rules} from '@bear-forge/card-engine';
import {adventures} from "../rules/adventures.ts";
import {random} from "../rules/random.ts";
import {resources} from "../rules/resources.ts";
import {encounterPlans} from "../content/enemies/plans.ts";
import {generateMap} from "../map.ts";
import {encounterId} from "../identifiers.ts";
import * as pools from "../pools.ts";
import type {MonsterPlan} from "../encounters.types.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query}=rules;
export const adventureProgression=defineRules({requires:[adventures,encounterPlans],build(){
  const reseedFloor=defineEffect<number,void>(b=>forEach(['misc','shuffle','cardRandom'] as const,key=>call(random.exports.reseed,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams[v.get(key)]),seed:b.read(v=>{const s=v.get(query(adventures.exports.current,v.input));return BigInt.asUintN(64,s.seed+BigInt(s.floor));})})));
  const nextAct=defineEffect<number,void>(b=>{const act=b.local<number>(),plan=b.local<MonsterPlan>();return sequence(
    b.assign(act,b.read(v=>v.get(query(adventures.exports.current,v.input)).act+1)),
    when(b.read(v=>v.get(query(random.exports.current,v.get(query(adventures.exports.current,v.input)).streams.card)).counter<750),call(random.exports.advanceCounter,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.card),count:b.read(v=>{const n=v.get(query(random.exports.current,v.get(query(adventures.exports.current,v.input)).streams.card)).counter;return n<250?250:n<500?500:750;})})),
    call(resources.exports.heal,b.read(v=>{const entity=v.get(query(adventures.exports.current,v.input)).actor,p=v.get(query(resources.exports.current,entity));return{entity,amount:Math.round(Math.fround(Math.fround(p.maxHp-p.hp)*Math.fround(.75)))};})),
    when(b.read(v=>v.get(act)===4),b.assign(plan,{monsterList:[],eliteList:[encounterId.SHIELD_AND_SPEAR],boss:encounterId.THE_HEART,secondBoss:b.read(v=>v.get(query(adventures.exports.current,v.input)).secondBoss)}),b.assign(plan,call(encounterPlans.exports.generate,{stream:b.read(v=>v.get(query(adventures.exports.current,v.input)).streams.monster),act,ascension:b.read(v=>v.get(query(adventures.exports.current,v.input)).ascension)}))),
    call(adventures.exports.beginAct,b.read(v=>{const s=v.get(query(adventures.exports.current,v.input)),nextAct=v.get(act),nextPlan=v.get(plan);return{run:v.input,act:nextAct,map:generateMap(s.seed,s.ascension,nextAct,!s.keys.green),...nextPlan,eventList:nextAct===2?[...pools.act2Events]:nextAct===3?[...pools.act3Events]:[],shrineList:nextAct===2?[...pools.act2Shrines]:nextAct===3?[...pools.act3Shrines]:[],colorlessPool:pools.colorlessPool.map(id=>v.get(query(adventures.exports.card,{run:v.input,id})))};})),
  );});
  return{exports:{reseedFloor,nextAct}};
}});
