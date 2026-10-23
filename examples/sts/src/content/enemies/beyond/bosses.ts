import {enemyAbilities,strengthAbility,contribution,settlement,defineDescribedEnemyPower,describedEnemyAbility} from '../shared/abilities.ts';
import {enemyOperations} from '../shared/operations.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {pileCards} from "../../cards/statuses/definitions.ts";
import {combatScope} from "../../../rules/combat-actions.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {cardInstances} from '../../../rules/card-instances.ts';
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {random} from "../../../rules/random.ts";
import {turns} from "../../../rules/turns.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {finalPowers} from "../ending/powers.ts";
import {enemyDefensePowers} from "../shared/defense-powers.ts";
import {combatEnemyPowers} from "../shared/combat-powers.ts";
import {counterPolicies} from "../../powers/utils.ts";
import {ownsTurn} from "../../powers/turn-hooks.ts";
import {attackMove,enemyUtilities,enemyDefinition,enemyAttack,enemyPower,enemyProgram,rollEnemyAfter,enemyAtStart,enemyInitialize} from "../shared/programs.ts";
import {enemyCards} from "../shared/cards.ts";
import {MS,PS,moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll,EnemySetup} from "../../../rules/enemies.types.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
import type {TurnActor} from "../../../rules/turns.types.ts";
const {defineRules,defineEffect,defineQuery,defineEntity,defineComponent,sequence,when,forEach,call,query,on,modify,install,readComponent,updateLocalComponent}=rules;
export const beyondBosses=defineRules({requires:[enemyOperations,enemyUtilities,enemies,battles,cardInstances,resources,powers,random,turns,basicPowers,finalPowers,enemyDefensePowers,combatEnemyPowers,pileCards],build(){
  const s=(v:Pick<rules.ReadView<EnemyAction>,'input'|'query'>)=>v.query(enemies.exports.current,v.input.enemy);
  const directRoll=defineEffect<EnemyAction,void>(b=>call(enemies.exports.roll,b.read(v=>v.input.enemy)));
  const noop=defineEffect<EnemyAction,void>(b=>call(enemies.exports.noopRoll,b.read(v=>v.input.enemy)));
  const next=(move:number)=>defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move}));
  const cleanse=defineEffect<EnemyAction,void>(b=>call(enemyOperations.exports.cleanse,{battle:b.read(v=>v.input.battle),actor:b.read(v=>v.input.actor),only:null}));
  const pairPower=(definition:import('../../../rules/powers.types.ts').PowerDefinition,amount:number)=>defineEffect<EnemyAction,void>(b=>forEach(b.read(v=>v.query(battles.exports.status,v.input.battle).enemies),actor=>call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor,definition,amount,source:b.read(v=>v.input.actor),debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.battle).scope)})));
  const Deca=enemyDefinition({id:mid.DECA,threshold:9,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.DECA_BEAM)),initialize:enemyInitialize(enemyAtStart(enemyPower(basicPowers.exports.EnemyArtifact,v=>s(v).ascension>=19?3:2))),moves:[
    attackMove(mm.DECA_BEAM,enemyAttack(v=>s(v).ascension>=4?12:10,2),attack=>enemyProgram(attack,enemyCards(pileCards.exports.Dazed,2,2),next(mm.DECA_SQUARE_OF_PROTECTION))),
    {move:mm.DECA_SQUARE_OF_PROTECTION,execute:defineEffect<EnemyAction,void>(b=>sequence(forEach(b.read(v=>v.query(battles.exports.status,v.input.battle).enemies),entity=>call(enemyOperations.exports.block,{entity,amount:16})),when(b.read(v=>s(v).ascension>=19),call(pairPower(enemyDefensePowers.exports.PlatedArmor,3),b.input)),call(next(mm.DECA_BEAM),b.input)))},
  ]});
  const Donu=enemyDefinition({id:mid.DONU,threshold:9,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.DONU_CIRCLE_OF_POWER)),initialize:enemyInitialize(enemyAtStart(enemyPower(basicPowers.exports.EnemyArtifact,v=>s(v).ascension>=19?3:2))),moves:[attackMove(mm.DONU_BEAM,enemyAttack(v=>s(v).ascension>=4?12:10,2),attack=>enemyProgram(attack,next(mm.DONU_CIRCLE_OF_POWER))),{move:mm.DONU_CIRCLE_OF_POWER,execute:enemyProgram(pairPower(basicPowers.exports.Strength,3),next(mm.DONU_BEAM))}]});

  const timeWarpLimit=11,timeWarpStep=1,timeWarpStrength=2;
  const timeWarp=on(battles.exports.afterUse,{condition:defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.current,battles.exports.current,battles.exports.status],base:(r,c)=>c.event.triggerOnUse&&r.query(powers.exports.enabled,c.source)&&r.query(powers.exports.current,c.source).registry===r.query(battles.exports.status,c.event.battle).registry&&r.query(battles.exports.status,c.event.battle).enemies[0]===c.owner}),order:{phase:battles.exports.stages.enemy,priority:0},effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>when(b.read(v=>v.query(powers.exports.level,v.input.source)===timeWarpLimit),sequence(call(enemyOperations.exports.setCounter,{entity:b.read(v=>v.input.source),next:{level:0,active:true,justApplied:false}}),call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(powers.exports.current,v.input.source).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:timeWarpStrength,source:null,debuff:false,scope:rules.scopeOf(b.read(v=>v.input.source),combatScope)}),call(enemyOperations.exports.forceEndTurn,b.read(v=>v.input.event.battle))),call(enemyOperations.exports.setCounter,{entity:b.read(v=>v.input.source),next:{level:b.read(v=>v.query(powers.exports.level,v.input.source)+timeWarpStep),active:true,justApplied:false}})))});
  const timeWarpProgram=defineDescribedEnemyPower('时间扭曲',{presentation:{key:MS.TIME_WARP,flag:false,slot:0},...counterPolicies({bits:32})},{},describedEnemyAbility(`持有者为当前战斗首个敌人时，每次触发使用效果的出牌结算后，计数增加${timeWarpStep}；增加前计数为${timeWarpLimit}时改为清零、获得${timeWarpStrength}力量并强制结束回合。`,strengthAbility(timeWarp)));
  const TimeWarp=timeWarpProgram.definition;
  const drawPenaltyStep=1,drawMinimum=0;
  const drawPenalty=defineComponent({schema:z.int32(),initial:()=>0});
  const drawReduce=modify(turns.exports.drawCount,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),dependencies:[turns.exports.current,battles.exports.current,powers.exports.current,battles.exports.status],base:(r,c)=>r.query(battles.exports.status,r.query(turns.exports.current,c.input).battle).actor===c.owner&&r.query(powers.exports.current,c.source).phase===1}),reads:[drawPenalty],transform:(r,c)=>Math.max(drawMinimum,c.value-r.component(c.source,drawPenalty))});
  const drawExpire=on(turns.exports.playerPostDrawPowers,{condition:ownsTurn(),order:{phase:turns.exports.stages.content,priority:-100},effect:defineEffect<rules.ReactionContext<TurnActor>,void>(b=>when(b.read(v=>v.query(powers.exports.current,v.input.source).justApplied),call(enemyOperations.exports.clearApplicationMarker,b.read(v=>v.input.source)),call(enemyOperations.exports.deactivatePower,b.read(v=>v.input.source)))) });
  // Restoring the draw counter is lifecycle bookkeeping after the power becomes inactive.
  const restoreDraw=on(powers.exports.changed,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number;before:import('../../../rules/powers.types.ts').PowerState;after:import('../../../rules/powers.types.ts').PowerState}>>(),output:z.boolean(),base:(_r,c)=>c.event.entity===c.source&&c.event.before.active&&!c.event.after.active}),effect:defineEffect<rules.ReactionContext<unknown>,void>(b=>updateLocalComponent(b.read(v=>v.input.source),drawPenalty,n=>n-drawPenaltyStep))});
  const drawReductionProgram=defineDescribedEnemyPower('抽牌减少',{presentation:{key:PS.DRAW_REDUCTION,flag:true},...counterPolicies({bits:16,flag:true,harmful:true,markOnEnemyDebuff:true}),merged:defineEffect<import('../../../rules/powers.types.ts').PowerMerged,void>(b=>updateLocalComponent(b.read(v=>v.input.entity),drawPenalty,n=>n+drawPenaltyStep))},{components:[drawPenalty],attach:abilities=>defineEffect<import('../../../rules/powers.types.ts').PowerLifecycle,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.entity),drawPenalty,drawPenaltyStep),call(abilities,b.input)))},describedEnemyAbility(`首次施加时记录${drawPenaltyStep}抽牌减少，每次叠加再增加${drawPenaltyStep}；生效阶段按记录值减少回合抽牌数，最低${drawMinimum}张。抽牌后若仍有新施加标记则清除标记，否则停用；停用时记录值减少${drawPenaltyStep}。`,contribution(drawReduce),contribution(drawExpire),settlement(restoreDraw)));
  const DrawReduction=drawReductionProgram.definition;
  const hasteUsed=defineComponent({schema:z.boolean(),initial:()=>false});
  const timeChoose=defineEffect<EnemyRoll,number>(b=>{const roll=b.local<number>(),coin=b.local<boolean>();return sequence(when(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy),hp=v.query(resources.exports.vitality,s.actor);return !v.get(readComponent(v.input.enemy,hasteUsed))&&hp.hp<Math.trunc(hp.maxHp/2);}),b.return(mm.TIME_EATER_HASTE)),b.assign(roll,b.read(v=>v.input.roll)),when(b.read(v=>v.get(roll)<45),sequence(when(b.read(v=>!v.query(enemies.exports.current,v.input.enemy).history.every(m=>m===mm.TIME_EATER_REVERBERATE)),b.return(mm.TIME_EATER_REVERBERATE)),b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:50,end:99})))),when(b.read(v=>v.get(roll)<80),sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.TIME_EATER_HEAD_SLAM),b.return(mm.TIME_EATER_HEAD_SLAM)),b.assign(coin,call(random.exports.chance,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),chance:.66})),b.return(b.read(v=>v.get(coin)?mm.TIME_EATER_REVERBERATE:mm.TIME_EATER_RIPPLE)))),when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===mm.TIME_EATER_RIPPLE),sequence(b.assign(roll,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:0,end:74})),b.return(b.read(v=>v.get(roll)<45?mm.TIME_EATER_REVERBERATE:mm.TIME_EATER_HEAD_SLAM)))),b.return(mm.TIME_EATER_RIPPLE));});
  const TimeEater=enemyDefinition({id:mid.TIME_EATER,threshold:9,components:[hasteUsed],choose:timeChoose,initialize:enemyInitialize(enemyAtStart(enemyPower(TimeWarp,0))),presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[hasteUsed],base:(r,e)=>({miscInfo:Number(r.component(e,hasteUsed))})}),moves:[
    {move:mm.TIME_EATER_HASTE,execute:defineEffect<EnemyAction,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.enemy),hasteUsed,true),call(enemyOperations.exports.restoreHealth,{entity:b.read(v=>v.input.actor),hp:b.read(v=>Math.trunc(v.query(resources.exports.vitality,v.input.actor).maxHp/2)),maxHp:b.read(v=>v.query(resources.exports.vitality,v.input.actor).maxHp)}),when(b.read(v=>s(v).ascension>=19),call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:32})),call(cleanse,b.input),call(directRoll,b.input)))},
    attackMove(mm.TIME_EATER_HEAD_SLAM,enemyAttack(v=>s(v).ascension>=4?32:26),attack=>defineEffect<EnemyAction,void>(b=>sequence(call(attack,b.input),call(enemyPower(DrawReduction,1,true,true,true),b.input),when(b.read(v=>s(v).ascension>=19),call(enemyCards(pileCards.exports.Slimed,2,2),b.input)),call(rollEnemyAfter,b.input)))),
    attackMove(mm.TIME_EATER_REVERBERATE,enemyAttack(v=>s(v).ascension>=4?8:7,3),attack=>enemyProgram(attack,rollEnemyAfter)),
    {move:mm.TIME_EATER_RIPPLE,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:20}),call(enemyPower(basicPowers.exports.PlayerWeak,1,true,true),b.input),call(enemyPower(basicPowers.exports.PlayerVulnerable,1,true,true),b.input),when(b.read(v=>s(v).ascension>=19),call(enemyPower(basicPowers.exports.Frail,1,true,true),b.input)),call(directRoll,b.input)))},
  ]});

  const curiosity=on(battles.exports.used,{
    condition:defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[cardInstances.exports.metadata,powers.exports.current,battles.exports.status],base:(r,c)=>
      c.event.triggerOnUse&&!c.event.purgeOnUse&&r.query(cardInstances.exports.metadata,c.event.card).type===2&&r.query(powers.exports.current,c.source).registry===r.query(battles.exports.status,c.event.battle).registry}),
    order:{phase:battles.exports.stages.enemy},
    effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>call(enemyOperations.exports.applyPower,{
      registry:b.read(v=>v.query(powers.exports.current,v.input.source).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,
      amount:b.read(v=>v.query(powers.exports.level,v.input.source)),source:b.read(v=>v.input.owner),debuff:false,scope:rules.scopeOf(b.read(v=>v.input.source),combatScope),
    })),
  });
  const curiosityProgram=defineDescribedEnemyPower('好奇',{presentation:{key:MS.CURIOSITY,flag:false,slot:0},...counterPolicies({bits:32,clearOnRemove:true})},{},describedEnemyAbility('同一战斗中打出触发使用效果且非临时清除的能力牌时，自身获得等同层数的力量。',strengthAbility(curiosity)));
  const Curiosity=curiosityProgram.definition;
  const rebirthSpent=defineComponent({schema:z.boolean(),initial:()=>false});
  const defer=modify(battles.exports.victoryDeferred,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,boolean>>(),output:z.boolean(),dependencies:[enemies.exports.current],base:(r,c)=>r.query(enemies.exports.current,c.source).battle===c.input}),reads:[rebirthSpent],dependencies:[enemies.exports.current],transform:(r,c)=>c.value||!r.component(c.source,rebirthSpent)||r.query(enemies.exports.current,c.source).halfDead});
  const firstDeath=on(resources.exports.wouldDie,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number}>>(),output:z.boolean(),reads:[rebirthSpent],base:(r,c)=>c.event.entity===c.owner&&!r.component(c.source,rebirthSpent)}),effect:defineEffect<rules.ReactionContext<{entity:number}>,void>(b=>sequence(
    updateLocalComponent(b.read(v=>v.input.source),rebirthSpent,true),
    call(enemyOperations.exports.enterRebirth,{enemy:b.read(v=>v.input.source),move:mm.AWAKENED_ONE_REBIRTH,clear:'negative',remove:[Curiosity],clearBlock:false,clearCards:true}),
  ))});
  const awakeChoose=defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>{const s=v.query(enemies.exports.current,v.input.enemy);if(s.halfDead)return mm.AWAKENED_ONE_REBIRTH;if(v.query(enemies.exports.revivals,v.input.enemy)===0){if(s.history[0]===0)return mm.AWAKENED_ONE_SLASH;if(v.input.roll<25)return s.history[0]===mm.AWAKENED_ONE_SOUL_STRIKE?mm.AWAKENED_ONE_SLASH:mm.AWAKENED_ONE_SOUL_STRIKE;return !s.history.every(m=>m===mm.AWAKENED_ONE_SLASH)?mm.AWAKENED_ONE_SLASH:mm.AWAKENED_ONE_SOUL_STRIKE;}return v.input.roll<50?(!s.history.every(m=>m===mm.AWAKENED_ONE_SLUDGE)?mm.AWAKENED_ONE_SLUDGE:mm.AWAKENED_ONE_TACKLE):!s.history.every(m=>m===mm.AWAKENED_ONE_TACKLE)?mm.AWAKENED_ONE_TACKLE:mm.AWAKENED_ONE_SLUDGE;})));
  const AwakenedOne=enemyDefinition({id:mid.AWAKENED_ONE,threshold:9,components:[rebirthSpent],choose:awakeChoose,presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),dependencies:[enemies.exports.revivals],base:(r,e)=>({miscInfo:Number(r.query(enemies.exports.revivals,e)>0)})}),initialize:defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>sequence(call(enemyInitialize(firstDeath,enemyAtStart(defineEffect<EnemyAction,void>(b=>sequence(when(b.read(v=>s(v).ascension>=4),call(enemyPower(basicPowers.exports.Strength,2),b.input)),call(enemyPower(Curiosity,v=>s(v).ascension>=19?2:1),b.input),call(enemyPower(finalPowers.exports.Regen,v=>s(v).ascension>=19?15:10),b.input))))),b.input),install({ability:defer,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)}))),moves:[
    {move:mm.AWAKENED_ONE_REBIRTH,execute:defineEffect<EnemyAction,void>(b=>{const restored=b.local<boolean>();return sequence(
      b.assign(restored,call(enemyOperations.exports.revive,{enemy:b.read(v=>v.input.enemy),hp:b.read(v=>s(v).ascension>=9?320:300),maxHp:b.read(v=>s(v).ascension>=9?320:300),move:mm.AWAKENED_ONE_DARK_ECHO,cleanse:true,powers:[{definition:combatEnemyPowers.exports.MinionLeader,amount:1}]})),
      when(restored,call(noop,b.input)),
      call(battles.exports.checkOutcome,b.read(v=>v.input.battle)),
    );})},
    attackMove(mm.AWAKENED_ONE_DARK_ECHO,enemyAttack(40),attack=>enemyProgram(attack,rollEnemyAfter)),attackMove(mm.AWAKENED_ONE_SLASH,enemyAttack(20),attack=>enemyProgram(attack,rollEnemyAfter)),attackMove(mm.AWAKENED_ONE_SOUL_STRIKE,enemyAttack(6,4),attack=>enemyProgram(attack,rollEnemyAfter)),attackMove(mm.AWAKENED_ONE_SLUDGE,enemyAttack(18),attack=>enemyProgram(attack,enemyCards(pileCards.exports.Void,1,0,true),rollEnemyAfter)),attackMove(mm.AWAKENED_ONE_TACKLE,enemyAttack(10,3),attack=>enemyProgram(attack,rollEnemyAfter)),
  ]});
  return{exports:{Deca,Donu,TimeEater,AwakenedOne,TimeWarp,DrawReduction,Curiosity,statusTexts:{DRAW_REDUCTION:drawReductionProgram.text,TIME_WARP:timeWarpProgram.text,CURIOSITY:curiosityProgram.text}}};
}});
