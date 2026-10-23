import {enemyOperations} from '../shared/operations.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {pileCards} from "../../cards/statuses/definitions.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {adventures} from "../../../rules/adventures.ts";
import {actionQueue as importQueue} from "../../../rules/combat-actions.ts";
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {random} from "../../../rules/random.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {beyondPowers} from "./powers.ts";
import {enemyBlast,attackMove,enemyUtilities,enemyDefinition,enemyHealth,enemyAttack,enemyPower,enemyProgram,rollEnemyAfter,enemyAtStart,enemyInitialize} from "../shared/programs.ts";
import {enemyCards,enemySuicide} from "../shared/cards.ts";
import {moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll} from "../../../rules/enemies.types.ts";
const {defineRules,defineEffect,defineQuery,defineComponent,sequence,when,whileDo,call,query,readComponent,updateLocalComponent}=rules;

export const beyondEnemies=defineRules({requires:[enemyOperations,enemyUtilities,enemies,battles,resources,powers,random,adventures,basicPowers,beyondPowers,pileCards],build(){
  const s=(v:Pick<rules.ReadView<EnemyAction>,'input'|'query'>)=>v.query(enemies.exports.current,v.input.enemy);
  const next=(move:number)=>defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move}));
  const noop=defineEffect<EnemyAction,void>(b=>call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)));
  const directRoll=defineEffect<EnemyAction,void>(b=>call(enemies.exports.roll,b.read(v=>v.input.enemy)));
  const Exploder=enemyDefinition({id:mid.EXPLODER,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.EXPLODER_SLAM)),moves:[
    attackMove(mm.EXPLODER_SLAM,enemyAttack(v=>s(v).ascension>=2?11:9),attack=>enemyProgram(attack,defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>s(v).history.every(m=>m===mm.EXPLODER_SLAM)?mm.EXPLODER_EXPLODE:mm.EXPLODER_SLAM)})),noop)),
    attackMove(mm.EXPLODER_EXPLODE,enemyBlast(30),blast=>enemyProgram(blast,enemySuicide(true),noop)),
  ]});
  const Repulsor=enemyDefinition({id:mid.REPULSOR,choose:defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>v.input.roll<20&&v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.REPULSOR_BASH?mm.REPULSOR_BASH:mm.REPULSOR_REPULSE))),moves:[attackMove(mm.REPULSOR_BASH,enemyAttack(v=>s(v).ascension>=2?13:11),attack=>enemyProgram(attack,rollEnemyAfter)),{move:mm.REPULSOR_REPULSE,execute:enemyProgram(enemyCards(pileCards.exports.Dazed,2,0,true,false),directRoll)}]});
  const spikes=defineComponent({schema:z.int32(),initial:()=>0});
  const Spiker=enemyDefinition({id:mid.SPIKER,components:[spikes],initialize:enemyInitialize(enemyAtStart(enemyPower(beyondPowers.exports.Thorns,v=>s(v).ascension>=17?7:s(v).ascension>=2?4:3))),choose:defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>v.get(readComponent(v.input.enemy,spikes))>5||v.input.roll<50&&v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.SPIKER_CUT?mm.SPIKER_CUT:mm.SPIKER_SPIKE))),presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[spikes],base:(r,e)=>({miscInfo:r.component(e,spikes)})}),moves:[attackMove(mm.SPIKER_CUT,enemyAttack(v=>s(v).ascension>=2?9:7),attack=>enemyProgram(attack,rollEnemyAfter)),{move:mm.SPIKER_SPIKE,execute:defineEffect<EnemyAction,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.enemy),spikes,n=>n+1),call(enemyPower(beyondPowers.exports.Thorns,2),b.input),call(directRoll,b.input)))}]});
  const Maw=enemyDefinition({id:mid.THE_MAW,health:enemyHealth(mid.THE_MAW,7,[],false),choose:defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>{const h=v.query(enemies.exports.current,v.input.enemy).history;return h[0]===0?mm.THE_MAW_ROAR:v.input.roll<50&&h[0]!==mm.THE_MAW_NOM?mm.THE_MAW_NOM:h[0]!==mm.THE_MAW_SLAM?mm.THE_MAW_SLAM:mm.THE_MAW_DROOL;}))),moves:[
    {move:mm.THE_MAW_DROOL,execute:enemyProgram(enemyPower(basicPowers.exports.Strength,v=>s(v).ascension>=17?5:3),directRoll)},
    attackMove(mm.THE_MAW_NOM,enemyAttack(5,v=>Math.trunc((v.input.turn+1)/2)),attack=>enemyProgram(attack,next(mm.THE_MAW_DROOL),noop)),
    {move:mm.THE_MAW_ROAR,execute:enemyProgram(enemyPower(basicPowers.exports.PlayerWeak,v=>s(v).ascension>=17?5:3,true,true),enemyPower(basicPowers.exports.Frail,v=>s(v).ascension>=17?5:3,true,true),directRoll)},
    attackMove(mm.THE_MAW_SLAM,enemyAttack(v=>s(v).ascension>=2?30:25),attack=>enemyProgram(attack,rollEnemyAfter)),
  ]});
  const OrbWalker=enemyDefinition({id:mid.ORB_WALKER,health:enemyHealth(mid.ORB_WALKER,7,[{minimum:90,maximum:96}]),initialize:enemyInitialize(enemyAtStart(enemyPower(beyondPowers.exports.StrengthUp,v=>s(v).ascension>=17?5:3))),choose:defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>{const h=v.query(enemies.exports.current,v.input.enemy).history;return v.input.roll<40?(h.every(m=>m===mm.ORB_WALKER_CLAW)?mm.ORB_WALKER_LASER:mm.ORB_WALKER_CLAW):h.every(m=>m===mm.ORB_WALKER_LASER)?mm.ORB_WALKER_CLAW:mm.ORB_WALKER_LASER;}))),moves:[attackMove(mm.ORB_WALKER_CLAW,enemyAttack(v=>s(v).ascension>=2?16:15),attack=>enemyProgram(attack,rollEnemyAfter)),attackMove(mm.ORB_WALKER_LASER,enemyAttack(v=>s(v).ascension>=2?11:10),attack=>enemyProgram(attack,enemyCards(pileCards.exports.Burn,1,0,true),enemyCards(pileCards.exports.Burn,1,2),rollEnemyAfter))]});
  const Growth=enemyDefinition({id:mid.SPIRE_GROWTH,choose:defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy),board=v.query(battles.exports.status,s.battle),power=v.query(powers.exports.find,{registry:board.registry,actor:board.actor,definition:beyondPowers.exports.Constricted});if((power===null||!v.query(powers.exports.enabled,power))&&s.history[0]!==mm.SPIRE_GROWTH_CONSTRICT&&(s.ascension>=17||v.input.roll>=50))return mm.SPIRE_GROWTH_CONSTRICT;return v.input.roll<50&&!s.history.every(m=>m===mm.SPIRE_GROWTH_QUICK_TACKLE)?mm.SPIRE_GROWTH_QUICK_TACKLE:!s.history.every(m=>m===mm.SPIRE_GROWTH_SMASH)?mm.SPIRE_GROWTH_SMASH:mm.SPIRE_GROWTH_QUICK_TACKLE;}))),moves:[attackMove(mm.SPIRE_GROWTH_QUICK_TACKLE,enemyAttack(v=>s(v).ascension>=2?18:16),attack=>enemyProgram(attack,rollEnemyAfter)),attackMove(mm.SPIRE_GROWTH_SMASH,enemyAttack(v=>s(v).ascension>=2?25:22),attack=>enemyProgram(attack,rollEnemyAfter)),{move:mm.SPIRE_GROWTH_CONSTRICT,execute:enemyProgram(enemyPower(beyondPowers.exports.Constricted,v=>s(v).ascension>=17?12:10,true,true),rollEnemyAfter)}]});
  const Transient=enemyDefinition({id:mid.TRANSIENT,health:enemyHealth(mid.TRANSIENT,7,[],false),choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.TRANSIENT_ATTACK)),initialize:enemyInitialize(enemyAtStart(enemyProgram(enemyPower(beyondPowers.exports.Shifting,1),enemyPower(beyondPowers.exports.Fading,v=>s(v).ascension>=17?6:5))),rules.modify(battles.exports.canContinue,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),dependencies:[enemies.exports.current],base:(r,c)=>r.query(enemies.exports.current,c.source).battle===c.input}),transform:()=>true})),moves:[attackMove(mm.TRANSIENT_ATTACK,enemyAttack(v=>(s(v).ascension>=2?40:30)+10*(v.input.turn-1)),attack=>enemyProgram(attack,beyondPowers.exports.programs.Fading.afterAttack))]});
  const darkChoose=defineEffect<EnemyRoll,number>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,b.read(v=>v.input.roll)),whileDo(true,sequence(
    when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===0),b.return(b.read(v=>v.get(roll)<50?mm.DARKLING_HARDEN:mm.DARKLING_NIP))),when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).halfDead),b.return(mm.DARKLING_REINCARNATE)),
    when(b.read(v=>v.get(roll)<40),sequence(when(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);return s.history[0]!==mm.DARKLING_CHOMP&&s.slot!==1;}),b.return(mm.DARKLING_CHOMP)),b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:40,end:99})))),
    when(b.read(v=>v.get(roll)<70),b.return(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.DARKLING_HARDEN?mm.DARKLING_HARDEN:mm.DARKLING_NIP))),
    when(b.read(v=>!v.query(enemies.exports.current,v.input.enemy).history.every(m=>m===mm.DARKLING_NIP)),b.return(mm.DARKLING_NIP)),b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:0,end:99})),
  )));});
  // Revival is one special operation: health, half-dead state and revival-only
  // power initialization must either all happen or all stay pending. AI rolling
  // remains outside the gate so a suppressed revival can be attempted later.
  const reincarnate=defineEffect<EnemyAction,void>(b=>{const initial=b.local<{definition:import('../../../rules/powers.types.ts').PowerDefinition;amount:number}[]>();return sequence(
    b.assign(initial,[{definition:beyondPowers.exports.Regrow,amount:1}]),
    when(b.read(v=>{const run=v.query(adventures.exports.forActor,v.query(battles.exports.status,v.input.battle).actor);return run!==null&&v.query(adventures.exports.hasRelic,{run,id:'PHILOSOPHERS_STONE'});}),b.assign(initial,[{definition:beyondPowers.exports.Regrow,amount:1},{definition:basicPowers.exports.Strength,amount:1}])),
    call(enemyOperations.exports.revive,{enemy:b.read(v=>v.input.enemy),hp:b.read(v=>Math.trunc(v.query(resources.exports.vitality,v.input.actor).maxHp/2)),maxHp:b.read(v=>v.query(resources.exports.vitality,v.input.actor).maxHp),move:null,cleanse:false,powers:initial}),
  );});
  const Darkling=enemyDefinition({id:mid.DARKLING,health:enemyHealth(mid.DARKLING,7,[],true,a=>[{minimum:a>=2?9:7,maximum:a>=2?13:11}]),choose:darkChoose,initialize:enemyInitialize(enemyAtStart(enemyPower(beyondPowers.exports.Regrow,1))),presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),dependencies:[enemies.exports.current],base:(r,e)=>({miscInfo:r.query(enemies.exports.current,e).parameters?.[0]??0})}),moves:[
    attackMove(mm.DARKLING_CHOMP,enemyAttack(v=>s(v).ascension>=2?9:8),attack=>enemyProgram(attack,rollEnemyAfter)),
    {move:mm.DARKLING_HARDEN,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:12}),when(b.read(v=>s(v).ascension>=17),call(enemyPower(basicPowers.exports.Strength,2),b.input)),call(directRoll,b.input)))},
    attackMove(mm.DARKLING_NIP,enemyAttack(v=>(s(v).parameters?.[0]??0)+(s(v).ascension>=2?2:0)),attack=>enemyProgram(attack,rollEnemyAfter)),
    {move:mm.DARKLING_REGROW,execute:directRoll},
    {move:mm.DARKLING_REINCARNATE,execute:enemyProgram(reincarnate,directRoll)},
  ]});
  return{exports:{Exploder,Repulsor,Spiker,Maw,OrbWalker,Growth,Transient,Darkling}};
}});
