import {combatOperations,OperationKind} from '../../../rules/combat-operations.ts';
import {enemyDeployOperation} from '../shared/deploy-operation.ts';
import {enemyOperations} from '../shared/operations.ts';
import {enemyCards} from '../shared/cards.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {pileCards} from "../../cards/statuses/definitions.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {turns} from "../../../rules/turns.ts";
import {resources} from "../../../rules/resources.ts";
import {random} from "../../../rules/random.ts";
import {powers} from "../../../rules/powers.ts";
import {combatSessions} from "../../../rules/combat-sessions.ts";
import {adventures} from "../../../rules/adventures.ts";
import {enemyDeployment} from "../shared/deployment.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {enemyIntentFrom,enemyUtilities,enemyHealth,enemyAttack,enemyPower,enemyProgram,rollEnemyAfter,initialEnemyRoll} from "../shared/programs.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll,EnemySetup,EnemyDefinition} from "../../../rules/enemies.types.ts";
import type {HpLost} from "../../../rules/resources.types.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,forEach,call,query,on,install,enqueue}=rules;
export const slimes=defineRules({requires:[combatOperations,enemyDeployOperation,enemyOperations,enemyUtilities,enemies,enemyDeployment,basicPowers,pileCards,adventures],build(){
  const splitCanceled=rules.defineComponent({schema:z.boolean(),initial:()=>false});
  const canceled=defineQuery({input:z.number(),output:z.boolean(),reads:[splitCanceled],base:(r,id)=>r.component(id,splitCanceled)});
  const slimeCards=(count:number,immediate=false)=>enemyCards(pileCards.exports.Slimed,count,2,false,!immediate);
  function threshold(splitMove:number){return on(resources.exports.hpLost,{condition:defineQuery({input:typedValue<rules.ReactionContext<HpLost>>(),output:z.boolean(),reads:[splitCanceled],dependencies:[resources.exports.current,resources.exports.vitality],base:(r,c)=>!r.component(c.source,splitCanceled)&&c.event.entity===c.owner&&c.event.amount>0&&c.event.after>0&&c.event.after<=Math.trunc(r.query(resources.exports.vitality,c.owner).maxHp/2)}),effect:defineEffect<rules.ReactionContext<HpLost>,void>(b=>when(b.read(v=>v.query(combatOperations.exports.permitted,{operation:OperationKind.Deploy,polarity:1})),call(enemies.exports.replaceMove,{enemy:b.read(v=>v.input.source),move:splitMove}),rules.updateLocalComponent(b.read(v=>v.input.source),splitCanceled,true)))});}
  function splitInto(definitions:readonly EnemyDefinition[],boss=false){return defineEffect<EnemyAction,void>(b=>{const pool=b.local<EnemyDefinition[]>();return sequence(when(b.read(v=>v.query(canceled,v.input.enemy)||!v.query(combatOperations.exports.permitted,{operation:OperationKind.Deploy,polarity:1})),sequence(rules.updateLocalComponent(b.read(v=>v.input.enemy),splitCanceled,true),call(rollEnemyAfter,b.input),b.return(undefined))),b.assign(pool,[...definitions]),call(enemyDeployOperation.exports.deploy,b.read(v=>{
    const session=v.query(combatSessions.exports.forBattle,v.input.battle),controller=v.query(turns.exports.forBattle,v.input.battle);if(session===null||controller===null)throw Error('Split needs a session');
    const slot=v.query(enemies.exports.current,v.input.enemy).slot??0,hp=v.query(resources.exports.vitality,v.input.actor).hp;
    return{battle:v.input.battle,source:v.input.enemy,entries:v.get(pool).map((definition,index)=>({slot:boss?index*2:slot+index,choices:[definition],hp,move:null})),prepare:'each' as const,roll:'each' as const,minion:false,extent:boss?3:Math.min(v.query(combatSessions.exports.current,session).roster.length+1,4),skipCursor:boss?4:v.query(turns.exports.current,controller).cursor+1,noopRolls:boss?0:2};
  })));});}
  function acid(large:boolean){const spit=large?mm.ACID_SLIME_L_CORROSIVE_SPIT:mm.ACID_SLIME_M_CORROSIVE_SPIT,tackle=large?mm.ACID_SLIME_L_TACKLE:mm.ACID_SLIME_M_TACKLE,lick=large?mm.ACID_SLIME_L_LICK:mm.ACID_SLIME_M_LICK,id=large?mid.ACID_SLIME_L:mid.ACID_SLIME_M;
    const choose=defineEffect<EnemyRoll,number>(b=>{const coin=b.local<boolean>();const chance=(value:number,yes:number,no:number,native=false)=>sequence(b.assign(coin,native?call(random.exports.boolean,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng)}):call(random.exports.chance,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),chance:value})),b.return(b.read(v=>v.get(coin)?yes:no)));return sequence(
      when(b.read(v=>v.input.roll<(v.query(enemies.exports.current,v.input.enemy).ascension>=17?40:30)),when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history.every(move=>move===(large&&v.query(enemies.exports.current,v.input.enemy).ascension>=17?mm.ACID_SLIME_M_CORROSIVE_SPIT:spit))),when(b.read(v=>large&&v.query(enemies.exports.current,v.input.enemy).ascension>=17),chance(.6,tackle,lick),chance(.5,tackle,lick,true)),b.return(spit))),
      when(b.read(v=>v.input.roll<(large?70:v.query(enemies.exports.current,v.input.enemy).ascension>=17?80:70)),when(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);return s.ascension>=17?s.history.every(move=>move===tackle):s.history[0]===tackle;}),when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=17),chance(large?.6:.5,spit,lick),chance(.4,spit,lick)),b.return(tackle))),
      when(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);return s.ascension>=17?s.history[0]===lick:s.history.every(move=>move===lick);}),chance(.4,spit,tackle),b.return(lick)),
    );});
    const actAttack0=enemyAttack(v=>large?v.query(enemies.exports.current,v.input.enemy).ascension>=2?12:11:v.query(enemies.exports.current,v.input.enemy).ascension>=2?8:7);
