import {z} from 'zod';
import {rules} from '@bear-forge/card-engine';
import {enemies} from '../rules/enemies.ts';
import {battles} from '../rules/battles.ts';
import {resources} from '../rules/resources.ts';
import {powers} from '../rules/powers.ts';
import {adventures} from '../rules/adventures.ts';
import {basicPowers} from './basic-powers.ts';
import {combatEnemyPowers} from './combat-enemy-powers.ts';
import {enemyDeployment} from './enemy-deployment.ts';
import {bronzeOrb} from './bronze-orb.ts';
import {enemyUtilities,enemyDefinition,enemyAttack,enemyPower,enemyProgram,enemyAtStart,enemyInitialize} from './enemy-utils.ts';
import {actionQueue} from '../rules/combat-actions.ts';
import {moveId as mm,monsterId as mid} from '../combat-identifiers.ts';
import type {EnemyAction,EnemyRoll} from '../rules/enemies.types.ts';
const {defineRules,defineQuery,defineEffect,defineComponent,sequence,when,forEach,call,query,updateLocalComponent,readComponent}=rules;
export const bronzeAutomaton=defineRules({requires:[enemyUtilities,enemies,enemyDeployment,bronzeOrb,basicPowers,combatEnemyPowers,adventures],build(){
  const alternate=defineComponent({schema:z.boolean(),initial:()=>false});
  const next=(move:number)=>defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move}));
  const noop=defineEffect<EnemyAction,void>(b=>call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)));
  const summon=defineEffect<EnemyAction,void>(b=>{const created=b.local<number[]>(),enemy=b.local<number>();return sequence(b.assign(created,[]),forEach([0,2],slot=>sequence(b.assign(enemy,call(enemyDeployment.exports.deploy,{battle:b.read(v=>v.input.battle),slot,definition:bronzeOrb.exports.BronzeOrb,hp:null,currentMove:null,prepare:false})),b.assign(created,b.read(v=>[...v.get(created),v.get(enemy)])),call(enemies.exports.claim,enemy))),forEach(created,enemy=>sequence(call(enemies.exports.prepare,enemy),when(b.read(v=>{const run=v.get(query(adventures.exports.forActor,v.get(query(battles.exports.current,v.input.battle)).actor));return run!==null&&v.get(query(adventures.exports.hasRelic,{run,id:'PHILOSOPHERS_STONE'}));}),call(powers.exports.apply,{registry:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).registry),actor:b.read(v=>v.get(query(enemies.exports.current,v.get(enemy))).actor),definition:basicPowers.exports.Strength,amount:1,source:null,debuff:false,scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope)})))));});
  const Automaton=enemyDefinition({id:mid.BRONZE_AUTOMATON,threshold:9,components:[alternate],choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.BRONZE_AUTOMATON_SPAWN_ORBS)),initialize:enemyInitialize(enemyAtStart(enemyProgram(enemyPower(combatEnemyPowers.exports.MinionLeader,1),enemyPower(basicPowers.exports.EnemyArtifact,3)))),presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[alternate],base:(r,e)=>({miscInfo:Number(r.component(e,alternate))})}),moves:[
    {move:mm.BRONZE_AUTOMATON_SPAWN_ORBS,execute:enemyProgram(summon,next(mm.BRONZE_AUTOMATON_FLAIL),noop)},
    {move:mm.BRONZE_AUTOMATON_FLAIL,damage:s=>s.ascension>=4?8:7,hits:2,execute:enemyProgram(enemyAttack(v=>v.get(query(enemies.exports.current,v.input.enemy)).ascension>=4?8:7,2),next(mm.BRONZE_AUTOMATON_BOOST),noop)},
    {move:mm.BRONZE_AUTOMATON_BOOST,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyPower(basicPowers.exports.Strength,v=>v.get(query(enemies.exports.current,v.input.enemy)).ascension>=4?4:3),b.input),call(resources.exports.gainBlock,{entity:b.read(v=>v.input.actor),amount:b.read(v=>v.get(query(enemies.exports.current,v.input.enemy)).ascension>=9?12:9)}),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.get(readComponent(v.input.enemy,alternate))?mm.BRONZE_AUTOMATON_HYPER_BEAM:mm.BRONZE_AUTOMATON_FLAIL)}),updateLocalComponent(b.read(v=>v.input.enemy),alternate,n=>!n),call(noop,b.input)))},
    {move:mm.BRONZE_AUTOMATON_HYPER_BEAM,damage:s=>s.ascension>=4?50:45,execute:enemyProgram(enemyAttack(v=>v.get(query(enemies.exports.current,v.input.enemy)).ascension>=4?50:45),defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.get(query(enemies.exports.current,v.input.enemy)).ascension>=19?mm.BRONZE_AUTOMATON_BOOST:mm.BRONZE_AUTOMATON_STUNNED)})),noop)},
    {move:mm.BRONZE_AUTOMATON_STUNNED,execute:enemyProgram(next(mm.BRONZE_AUTOMATON_FLAIL),noop)},
  ]});
  return{exports:{Automaton}};
}});
