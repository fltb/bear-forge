import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {resources} from "../../../rules/resources.ts";
import {random} from "../../../rules/random.ts";
import type {EnemyDefinition,EnemyHealth} from "../../../rules/enemies.types.ts";
export type PreparedEnemy={actor:number;controller:number|null;id:number;name:string;miscInfo:number;parameters:number[]};
const {defineRules,defineEntity,defineEffect,sequence,when,forEach,call,query,spawnEntity}=rules;
/** Shared L3 construction: source health draws and per-monster parameters stay interleaved. */
export const enemyConstruction=defineRules({requires:[enemies,resources,random],build(){
  const actorDefinition=defineEntity(resources.exports.actor,{side:1});
  const prepare=defineEffect<{definition:EnemyDefinition;owner:number;scope:number;hpRng:number;ascension:number;fixedHealth?:number|undefined},PreparedEnemy>(b=>{const health=b.local<EnemyHealth>(),hp=b.local<number>(),parameters=b.local<number[]>(),parameter=b.local<number>(),actor=b.local<number>();return sequence(
    when(b.read(v=>v.input.fixedHealth!==undefined),sequence(b.assign(hp,b.read(v=>v.input.fixedHealth!)),b.assign(parameters,[])),sequence(
b.assign(health,query(enemies.exports.definitionHealth,{definition:b.read(v=>v.input.definition),ascension:b.read(v=>v.input.ascension)})),forEach(b.read(v=>v.get(health).discard),range=>call(random.exports.int,{stream:b.read(v=>v.input.hpRng),start:b.read(v=>v.get(range).minimum),end:b.read(v=>v.get(range).maximum)})),
    when(b.read(v=>v.get(health).draw),b.assign(hp,call(random.exports.int,{stream:b.read(v=>v.input.hpRng),start:b.read(v=>v.get(health).minimum),end:b.read(v=>v.get(health).maximum)})),b.assign(hp,b.read(v=>v.get(health).minimum))),
    b.assign(parameters,[]),forEach(b.read(v=>v.get(health).parameters),range=>sequence(b.assign(parameter,call(random.exports.int,{stream:b.read(v=>v.input.hpRng),start:b.read(v=>v.get(range).minimum),end:b.read(v=>v.get(range).maximum)})),b.assign(parameters,b.read(v=>[...v.get(parameters),v.get(parameter)]))))
    )),
    b.assign(actor,spawnEntity({definition:actorDefinition,owner:b.read(v=>v.input.owner),scope:b.read(v=>v.input.scope),setup:{hp,maxHp:hp,block:0,energy:0,gold:0}})),b.return(b.read(v=>({...v.query(enemies.exports.metadata,v.input.definition),actor:v.get(actor),controller:null,miscInfo:0,parameters:v.get(parameters)}))),
  );});
  return{exports:{prepare}};
}});