const actAttack1=enemyAttack(v=>large?v.query(enemies.exports.current,v.input.enemy).ascension>=2?18:16:v.query(enemies.exports.current,v.input.enemy).ascension>=2?12:10);
const intent=enemyIntentFrom([[spit,actAttack0],[tackle,actAttack1]]);
    const act=defineEffect<EnemyAction,void>(b=>when(b.read(v=>large&&v.input.move===mm.ACID_SLIME_L_SPLIT),call(splitInto([AcidM,AcidM]),b.input),sequence(when(b.read(v=>v.input.move===spit),call(enemyProgram(actAttack0,slimeCards(large?2:1)),b.input),when(b.read(v=>v.input.move===tackle),call(actAttack1,b.input),call(enemyPower(basicPowers.exports.PlayerWeak,large?2:1,true,true,true),b.input))),call(rollEnemyAfter,b.input))));
    return defineEntity(enemies.exports.kind,{metadata:{id,name:large?'ACID_SLIME_L':'ACID_SLIME_M'},health:enemyHealth(id,7),intent,choose,act,initialize:defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>sequence(call(initialEnemyRoll,b.input),...(large?[install({ability:threshold(mm.ACID_SLIME_L_SPLIT),source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)})]:[])))},{components:[splitCanceled]});
  }
  const AcidM:EnemyDefinition=acid(false),AcidL:EnemyDefinition=acid(true);
  function spike(large:boolean){const tackle=large?mm.SPIKE_SLIME_L_FLAME_TACKLE:mm.SPIKE_SLIME_M_FLAME_TACKLE,lick=large?mm.SPIKE_SLIME_L_LICK:mm.SPIKE_SLIME_M_LICK,id=large?mid.SPIKE_SLIME_L:mid.SPIKE_SLIME_M;
    const choose=defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);return v.input.roll<30?s.history.every(m=>m===tackle)?lick:tackle:s.history.every(m=>m===lick)||s.ascension>=17&&s.history[0]===lick?tackle:lick;})));
    const actAttack0=enemyAttack(v=>large?v.query(enemies.exports.current,v.input.enemy).ascension>=2?18:16:v.query(enemies.exports.current,v.input.enemy).ascension>=2?10:8);
