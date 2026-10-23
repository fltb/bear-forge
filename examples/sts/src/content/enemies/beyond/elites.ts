import {enemyDeployOperation} from '../shared/deploy-operation.ts';
import {enemyOperations} from '../shared/operations.ts';
import {pileCards} from "../../cards/statuses/definitions.ts";
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {random} from "../../../rules/random.ts";
import {combatSessions} from "../../../rules/combat-sessions.ts";
import {adventures} from "../../../rules/adventures.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {beyondPowers} from "./powers.ts";
import {defensePowers} from "../../powers/defense.ts";
import {combatEnemyPowers} from "../shared/combat-powers.ts";
import {enemyDeployment} from "../shared/deployment.ts";
import {attackMove,enemyUtilities,enemyDefinition,enemyHealth,enemyAttack,enemyPower,enemyProgram,rollEnemyAfter,enemyAtStart,enemyInitialize} from "../shared/programs.ts";
import {enemyCards,enemySuicide} from "../shared/cards.ts";
import {moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll,EnemyDefinition} from "../../../rules/enemies.types.ts";
const {defineRules,defineEffect,sequence,when,whileDo,forEach,call,query}=rules;
export const beyondElites=defineRules({requires:[enemyDeployOperation,enemyOperations,enemyUtilities,enemies,battles,resources,powers,random,combatSessions,adventures,basicPowers,beyondPowers,defensePowers,combatEnemyPowers,enemyDeployment,pileCards],build(){
  const s=(v:Pick<rules.ReadView<EnemyAction>,'input'|'query'>)=>v.query(enemies.exports.current,v.input.enemy);
  const noop=defineEffect<EnemyAction,void>(b=>call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)));
  const directRoll=defineEffect<EnemyAction,void>(b=>call(enemies.exports.roll,b.read(v=>v.input.enemy)));
  const GiantHead=enemyDefinition({id:mid.GIANT_HEAD,threshold:8,initialize:enemyInitialize(enemyAtStart(enemyPower(beyondPowers.exports.Slow,0))),choose:defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);if(v.query(battles.exports.status,s.battle).turn>=4)return mm.GIANT_HEAD_IT_IS_TIME;return v.input.roll<50?(!s.history.every(m=>m===mm.GIANT_HEAD_GLARE)?mm.GIANT_HEAD_GLARE:mm.GIANT_HEAD_COUNT):!s.history.every(m=>m===mm.GIANT_HEAD_COUNT)?mm.GIANT_HEAD_COUNT:mm.GIANT_HEAD_GLARE;}))),moves:[attackMove(mm.GIANT_HEAD_COUNT,enemyAttack(13),attack=>enemyProgram(attack,rollEnemyAfter)),{move:mm.GIANT_HEAD_GLARE,execute:enemyProgram(enemyPower(basicPowers.exports.PlayerWeak,1,true,true),directRoll)},attackMove(mm.GIANT_HEAD_IT_IS_TIME,enemyAttack(v=>(s(v).ascension>=3?40:30)+Math.min(v.input.turn-5,6)*5),attack=>enemyProgram(attack,noop))]});
  const nemesisChoose=defineEffect<EnemyRoll,number>(b=>{const coin=b.local<boolean>();const stream=b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng);return sequence(
    when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===0),b.return(b.read(v=>v.input.roll<50?mm.NEMESIS_ATTACK:mm.NEMESIS_DEBUFF))),
    when(b.read(v=>v.input.roll<30),sequence(when(b.read(v=>!v.query(enemies.exports.current,v.input.enemy).history.includes(mm.NEMESIS_SCYTHE)),b.return(mm.NEMESIS_SCYTHE)),b.assign(coin,call(random.exports.boolean,{stream})),when(coin,b.return(b.read(v=>!v.query(enemies.exports.current,v.input.enemy).history.every(m=>m===mm.NEMESIS_ATTACK)?mm.NEMESIS_ATTACK:mm.NEMESIS_DEBUFF)),b.return(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.NEMESIS_DEBUFF?mm.NEMESIS_DEBUFF:mm.NEMESIS_ATTACK))))),
    when(b.read(v=>v.input.roll<65),sequence(when(b.read(v=>!v.query(enemies.exports.current,v.input.enemy).history.every(m=>m===mm.NEMESIS_ATTACK)),b.return(mm.NEMESIS_ATTACK)),b.assign(coin,call(random.exports.boolean,{stream})),b.return(b.read(v=>!v.get(coin)||v.query(enemies.exports.current,v.input.enemy).history.includes(mm.NEMESIS_SCYTHE)?mm.NEMESIS_DEBUFF:mm.NEMESIS_SCYTHE)))),
    when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.NEMESIS_DEBUFF),b.return(mm.NEMESIS_DEBUFF)),b.assign(coin,call(random.exports.boolean,{stream})),b.return(b.read(v=>v.get(coin)&&!v.query(enemies.exports.current,v.input.enemy).history.includes(mm.NEMESIS_SCYTHE)?mm.NEMESIS_SCYTHE:mm.NEMESIS_ATTACK)),
  );});
  const intangible=(queued:boolean)=>defineEffect<EnemyAction,void>(b=>when(b.read(v=>{const p=v.query(powers.exports.find,{registry:v.query(battles.exports.status,v.input.battle).registry,actor:v.input.actor,definition:defensePowers.exports.EnemyIntangible});return p===null||!v.query(powers.exports.enabled,p);}),call(enemyPower(defensePowers.exports.EnemyIntangible,2,false,false,queued),b.input)));
  const Nemesis=enemyDefinition({id:mid.NEMESIS,threshold:8,choose:nemesisChoose,moves:[attackMove(mm.NEMESIS_ATTACK,enemyAttack(v=>s(v).ascension>=3?7:6,3),attack=>enemyProgram(attack,rollEnemyAfter,intangible(true))),attackMove(mm.NEMESIS_SCYTHE,enemyAttack(45),attack=>enemyProgram(attack,rollEnemyAfter,intangible(true))),{move:mm.NEMESIS_DEBUFF,execute:defineEffect<EnemyAction,void>(b=>sequence(when(b.read(v=>s(v).ascension>=3),call(enemyCards(pileCards.exports.Burn,5,2,false,false),b.input),call(enemyCards(pileCards.exports.Burn,3,2,false,false),b.input)),call(directRoll,b.input),call(intangible(false),b.input)))}]});
  const Dagger=enemyDefinition({id:mid.DAGGER,threshold:8,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.DAGGER_STAB)),initialize:enemyInitialize(enemyAtStart(enemyPower(combatEnemyPowers.exports.Minion,1))),moves:[attackMove(mm.DAGGER_STAB,enemyAttack(9),attack=>enemyProgram(attack,enemyCards(pileCards.exports.Wound,1,2),defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.DAGGER_EXPLODE})),noop)),attackMove(mm.DAGGER_EXPLODE,enemyAttack(25),attack=>enemyProgram(attack,enemySuicide(true),noop))]});
  const reptoChoose=defineEffect<EnemyRoll,number>(b=>{const roll=b.local<number>();return sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===0),b.return(mm.REPTOMANCER_SUMMON)),b.assign(roll,b.read(v=>v.input.roll)),whileDo(true,sequence(
    when(b.read(v=>v.get(roll)<33),sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.REPTOMANCER_SNAKE_STRIKE),b.return(mm.REPTOMANCER_SNAKE_STRIKE)),b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:33,end:99})))),
    when(b.read(v=>v.get(roll)<66),b.return(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);return !s.history.every(m=>m===mm.REPTOMANCER_SUMMON)&&v.query(battles.exports.targets,s.battle).length<4?mm.REPTOMANCER_SUMMON:mm.REPTOMANCER_SNAKE_STRIKE;}))),
    when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.REPTOMANCER_BIG_BITE),b.return(mm.REPTOMANCER_BIG_BITE)),b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:0,end:65})),
  )));});
  const summon=defineEffect<EnemyAction,void>(b=>{const pool=b.local<EnemyDefinition[]>();return sequence(b.assign(pool,[Dagger]),call(enemyDeployOperation.exports.deploy,b.read(v=>{
    const id=v.query(combatSessions.exports.forBattle,v.input.battle);if(id===null)throw Error('Summon needs a session');const roster=v.query(combatSessions.exports.current,id).roster;
    return{battle:v.input.battle,source:v.input.enemy,entries:[4,1,3,0].filter(slot=>roster[slot]?.actor==null||v.query(resources.exports.vitality,roster[slot]!.actor!).hp<=0).slice(0,s(v).ascension>=18?2:1).map(slot=>({slot,choices:v.get(pool),hp:null,move:null})),prepare:'each' as const,roll:'each' as const,minion:false,extent:null,skipCursor:null,noopRolls:0};
  })));});

  const Reptomancer=enemyDefinition({id:mid.REPTOMANCER,threshold:8,health:enemyHealth(mid.REPTOMANCER,8,[{minimum:180,maximum:190}]),choose:reptoChoose,initialize:enemyInitialize(enemyAtStart(enemyPower(combatEnemyPowers.exports.MinionLeader,1))),moves:[attackMove(mm.REPTOMANCER_BIG_BITE,enemyAttack(v=>s(v).ascension>=3?34:30),attack=>enemyProgram(attack,rollEnemyAfter)),attackMove(mm.REPTOMANCER_SNAKE_STRIKE,enemyAttack(v=>s(v).ascension>=3?16:13,2),attack=>enemyProgram(attack,enemyPower(basicPowers.exports.PlayerWeak,1,true,true,true),rollEnemyAfter)),{move:mm.REPTOMANCER_SUMMON,execute:enemyProgram(summon,directRoll)}]});
  return{exports:{GiantHead,Nemesis,Reptomancer,Dagger}};
}});
