import {rules} from '@bear-forge/card-engine';
import {combatSessions} from '../rules/combat-sessions.ts';
import {battles} from '../rules/battles.ts';
import {enemies} from '../rules/enemies.ts';
import {turns} from '../rules/turns.ts';
import {resources} from '../rules/resources.ts';
import {enemyConstruction,type PreparedEnemy} from './enemy-construction.ts';
import type {EnemyDefinition} from '../rules/enemies.types.ts';
const {defineRules,defineEffect,sequence,when,call,query,spawnEntity}=rules;
/** L3 reuse for summons and splits. Construction and owner updates use ordinary typed calls. */
export const enemyDeployment=defineRules({requires:[enemyConstruction,combatSessions],build(){
  const deploy=defineEffect<{battle:number;slot:number;definition:EnemyDefinition;hp:number|null;currentMove:number|null;prepare?:boolean|undefined;deferInitialRoll?:boolean|undefined},number>(b=>{const session=b.local<number>(),prepared=b.local<PreparedEnemy>(),controller=b.local<number>();return sequence(
    b.assign(session,b.read(v=>{const id=v.get(query(combatSessions.exports.forBattle,v.input.battle));if(id===null)throw Error('Deployment needs a combat session');return id;})),
    b.assign(prepared,call(enemyConstruction.exports.prepare,{definition:b.read(v=>v.input.definition),owner:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).run),scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope),hpRng:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).streams.monsterHp),ascension:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).ascension),fixedHealth:b.read(v=>v.input.hp??undefined)})),
    when(b.read(v=>v.input.hp!==null),call(resources.exports.setHealth,{entity:b.read(v=>v.get(prepared).actor),hp:b.read(v=>v.input.hp!),maxHp:b.read(v=>v.input.hp!)})),
    call(battles.exports.setEnemies,{battle:b.read(v=>v.input.battle),replacements:b.read(v=>{const old=v.get(query(combatSessions.exports.current,v.get(session))).roster[v.input.slot]?.actor;return old==null?[]:[{from:old,to:v.get(prepared).actor}];}),enemies:b.read(v=>{const s=v.get(query(combatSessions.exports.current,v.get(session))),roster=[...s.roster];while(roster.length<=v.input.slot)roster.push({actor:null,controller:null,id:0,name:'INVALID',miscInfo:0,initialized:false});roster[v.input.slot]={...v.get(prepared),controller:null};return roster.flatMap(entry=>entry.actor===null?[]:[entry.actor]);})}),
    b.assign(controller,spawnEntity({kind:enemies.exports.kind,definition:b.read(v=>v.input.definition),owner:b.read(v=>v.get(prepared).actor),scope:b.read(v=>v.get(query(battles.exports.current,v.input.battle)).scope),setup:{actor:b.read(v=>v.get(prepared).actor),battle:b.read(v=>v.input.battle),slot:b.read(v=>v.input.slot),deferInitialRoll:b.read(v=>v.input.deferInitialRoll),aiRng:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).streams.ai),hpRng:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).streams.monsterHp),parameters:b.read(v=>v.get(prepared).parameters),ascension:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).ascension)}})),
    when(b.read(v=>v.input.prepare!==false),call(enemies.exports.prepare,controller)),
    when(b.read(v=>v.input.currentMove!==null),call(enemies.exports.setMove,{enemy:controller,move:b.read(v=>v.input.currentMove!)})),
    call(combatSessions.exports.setRoster,{session,roster:b.read(v=>{const s=v.get(query(combatSessions.exports.current,v.get(session))),roster=[...s.roster];while(roster.length<=v.input.slot)roster.push({actor:null,controller:null,id:0,name:'INVALID',miscInfo:0,initialized:false});roster[v.input.slot]={...v.get(prepared),controller:v.get(controller)};return roster;})}),
    call(turns.exports.setEnemies,{controller:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).controller),extent:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).roster.length),enemies:b.read(v=>v.get(query(combatSessions.exports.current,v.get(session))).roster.flatMap(entry=>entry.controller===null?[]:[entry.controller]))}),b.return(controller),
  );});
  return{exports:{deploy}};
}});
