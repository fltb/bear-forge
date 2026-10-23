import {enemyDeployOperation} from '../shared/deploy-operation.ts';
import {enemyOperations} from '../shared/operations.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {random} from "../../../rules/random.ts";
import {combatSessions} from "../../../rules/combat-sessions.ts";
import {adventures} from "../../../rules/adventures.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {combatEnemyPowers} from "../shared/combat-powers.ts";
import {exordiumHumanoids} from "../exordium/humanoids.ts";
import {enemyDeployment} from "../shared/deployment.ts";
import {attackMove,enemyUtilities,enemyDefinition,enemyHealth,enemyAttack,enemyPower,enemyProgram,enemyAtStart,enemyInitialize,rollEnemyAfter} from "../shared/programs.ts";
import {enemyHealthSchema as importHealthSchema} from "../../../rules/enemies.schemas.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll,EnemyDefinition} from "../../../rules/enemies.types.ts";
const {defineRules,defineEffect,defineQuery,defineComponent,sequence,when,forEach,call,query,readComponent,updateLocalComponent,enqueue}=rules;

export const cityBosses=defineRules({requires:[enemyDeployOperation,enemyOperations,enemyUtilities,enemies,battles,resources,powers,random,combatSessions,adventures,basicPowers,combatEnemyPowers,exordiumHumanoids,enemyDeployment],build(){
  const state=(v:Pick<rules.ReadView<EnemyAction>,'input'|'query'>)=>v.query(enemies.exports.current,v.input.enemy);
  const h=exordiumHumanoids.exports;
  const gremlins=[h.MadGremlin,h.MadGremlin,h.SneakyGremlin,h.SneakyGremlin,h.FatGremlin,h.FatGremlin,h.ShieldGremlin,h.GremlinWizard];
  const chooseGremlin=defineEffect<number,EnemyDefinition>(b=>{const pool=b.local<EnemyDefinition[]>(),index=b.local<number>();return sequence(b.assign(pool,gremlins),b.assign(index,call(random.exports.int,{stream:b.input,start:0,end:7})),b.return(b.read(v=>v.get(pool)[v.get(index)]!)));});
  const summonGremlins=defineEffect<EnemyAction,void>(b=>{const pool=b.local<EnemyDefinition[]>();return sequence(b.assign(pool,gremlins),call(enemyDeployOperation.exports.deploy,b.read(v=>{
    const session=v.query(combatSessions.exports.forBattle,v.input.battle);if(session===null)throw Error('Summon needs a session');const roster=v.query(combatSessions.exports.current,session).roster;
    return{battle:v.input.battle,source:v.input.enemy,entries:[1,2,0].filter(slot=>roster[slot]?.actor==null||v.query(resources.exports.vitality,roster[slot]!.actor!).hp<=0).slice(0,2).map(slot=>({slot,choices:v.get(pool),hp:null,move:null})),prepare:'none' as const,roll:'after' as const,minion:true,extent:null,skipCursor:null,noopRolls:0};
  })));});
  const leaderChoose=defineEffect<EnemyRoll,number>(b=>{const n=b.local<number>(),extra=b.local<number>();return sequence(
    b.assign(n,b.read(v=>v.query(battles.exports.targets,v.query(enemies.exports.current,v.input.enemy).battle).length-1)),
    when(b.read(v=>v.get(n)===0),b.return(b.read(v=>{const h=v.query(enemies.exports.current,v.input.enemy).history;if(v.input.roll<75)return h[0]===mm.GREMLIN_LEADER_RALLY?mm.GREMLIN_LEADER_STAB:mm.GREMLIN_LEADER_RALLY;return h[0]===mm.GREMLIN_LEADER_STAB?mm.GREMLIN_LEADER_RALLY:mm.GREMLIN_LEADER_STAB;}))),
    when(b.read(v=>v.get(n)===1),sequence(
      when(b.read(v=>v.input.roll<50),sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===mm.GREMLIN_LEADER_RALLY),sequence(b.assign(extra,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:50,end:99})),b.return(b.read(v=>v.get(extra)<80?mm.GREMLIN_LEADER_ENCOURAGE:mm.GREMLIN_LEADER_STAB)))),b.return(mm.GREMLIN_LEADER_RALLY))),
      when(b.read(v=>v.input.roll<80),b.return(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===mm.GREMLIN_LEADER_ENCOURAGE?mm.GREMLIN_LEADER_STAB:mm.GREMLIN_LEADER_ENCOURAGE))),
      when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===mm.GREMLIN_LEADER_STAB),sequence(b.assign(extra,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:0,end:80})),b.return(b.read(v=>v.get(extra)<50?mm.GREMLIN_LEADER_RALLY:mm.GREMLIN_LEADER_ENCOURAGE)))),b.return(mm.GREMLIN_LEADER_STAB),
    )),b.return(b.read(v=>{const h=v.query(enemies.exports.current,v.input.enemy).history;return v.input.roll<66?(h[0]===mm.GREMLIN_LEADER_ENCOURAGE?mm.GREMLIN_LEADER_STAB:mm.GREMLIN_LEADER_ENCOURAGE):(h[0]===mm.GREMLIN_LEADER_STAB?mm.GREMLIN_LEADER_ENCOURAGE:mm.GREMLIN_LEADER_STAB);})),
  );});
  const leaderStart=enemyAtStart(defineEffect<EnemyAction,void>(b=>sequence(call(enemyPower(combatEnemyPowers.exports.MinionLeader,1),b.input),forEach(b.read(v=>v.query(battles.exports.status,v.input.battle).enemies.filter(actor=>actor!==v.input.actor)),actor=>call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,definition:combatEnemyPowers.exports.Minion,amount:1,source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})))));
  const encourage=defineEffect<EnemyAction,void>(b=>sequence(call(random.exports.int,{stream:b.read(v=>state(v).aiRng),start:0,end:2}),forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),actor=>sequence(call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,definition:basicPowers.exports.Strength,amount:b.read(v=>state(v).ascension>=18?5:state(v).ascension>=3?4:3),source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)}),when(b.read(v=>v.get(actor)!==v.input.actor),call(enemyOperations.exports.block,{entity:actor,amount:b.read(v=>state(v).ascension>=3?10:6)})))),call(rollEnemyAfter,b.input)));
  const GremlinLeader=enemyDefinition({id:mid.GREMLIN_LEADER,threshold:8,choose:leaderChoose,initialize:enemyInitialize(leaderStart),moves:[attackMove(mm.GREMLIN_LEADER_STAB,enemyAttack(6,3),attack=>enemyProgram(attack,rollEnemyAfter)),{move:mm.GREMLIN_LEADER_ENCOURAGE,execute:encourage},{move:mm.GREMLIN_LEADER_RALLY,execute:defineEffect<EnemyAction,void>(b=>sequence(enqueue(summonGremlins,b.input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),call(rollEnemyAfter,b.input)))}]});

  const champData=defineComponent({schema:z.int32(),initial:()=>0});
  const champChoose=defineEffect<EnemyRoll,number>(b=>sequence(
    when(b.read(v=>(v.get(readComponent(v.input.enemy,champData))&4)!==0),when(b.read(v=>!v.query(enemies.exports.current,v.input.enemy).history.includes(mm.THE_CHAMP_EXECUTE)),b.return(mm.THE_CHAMP_EXECUTE)),sequence(
      when(b.read(v=>{const hp=v.query(resources.exports.vitality,v.query(enemies.exports.current,v.input.enemy).actor);return hp.hp<Math.trunc(hp.maxHp/2);}),sequence(updateLocalComponent(b.read(v=>v.input.enemy),champData,n=>n|4),b.return(mm.THE_CHAMP_ANGER))),
      when(b.read(v=>(v.query(battles.exports.status,v.query(enemies.exports.current,v.input.enemy).battle).turn+1)%4===0),b.return(mm.THE_CHAMP_TAUNT)),
    )),
    when(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);return v.input.roll<=(s.ascension>=19?30:15)&&s.history[0]!==mm.THE_CHAMP_DEFENSIVE_STANCE&&(v.get(readComponent(v.input.enemy,champData))&3)<2;}),sequence(updateLocalComponent(b.read(v=>v.input.enemy),champData,n=>n+1),b.return(mm.THE_CHAMP_DEFENSIVE_STANCE))),
    b.return(b.read(v=>{const h=v.query(enemies.exports.current,v.input.enemy).history;if(v.input.roll<=30&&h[0]!==mm.THE_CHAMP_GLOAT&&h[0]!==mm.THE_CHAMP_DEFENSIVE_STANCE)return mm.THE_CHAMP_GLOAT;if(v.input.roll<=55&&h[0]!==mm.THE_CHAMP_FACE_SLAP)return mm.THE_CHAMP_FACE_SLAP;return h[0]!==mm.THE_CHAMP_HEAVY_SLASH?mm.THE_CHAMP_HEAVY_SLASH:mm.THE_CHAMP_FACE_SLAP;})),
  ));
  const cleanse=defineEffect<EnemyAction,void>(b=>call(enemyOperations.exports.cleanse,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.actor),only:null}));
  const Champ=enemyDefinition({id:mid.THE_CHAMP,threshold:9,components:[champData],choose:champChoose,presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[champData],base:(r,e)=>({miscInfo:r.component(e,champData)})}),moves:[
    {move:mm.THE_CHAMP_ANGER,execute:enemyProgram(cleanse,enemyPower(basicPowers.exports.Strength,v=>state(v).ascension>=19?12:state(v).ascension>=4?9:6),defineEffect<EnemyAction,void>(b=>call(enemies.exports.roll,b.read(v=>v.input.enemy))))},
    {move:mm.THE_CHAMP_DEFENSIVE_STANCE,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:b.read(v=>state(v).ascension>=19?20:state(v).ascension>=9?18:15)}),call(enemyPower(combatEnemyPowers.exports.Metallicize,v=>state(v).ascension>=19?7:state(v).ascension>=9?6:5),b.input),call(enemies.exports.roll,b.read(v=>v.input.enemy))))},
    attackMove(mm.THE_CHAMP_EXECUTE,enemyAttack(10,2),attack=>enemyProgram(attack,rollEnemyAfter)),
    attackMove(mm.THE_CHAMP_FACE_SLAP,enemyAttack(v=>state(v).ascension>=4?14:12),attack=>enemyProgram(attack,enemyPower(basicPowers.exports.Frail,2,true,true,true),enemyPower(basicPowers.exports.PlayerVulnerable,2,true,true,true),rollEnemyAfter)),
    {move:mm.THE_CHAMP_GLOAT,execute:enemyProgram(enemyPower(basicPowers.exports.Strength,v=>state(v).ascension>=19?5:state(v).ascension>=4?4:3),defineEffect<EnemyAction,void>(b=>call(enemies.exports.roll,b.read(v=>v.input.enemy))))},
    attackMove(mm.THE_CHAMP_HEAVY_SLASH,enemyAttack(v=>state(v).ascension>=4?18:16),attack=>enemyProgram(attack,rollEnemyAfter)),
    {move:mm.THE_CHAMP_TAUNT,execute:enemyProgram(enemyPower(basicPowers.exports.PlayerWeak,2,true,true),enemyPower(basicPowers.exports.PlayerVulnerable,2,true,true),defineEffect<EnemyAction,void>(b=>call(enemies.exports.roll,b.read(v=>v.input.enemy))))},
  ]});

  const torchHealth=enemyHealth(mid.TORCH_HEAD,9);
  const doubleTorchHealth=defineQuery({input:z.number(),output:importHealthSchema,dependencies:[torchHealth],base:(r,a)=>{const h=r.query(torchHealth,a);return{...h,discard:[{minimum:h.minimum,maximum:h.maximum}]};}});
  const TorchHead=enemyDefinition({id:mid.TORCH_HEAD,threshold:9,health:doubleTorchHealth,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.TORCH_HEAD_TACKLE)),initialize:defineEffect<rules.EntityLifecycle<import('../../../rules/enemies.types.ts').EnemySetup>,void>(()=>sequence()),moves:[attackMove(mm.TORCH_HEAD_TACKLE,enemyAttack(7),attack=>attack)]});
  const spawnTorches=defineEffect<EnemyAction,void>(b=>{const pool=b.local<EnemyDefinition[]>();return sequence(b.assign(pool,[TorchHead]),call(enemyDeployOperation.exports.deploy,b.read(v=>{
    const id=v.query(combatSessions.exports.forBattle,v.input.battle);if(id===null)throw Error('Summon needs a session');const roster=v.query(combatSessions.exports.current,id).roster,dead=(slot:number)=>roster[slot]?.actor==null||v.query(resources.exports.vitality,roster[slot]!.actor!).hp<=0;
    const slots=[dead(1)?1:0,0].slice(0,3-v.query(battles.exports.targets,v.input.battle).length);
    return{battle:v.input.battle,source:v.input.enemy,entries:slots.map(slot=>({slot,choices:v.get(pool),hp:null,move:mm.TORCH_HEAD_TACKLE})),prepare:'each' as const,roll:'each' as const,minion:true,extent:null,skipCursor:null,noopRolls:slots.length};
  })));});
  const collectorChoose=defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);if(s.history[0]===0)return mm.THE_COLLECTOR_SPAWN;if(v.query(battles.exports.status,s.battle).turn===3)return mm.THE_COLLECTOR_MEGA_DEBUFF;if(v.input.roll<=25&&v.query(battles.exports.targets,s.battle).length<3&&s.history[0]!==mm.THE_COLLECTOR_SPAWN)return mm.THE_COLLECTOR_SPAWN;if(v.input.roll<=70&&!s.history.every(move=>move===mm.THE_COLLECTOR_FIREBALL))return mm.THE_COLLECTOR_FIREBALL;return s.history[0]===mm.THE_COLLECTOR_BUFF?mm.THE_COLLECTOR_FIREBALL:mm.THE_COLLECTOR_BUFF;})));
  const Collector=enemyDefinition({id:mid.THE_COLLECTOR,threshold:9,choose:collectorChoose,initialize:enemyInitialize(enemyAtStart(enemyPower(combatEnemyPowers.exports.MinionLeader,1))),moves:[
    attackMove(mm.THE_COLLECTOR_FIREBALL,enemyAttack(v=>state(v).ascension>=4?21:18),attack=>enemyProgram(attack,rollEnemyAfter)),
    {move:mm.THE_COLLECTOR_MEGA_DEBUFF,execute:enemyProgram(enemyPower(basicPowers.exports.PlayerWeak,3,true,true,true),enemyPower(basicPowers.exports.PlayerVulnerable,3,true,true,true),enemyPower(basicPowers.exports.Frail,3,true,true,true),rollEnemyAfter)},
    {move:mm.THE_COLLECTOR_SPAWN,execute:defineEffect<EnemyAction,void>(b=>sequence(enqueue(spawnTorches,b.input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),call(rollEnemyAfter,b.input)))},
    {move:mm.THE_COLLECTOR_BUFF,execute:defineEffect<EnemyAction,void>(b=>sequence(forEach(query(battles.exports.targets,b.read(v=>v.input.battle)),actor=>call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,definition:basicPowers.exports.Strength,amount:b.read(v=>state(v).ascension>=19?5:state(v).ascension>=4?4:3),source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:b.read(v=>state(v).ascension>=19?23:state(v).ascension>=4?18:15)}),call(rollEnemyAfter,b.input)))},
  ]});
  return{exports:{GremlinLeader,Champ,Collector,TorchHead,chooseGremlin}};
}});