const intent=enemyIntentFrom([[tackle,actAttack0]]);
    const act=defineEffect<EnemyAction,void>(b=>when(b.read(v=>large&&v.input.move===mm.SPIKE_SLIME_L_SPLIT),call(splitInto([SpikeM,SpikeM]),b.input),sequence(when(b.read(v=>v.input.move===tackle),call(enemyProgram(actAttack0,slimeCards(large?2:1)),b.input),call(enemyPower(basicPowers.exports.Frail,v=>large?v.query(enemies.exports.current,v.input.enemy).ascension>=17?3:2:1,true,true,true),b.input)),call(rollEnemyAfter,b.input))));
    return defineEntity(enemies.exports.kind,{metadata:{id,name:large?'SPIKE_SLIME_L':'SPIKE_SLIME_M'},health:enemyHealth(id,7),intent,choose,act,initialize:defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>sequence(call(initialEnemyRoll,b.input),...(large?[install({ability:threshold(mm.SPIKE_SLIME_L_SPLIT),source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)})]:[])))},{components:[splitCanceled]});
  }
  const SpikeM:EnemyDefinition=spike(false),SpikeL:EnemyDefinition=spike(true);
  const smallAcidChoose=defineEffect<EnemyRoll,number>(b=>{const coin=b.local<boolean>();return sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=17),b.return(mm.ACID_SLIME_S_LICK)),b.assign(coin,call(random.exports.boolean,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng)})),b.return(b.read(v=>v.get(coin)?mm.ACID_SLIME_S_TACKLE:mm.ACID_SLIME_S_LICK)));});
  const AcidSAttack=enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=2?4:3);
const AcidS=defineEntity(enemies.exports.kind,{metadata:{id:mid.ACID_SLIME_S,name:'ACID_SLIME_S'},health:enemyHealth(mid.ACID_SLIME_S,7),choose:smallAcidChoose,intent:enemyIntentFrom([[mm.ACID_SLIME_S_TACKLE,AcidSAttack]]),act:defineEffect<EnemyAction,void>(b=>when(b.read(v=>v.input.move===mm.ACID_SLIME_S_TACKLE),sequence(call(AcidSAttack,b.input),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.ACID_SLIME_S_LICK})),sequence(call(enemyPower(basicPowers.exports.PlayerWeak,1,true,true,true),b.input),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.ACID_SLIME_S_TACKLE})))),initialize:initialEnemyRoll});
  const SpikeSAttack=enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=2?6:5);
const SpikeS=defineEntity(enemies.exports.kind,{metadata:{id:mid.SPIKE_SLIME_S,name:'SPIKE_SLIME_S'},health:enemyHealth(mid.SPIKE_SLIME_S,7),choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.SPIKE_SLIME_S_TACKLE)),intent:enemyIntentFrom([[mm.SPIKE_SLIME_S_TACKLE,SpikeSAttack]]),act:defineEffect<EnemyAction,void>(b=>sequence(call(SpikeSAttack,b.input),enqueue(enemies.exports.noopRoll,b.read(v=>v.input.enemy),{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}))),initialize:initialEnemyRoll});
  const SlimeBossAttack=enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=4?38:35);
const SlimeBoss=defineEntity(enemies.exports.kind,{metadata:{id:mid.SLIME_BOSS,name:'SLIME_BOSS'},health:enemyHealth(mid.SLIME_BOSS,9),choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.SLIME_BOSS_GOOP_SPRAY)),intent:enemyIntentFrom([[mm.SLIME_BOSS_SLAM,SlimeBossAttack]]),act:defineEffect<EnemyAction,void>(b=>when(b.read(v=>v.input.move===mm.SLIME_BOSS_SPLIT),call(splitInto([SpikeL,AcidL],true),b.input),when(b.read(v=>v.input.move===mm.SLIME_BOSS_GOOP_SPRAY),sequence(call(slimeCards(3,true),b.input),when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=19),call(slimeCards(2,true),b.input)),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.SLIME_BOSS_PREPARING})),when(b.read(v=>v.input.move===mm.SLIME_BOSS_PREPARING),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.SLIME_BOSS_SLAM}),sequence(call(SlimeBossAttack,b.input),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.SLIME_BOSS_GOOP_SPRAY})))))),initialize:defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>sequence(call(initialEnemyRoll,b.input),install({ability:threshold(mm.SLIME_BOSS_SPLIT),source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)})))},{components:[splitCanceled]});
  return{exports:{AcidS,AcidM,AcidL,SpikeS,SpikeM,SpikeL,SlimeBoss}};
}});
