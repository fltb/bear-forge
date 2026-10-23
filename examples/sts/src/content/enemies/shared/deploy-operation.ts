import {rules} from '../../../rules/execution.ts';
import {combatOperations,defineOperation,OperationKind} from '../../../rules/combat-operations.ts';
import {enemyDeployment} from './deployment.ts';
import {enemyOperations} from './operations.ts';
import {enemies} from '../../../rules/enemies.ts';
import {battles} from '../../../rules/battles.ts';
import {turns} from '../../../rules/turns.ts';
import {combatSessions} from '../../../rules/combat-sessions.ts';
import {random} from '../../../rules/random.ts';
import {adventures} from '../../../rules/adventures.ts';
import {basicPowers} from '../../powers/attributes.ts';
import {combatEnemyPowers} from './combat-powers.ts';
import type {EnemyDefinition} from '../../../rules/enemies.types.ts';

type Deployment={slot:number;choices:readonly EnemyDefinition[];hp:number|null;move:number|null};
type DeploymentGroup={battle:number;source:number;entries:readonly Deployment[];prepare:'each'|'after'|'none';roll:'each'|'after';minion:boolean;extent:number|null;skipCursor:number|null;noopRolls:number};
/** Deploying a group is one admission unit. Random construction/initial-roll
 * order is explicit; no content callback executes inside this privilege. */
export const enemyDeployOperation=rules.defineRules({requires:[combatOperations,enemyDeployment,enemyOperations,enemies,battles,turns,combatSessions,random,adventures,basicPowers,combatEnemyPowers],build(){
  const initializePowers=rules.defineEffect<{battle:number;enemy:number;minion:boolean},void>(b=>rules.sequence(
    rules.when(b.read(v=>v.input.minion),rules.call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.query(enemies.exports.current,v.input.enemy).actor),definition:combatEnemyPowers.exports.Minion,amount:1,source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),
    rules.when(b.read(v=>{const run=v.query(adventures.exports.forActor,v.query(battles.exports.status,v.input.battle).actor);return run!==null&&v.query(adventures.exports.hasRelic,{run,id:'PHILOSOPHERS_STONE'});}),rules.call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.query(enemies.exports.current,v.input.enemy).actor),definition:basicPowers.exports.Strength,amount:1,source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})),
  ));
  const deploy=defineOperation<DeploymentGroup,readonly number[]>(OperationKind.Deploy,[],b=>{
    const made=b.local<number[]>(),created=b.local<number>(),selected=b.local<number>();
    return rules.sequence(b.assign(made,[]),rules.forEach(b.read(v=>v.input.entries),entry=>rules.sequence(
      b.assign(selected,0),rules.when(b.read(v=>v.get(entry).choices.length>1),b.assign(selected,rules.call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.source).aiRng),start:0,end:b.read(v=>v.get(entry).choices.length-1)}))),
      b.assign(created,rules.call(enemyDeployment.exports.deploy,{battle:b.read(v=>v.input.battle),slot:b.read(v=>v.get(entry).slot),definition:b.read(v=>v.get(entry).choices[v.get(selected)]!),hp:b.read(v=>v.get(entry).hp),currentMove:b.read(v=>v.get(entry).move),prepare:b.read(v=>v.input.prepare==='each'),deferInitialRoll:b.read(v=>v.input.roll==='after')})),
      rules.call(enemies.exports.claim,created),b.assign(made,b.read(v=>[...v.get(made),v.get(created)])),
      rules.when(b.read(v=>v.input.prepare!=='after'),rules.call(initializePowers,{battle:b.read(v=>v.input.battle),enemy:created,minion:b.read(v=>v.input.minion)})),
    )),
    rules.forEach(made,enemy=>rules.sequence(
      rules.when(b.read(v=>v.input.prepare==='after'),rules.sequence(rules.call(enemies.exports.prepare,enemy),rules.call(initializePowers,{battle:b.read(v=>v.input.battle),enemy,minion:b.read(v=>v.input.minion)}))),
      rules.when(b.read(v=>v.input.roll==='after'),rules.call(enemies.exports.roll,enemy)),
    )),
    rules.forEach(b.read(v=>Array.from({length:v.input.noopRolls})),()=>rules.call(enemies.exports.noopRoll,b.read(v=>v.input.source))),
    rules.when(b.read(v=>v.input.extent!==null),rules.sequence(
      rules.call(combatSessions.exports.setRoster,b.read(v=>{const session=v.query(combatSessions.exports.forBattle,v.input.battle);if(session===null)throw Error('Deployment needs a session');const roster=[...v.query(combatSessions.exports.current,session).roster];while(roster.length<v.input.extent!)roster.push({actor:null,controller:null,id:0,name:'INVALID',miscInfo:0,initialized:false});return{session,roster};})),
      rules.call(turns.exports.setEnemies,b.read(v=>{const controller=v.query(turns.exports.forBattle,v.input.battle);if(controller===null)throw Error('Deployment needs a turn controller');return{controller,enemies:v.query(turns.exports.current,controller).enemies,extent:v.input.extent!};})),
    )),
    rules.when(b.read(v=>{const controller=v.query(turns.exports.forBattle,v.input.battle);return v.input.skipCursor!==null&&controller!==null&&v.query(turns.exports.current,controller).phase===3;}),rules.call(turns.exports.seekEnemy,b.read(v=>{const controller=v.query(turns.exports.forBattle,v.input.battle);if(controller===null)throw Error('Deployment needs a turn controller');return{controller,cursor:v.input.skipCursor!};}))),
    b.return(made));
  });
  return{exports:{deploy}};
}});
