import {enemyAbilities,strengthAbility,contribution,defineDescribedEnemyPower,describedEnemyAbility} from '../shared/abilities.ts';
import {enemyOperations} from '../shared/operations.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {MS} from "../../../combat-identifiers.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {resources} from "../../../rules/resources.ts";
import {random} from "../../../rules/random.ts";
import {damage} from "../../../rules/damage.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {counterPolicies} from "../../powers/utils.ts";
import {enemyIntentFrom,attackMove,enemyUtilities,enemyDefinition,enemyHealth,enemyAttack,enemyPower,enemyProgram,initialEnemyRoll} from "../shared/programs.ts";
import {actionQueue,combatScope} from "../../../rules/combat-actions.ts";
import {moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll,EnemySetup} from "../../../rules/enemies.types.ts";
import type {HitRequest} from "../../../rules/damage.types.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,defineComponent,sequence,when,call,query,on,modify,install,enqueue,updateLocalComponent,readComponent}=rules;
export const exordiumHumanoids=defineRules({requires:[enemyOperations,enemyUtilities,enemies,basicPowers],build(){
  const noop=defineEffect<EnemyAction,void>(b=>enqueue(enemies.exports.noopRoll,b.read(v=>v.input.enemy),{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  const initialMove=(move:number)=>defineEffect<EnemyRoll,number>(b=>b.return(move));
  const angry=on(damage.exports.started,{condition:defineQuery({input:typedValue<rules.ReactionContext<HitRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.target===c.owner&&c.event.attack&&r.query(powers.exports.enabled,c.source)}),effect:defineEffect<rules.ReactionContext<HitRequest>,void>(b=>call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(powers.exports.current,v.input.source).registry),actor:b.read(v=>v.input.owner),definition:basicPowers.exports.Strength,amount:query(powers.exports.level,b.read(v=>v.input.source)),source:null,debuff:false,scope:rules.scopeOf(b.read(v=>v.input.source),combatScope)}))});
  const angryProgram=defineDescribedEnemyPower('愤怒',{presentation:{key:MS.ANGRY,flag:false,slot:0},...counterPolicies({bits:32,zeroIsNoop:true})},{},describedEnemyAbility('受到攻击结算开始时，获得等同层数的力量。',strengthAbility(angry)));
  const Angry=angryProgram.definition;
  function atStart(definition:typeof Angry,amount:(a:number)=>number){return on(battles.exports.started,{condition:defineQuery({input:typedValue<rules.ReactionContext<number>>(),output:z.boolean(),dependencies:[enemies.exports.current],base:(r,c)=>r.query(enemies.exports.current,c.source).battle===c.event}),effect:defineEffect<rules.ReactionContext<number>,void>(b=>call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(battles.exports.status,v.input.event).registry),actor:b.read(v=>v.input.owner),definition,amount:b.read(v=>amount(v.query(enemies.exports.current,v.input.source).ascension)),source:null,debuff:false,scope:b.read(v=>v.query(battles.exports.status,v.input.event).scope)}))});}
  const MadGremlin=enemyDefinition({id:mid.MAD_GREMLIN,choose:initialMove(mm.MAD_GREMLIN_SCRATCH),moves:[attackMove(mm.MAD_GREMLIN_SCRATCH,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=2?5:4),attack=>enemyProgram(attack,noop))],initialize:defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>sequence(call(initialEnemyRoll,b.input),install({ability:atStart(Angry,a=>a>=17?2:1),source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)})))});
  const FatGremlin=enemyDefinition({id:mid.FAT_GREMLIN,choose:initialMove(mm.FAT_GREMLIN_SMASH),moves:[attackMove(mm.FAT_GREMLIN_SMASH,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=2?5:4),attack=>enemyProgram(attack,enemyPower(basicPowers.exports.PlayerWeak,1,true,true,true),defineEffect<EnemyAction,void>(b=>when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=17),call(enemyPower(basicPowers.exports.Frail,1,true,true,true),b.input))),noop))]});
  const SneakyGremlin=enemyDefinition({id:mid.SNEAKY_GREMLIN,choose:initialMove(mm.SNEAKY_GREMLIN_PUNCTURE),moves:[attackMove(mm.SNEAKY_GREMLIN_PUNCTURE,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=2?10:9),attack=>attack)]});
  const charge=defineComponent({schema:z.int32(),initial:()=>1});
  // Private state belongs to the concrete definition; create a definition with the same authored config.
  const GremlinWizardAttack=enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=2?30:25);
