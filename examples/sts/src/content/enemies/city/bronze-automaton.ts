import {enemyDeployOperation} from '../shared/deploy-operation.ts';
import {enemyOperations} from '../shared/operations.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {adventures} from "../../../rules/adventures.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {combatEnemyPowers} from "../shared/combat-powers.ts";
import {enemyDeployment} from "../shared/deployment.ts";
import {bronzeOrb} from "./bronze-orb.ts";
import {attackMove,enemyUtilities,enemyDefinition,enemyAttack,enemyPower,enemyProgram,enemyAtStart,enemyInitialize} from "../shared/programs.ts";
import {moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll} from "../../../rules/enemies.types.ts";
const {defineRules,defineQuery,defineEffect,defineComponent,sequence,when,forEach,call,query,updateLocalComponent,readComponent}=rules;
export const bronzeAutomaton=defineRules({requires:[enemyDeployOperation,enemyOperations,enemyUtilities,enemies,enemyDeployment,bronzeOrb,basicPowers,combatEnemyPowers,adventures],build(){
  const alternate=defineComponent({schema:z.boolean(),initial:()=>false});
  const next=(move:number)=>defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move}));
  const noop=defineEffect<EnemyAction,void>(b=>call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)));
  const summon=defineEffect<EnemyAction,void>(b=>call(enemyDeployOperation.exports.deploy,{battle:b.read(v=>v.input.battle),source:b.read(v=>v.input.enemy),entries:[0,2].map(slot=>({slot,choices:[bronzeOrb.exports.BronzeOrb],hp:null,move:null})),prepare:'after',roll:'each',minion:false,extent:null,skipCursor:null,noopRolls:0}));
  const Automaton=enemyDefinition({id:mid.BRONZE_AUTOMATON,threshold:9,components:[alternate],choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.BRONZE_AUTOMATON_SPAWN_ORBS)),initialize:enemyInitialize(enemyAtStart(enemyProgram(enemyPower(combatEnemyPowers.exports.MinionLeader,1),enemyPower(basicPowers.exports.EnemyArtifact,3)))),presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[alternate],base:(r,e)=>({miscInfo:Number(r.component(e,alternate))})}),moves:[
    {move:mm.BRONZE_AUTOMATON_SPAWN_ORBS,execute:enemyProgram(summon,next(mm.BRONZE_AUTOMATON_FLAIL),noop)},
    attackMove(mm.BRONZE_AUTOMATON_FLAIL,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=4?8:7,2),attack=>enemyProgram(attack,next(mm.BRONZE_AUTOMATON_BOOST),noop)),
    {move:mm.BRONZE_AUTOMATON_BOOST,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyPower(basicPowers.exports.Strength,v=>v.query(enemies.exports.current,v.input.enemy).ascension>=4?4:3),b.input),call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:b.read(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=9?12:9)}),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.get(readComponent(v.input.enemy,alternate))?mm.BRONZE_AUTOMATON_HYPER_BEAM:mm.BRONZE_AUTOMATON_FLAIL)}),updateLocalComponent(b.read(v=>v.input.enemy),alternate,n=>!n),call(noop,b.input)))},
    attackMove(mm.BRONZE_AUTOMATON_HYPER_BEAM,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=4?50:45),attack=>enemyProgram(attack,defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=19?mm.BRONZE_AUTOMATON_BOOST:mm.BRONZE_AUTOMATON_STUNNED)})),noop)),
    {move:mm.BRONZE_AUTOMATON_STUNNED,execute:enemyProgram(next(mm.BRONZE_AUTOMATON_FLAIL),noop)},
  ]});
  return{exports:{Automaton}};
}});
