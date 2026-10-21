import {pileCards} from "../../cards/statuses/definitions.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {rules} from '@bear-forge/card-engine';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {resources} from "../../../rules/resources.ts";
import {random} from "../../../rules/random.ts";
import {attributes} from "../../../rules/attributes.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {finalPowers} from "./powers.ts";
import {cityPowers} from "../city/powers.ts";
import {enemyUtilities,enemyDefinition,enemyAttack,enemyBlock,enemyPower,enemyProgram,enemyAtStart,enemyInitialize,rollEnemyAfter} from "../shared/programs.ts";
import {enemyCards} from "../shared/cards.ts";
import {moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll} from "../../../rules/enemies.types.ts";
const {defineRules,defineEffect,sequence,when,forEach,call,query,enqueue}=rules;
export const finalEnemies=defineRules({requires:[enemyUtilities,enemies,battles,powers,resources,random,attributes,basicPowers,finalPowers,cityPowers,pileCards],build(){
  const s=(v:rules.ReadView<EnemyAction>)=>v.query(enemies.exports.current,v.input.enemy);
  const noop=defineEffect<EnemyAction,void>(b=>call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)));
  const directRoll=defineEffect<EnemyAction,void>(b=>call(enemies.exports.roll,b.read(v=>v.input.enemy)));
  const set=(move:number)=>defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move}));
  const pairStrength=defineEffect<EnemyAction,void>(b=>forEach(b.read(v=>v.query(battles.exports.status,v.input.battle).enemies),actor=>call(powers.exports.apply,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,definition:basicPowers.exports.Strength,amount:2,source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})));
  const Shield=enemyDefinition({id:mid.SPIRE_SHIELD,threshold:8,initialize:enemyInitialize(enemyAtStart(enemyProgram(enemyPower(basicPowers.exports.EnemyArtifact,v=>s(v).ascension>=18?2:1),enemyPower(finalPowers.exports.Surrounded,1,true)))),choose:defineEffect<EnemyRoll,number>(b=>{const coin=b.local<boolean>();return sequence(b.assign(coin,call(random.exports.boolean,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng)})),b.return(b.read(v=>v.get(coin)?mm.SPIRE_SHIELD_FORTIFY:mm.SPIRE_SHIELD_BASH)));}),moves:[
    {move:mm.SPIRE_SHIELD_BASH,damage:s=>s.ascension>=3?14:12,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=3?14:12),enemyPower(basicPowers.exports.Strength,-1,true,true),defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>[0,mm.SPIRE_SHIELD_SMASH].includes(s(v).history[1])?mm.SPIRE_SHIELD_FORTIFY:mm.SPIRE_SHIELD_SMASH)})),noop)},
    {move:mm.SPIRE_SHIELD_FORTIFY,execute:defineEffect<EnemyAction,void>(b=>sequence(forEach(b.read(v=>v.query(battles.exports.status,v.input.battle).enemies),entity=>call(resources.exports.gainBlock,{entity,amount:30})),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>[0,mm.SPIRE_SHIELD_SMASH].includes(s(v).history[1])?mm.SPIRE_SHIELD_BASH:mm.SPIRE_SHIELD_SMASH)}),call(noop,b.input)))},
    {move:mm.SPIRE_SHIELD_SMASH,damage:s=>s.ascension>=3?38:34,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=3?38:34),enemyBlock(v=>s(v).ascension>=18?99:v.query(attributes.exports.attackAmount,{source:v.input.actor,target:v.query(battles.exports.current,v.input.battle).actor,base:s(v).ascension>=3?38:34,card:null})),rollEnemyAfter)},
  ]});
  // Pinned MakeTempCardInDrawPile(shuffleInto=false) enqueues an action whose body is empty.
  const noBurns=defineEffect<EnemyAction,void>(()=>sequence());
  const Spear=enemyDefinition({id:mid.SPIRE_SPEAR,threshold:8,initialize:enemyInitialize(enemyAtStart(enemyPower(basicPowers.exports.EnemyArtifact,v=>s(v).ascension>=18?2:1))),choose:defineEffect<EnemyRoll,number>(b=>{const coin=b.local<boolean>();return sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===0),b.return(mm.SPIRE_SPEAR_BURN_STRIKE)),b.assign(coin,call(random.exports.boolean,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng)})),b.return(b.read(v=>v.get(coin)?mm.SPIRE_SPEAR_PIERCER:mm.SPIRE_SPEAR_BURN_STRIKE)));}),moves:[
    {move:mm.SPIRE_SPEAR_BURN_STRIKE,damage:s=>s.ascension>=3?6:5,hits:2,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyAttack(v=>s(v).ascension>=3?6:5,2),b.input),when(b.read(v=>s(v).ascension>=18),rules.enqueue(noBurns,b.input,{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),call(enemyCards(pileCards.exports.Burn,2,2),b.input)),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>s(v).history[1]===mm.SPIRE_SPEAR_SKEWER?mm.SPIRE_SPEAR_PIERCER:mm.SPIRE_SPEAR_SKEWER)}),call(noop,b.input)))},
    {move:mm.SPIRE_SPEAR_PIERCER,execute:enemyProgram(pairStrength,defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>s(v).history[1]===mm.SPIRE_SPEAR_SKEWER?mm.SPIRE_SPEAR_BURN_STRIKE:mm.SPIRE_SPEAR_SKEWER)})),noop)},
    {move:mm.SPIRE_SPEAR_SKEWER,damage:10,hits:s=>s.ascension>=3?4:3,execute:enemyProgram(enemyAttack(10,v=>s(v).ascension>=3?4:3),rollEnemyAfter)},
  ]});
  const heartChoose=defineEffect<EnemyRoll,number>(b=>{const coin=b.local<boolean>();return sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===0),b.return(mm.CORRUPT_HEART_DEBILITATE)),b.assign(coin,call(random.exports.boolean,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng)})),b.return(b.read(v=>v.get(coin)?mm.CORRUPT_HEART_BLOOD_SHOTS:mm.CORRUPT_HEART_ECHO)));});
  const cleanseStrength=defineEffect<EnemyAction,void>(b=>{const strength=b.local<number|null>();return sequence(b.assign(strength,query(powers.exports.find,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.actor),definition:basicPowers.exports.Strength})),when(b.read(v=>v.get(strength)!==null&&v.query(powers.exports.level,v.get(strength)!)<0),call(powers.exports.set,{entity:b.read(v=>v.get(strength)!),next:{level:0,active:false,justApplied:false}})));});
  const Heart=enemyDefinition({id:mid.CORRUPT_HEART,threshold:9,choose:heartChoose,initialize:enemyInitialize(enemyAtStart(enemyProgram(enemyPower(finalPowers.exports.BeatOfDeath,v=>s(v).ascension>=19?2:1),enemyPower(finalPowers.exports.Invincible,v=>s(v).ascension>=19?200:300)))),moves:[
    {move:mm.CORRUPT_HEART_DEBILITATE,execute:enemyProgram(enemyPower(basicPowers.exports.PlayerVulnerable,2,true,true),enemyPower(basicPowers.exports.PlayerWeak,2,true,true),enemyPower(basicPowers.exports.Frail,2,true,true),enemyCards(pileCards.exports.Dazed,1,0,true,false),enemyCards(pileCards.exports.Slimed,1,0,true,false),enemyCards(pileCards.exports.Wound,1,0,true,false),enemyCards(pileCards.exports.Burn,1,0,true,false),enemyCards(pileCards.exports.Void,1,0,true,false),directRoll)},
    {move:mm.CORRUPT_HEART_BLOOD_SHOTS,damage:2,hits:s=>s.ascension>=4?15:12,execute:enemyProgram(enemyAttack(2,v=>s(v).ascension>=4?15:12),defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.input.turn%3===0?mm.CORRUPT_HEART_BUFF:mm.CORRUPT_HEART_ECHO)})),noop)},
    {move:mm.CORRUPT_HEART_ECHO,damage:s=>s.ascension>=4?45:40,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=4?45:40),defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.input.turn%3===0?mm.CORRUPT_HEART_BUFF:mm.CORRUPT_HEART_BLOOD_SHOTS)})),noop)},
    {move:mm.CORRUPT_HEART_BUFF,execute:defineEffect<EnemyAction,void>(b=>sequence(call(cleanseStrength,b.input),call(enemyPower(basicPowers.exports.Strength,2),b.input),when(b.read(v=>Math.trunc(v.input.turn/3)===1),call(enemyPower(basicPowers.exports.EnemyArtifact,2),b.input),when(b.read(v=>Math.trunc(v.input.turn/3)===2),call(enemyPower(finalPowers.exports.BeatOfDeath,1),b.input),when(b.read(v=>Math.trunc(v.input.turn/3)===3),call(enemyPower(cityPowers.exports.PainfulStabs,1),b.input),call(enemyPower(basicPowers.exports.Strength,v=>Math.trunc(v.input.turn/3)===4?10:50),b.input)))),call(directRoll,b.input)))},
  ]});
  return{exports:{Shield,Spear,Heart}};
}});