const GremlinWizard=defineEntity(enemies.exports.kind,{
    metadata:{id:mid.GREMLIN_WIZARD,name:'GREMLIN_WIZARD'},health:enemyHealth(mid.GREMLIN_WIZARD,7),choose:initialMove(mm.GREMLIN_WIZARD_CHARGING),
    intent:enemyIntentFrom([[mm.GREMLIN_WIZARD_ULTIMATE_BLAST,GremlinWizardAttack]]),
    act:defineEffect<EnemyAction,void>(b=>when(b.read(v=>v.input.move===mm.GREMLIN_WIZARD_CHARGING),sequence(updateLocalComponent(b.read(v=>v.input.enemy),charge,n=>n+1),when(b.read(v=>v.get(readComponent(v.input.enemy,charge))===3),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.GREMLIN_WIZARD_ULTIMATE_BLAST}))),sequence(call(GremlinWizardAttack,b.input),when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).ascension<17),sequence(updateLocalComponent(b.read(v=>v.input.enemy),charge,0),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.GREMLIN_WIZARD_CHARGING})))))),initialize:initialEnemyRoll,
    presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[charge],base:(r,e)=>({miscInfo:r.component(e,charge)})}),
  },{components:[charge]});
  const protect=defineEffect<{battle:number;enemy:number;actor:number;amount:number},void>(b=>{const targets=b.local<number[]>(),at=b.local<number>();return sequence(b.assign(targets,b.read(v=>v.query(battles.exports.status,v.input.battle).enemies.filter(actor=>actor!==v.input.actor&&v.query(resources.exports.vitality,actor).hp>0))),b.assign(at,0),when(b.read(v=>v.get(targets).length>0),b.assign(at,call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:0,end:b.read(v=>v.get(targets).length-1)}))),call(enemyOperations.exports.block,{entity:b.read(v=>v.get(targets)[v.get(at)]??v.input.actor),amount:b.read(v=>v.input.amount)}));});
  const ShieldGremlin=enemyDefinition({id:mid.SHIELD_GREMLIN,choose:initialMove(mm.SHIELD_GREMLIN_PROTECT),moves:[{move:mm.SHIELD_GREMLIN_PROTECT,execute:defineEffect<EnemyAction,void>(b=>sequence(enqueue(protect,{battle:b.read(v=>v.input.battle),enemy:b.read(v=>v.input.enemy),actor:b.read(v=>v.input.actor),amount:b.read(v=>{const a=v.query(enemies.exports.current,v.input.enemy).ascension;return a>=17?11:a>=7?8:7;})},{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}),when(b.read(v=>v.query(battles.exports.targets,v.input.battle).length<=1),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.SHIELD_GREMLIN_SHIELD_BASH}))))},attackMove(mm.SHIELD_GREMLIN_SHIELD_BASH,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=2?8:6),attack=>attack)]});
  const Thievery=defineEntity(powers.exports.kind,{presentation:{key:MS.THIEVERY,flag:false,slot:0},...counterPolicies({bits:32,zeroIsNoop:true}),attach:enemyAbilities()});
  const theft=(()=>{const normal=15,high=20,ascension=17;
    const amount=(a:number)=>a>=ascension?high:normal;
    const steal=defineEffect<EnemyAction,void>(b=>call(enemyOperations.exports.stealGold,{source:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),target:b.read(v=>v.input.actor),amount:b.read(v=>amount(v.query(enemies.exports.current,v.input.enemy).ascension))}));
    const recover=modify(battles.exports.recoveredGold,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,number>>(),output:z.boolean(),dependencies:[enemies.exports.current],base:(r,c)=>{const s=r.query(enemies.exports.current,c.source);return s.battle===c.input&&!s.escaped;}}),dependencies:[resources.exports.escrowedGold],transform:(r,c)=>c.value+r.query(resources.exports.escrowedGold,c.owner)});
    return Object.freeze({steal,recover,amount,text:`盗贼的攻击动作在伤害结算前，从玩家处偷取至多${normal}金币（进阶${ascension}及以上为${high}），存入自身被盗金币记录；未逃跑时该记录计入战斗回收金币。此状态本身仅展示数值，不监听所有攻击。`});
  })();
  function thief(mugger:boolean){const id=mugger?mid.MUGGER:mid.LOOTER,mug=mugger?mm.MUGGER_MUG:mm.LOOTER_MUG,lunge=mugger?mm.MUGGER_LUNGE:mm.LOOTER_LUNGE,smoke=mugger?mm.MUGGER_SMOKE_BOMB:mm.LOOTER_SMOKE_BOMB,escape=mugger?mm.MUGGER_ESCAPE:mm.LOOTER_ESCAPE;
    const {steal,recover}=theft;
    const start=atStart(Thievery,theft.amount);
    const thiefAttack=enemyAttack(v=>v.input.move===lunge?mugger?v.query(enemies.exports.current,v.input.enemy).ascension>=2?18:16:v.query(enemies.exports.current,v.input.enemy).ascension>=2?14:12:v.query(enemies.exports.current,v.input.enemy).ascension>=2?11:10);
const act=defineEffect<EnemyAction,void>(b=>{const coin=b.local<boolean>();return sequence(
      when(b.read(v=>v.input.move===escape),sequence(call(enemyOperations.exports.escape,b.read(v=>v.input.enemy)),b.return(undefined))),
      when(b.read(v=>v.input.move===smoke),sequence(call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:b.read(v=>mugger?v.query(enemies.exports.current,v.input.enemy).ascension>=17?17:11:6)}),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:escape}),b.return(undefined))),
      ...(mugger?[call(random.exports.int,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),start:0,end:2})]:[]),
      when(b.read(v=>v.input.move===mug&&v.input.turn===(mugger?2:1)),call(random.exports.chance,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),chance:.6})),call(steal,b.input),call(thiefAttack,b.input),
      when(b.read(v=>v.input.move===lunge),sequence(call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:smoke}),b.return(undefined))),
      when(b.read(v=>v.input.turn===2),sequence(b.assign(coin,call(random.exports.chance,{stream:b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng),chance:.5})),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>v.get(coin)?smoke:lunge)})),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mug})),
    );});
    return defineEntity(enemies.exports.kind,{metadata:{id,name:mugger?'MUGGER':'LOOTER'},health:enemyHealth(id,7),choose:initialMove(mug),intent:enemyIntentFrom([[mug,thiefAttack],[lunge,thiefAttack]]),act,initialize:defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>sequence(call(initialEnemyRoll,b.input),...[start,recover].map(ability=>install({ability,source:b.read(v=>v.input.entity),owner:b.read(v=>v.input.setup.actor),environment:{},lifetime:b.read(v=>v.input.scope)})))),presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),dependencies:[enemies.exports.current,resources.exports.escrowedGold],base:(r,e)=>({miscInfo:r.query(resources.exports.escrowedGold,r.query(enemies.exports.current,e).actor)})})});
  }
  return{exports:{MadGremlin,FatGremlin,SneakyGremlin,GremlinWizard,ShieldGremlin,Looter:thief(false),Mugger:thief(true),Angry,Thievery,statusTexts:{THIEVERY:theft.text,ANGRY:angryProgram.text}}};
}});
