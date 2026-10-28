import {enemyAbilities,contribution,drawback,defineDescribedEnemyPower,describedEnemyAbility} from '../shared/abilities.ts';
import {EffectKind} from '../../../rules/effect-policy.ts';
import {enemyOperations} from '../shared/operations.ts';
import {enemyCards} from '../shared/cards.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {pileCards} from "../../cards/statuses/definitions.ts";
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {resources} from "../../../rules/resources.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {attackMove,enemyUtilities,enemyDefinition,enemyAttack,enemyPower,enemyProgram,initialEnemyRoll} from "../shared/programs.ts";
import {counterPolicies} from "../../powers/utils.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {moveId as mm,monsterId as mid,MS} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll,EnemySetup} from "../../../rules/enemies.types.ts";
import type {HpLost} from "../../../rules/resources.types.ts";
import type {CardUse} from "../../../rules/card-instances.types.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,defineComponent,sequence,when,forEach,call,query,on,enqueue,updateLocalComponent,readComponent}=rules;
export const exordiumBosses=defineRules({requires:[enemyOperations,enemyUtilities,enemies,basicPowers,pileCards],build(){
  const noop=defineEffect<EnemyAction,void>(b=>enqueue(enemies.exports.noopRoll,b.read(v=>v.input.enemy),{queue:actionQueue,source:b.read(v=>v.input.enemy),lifetime:b.read(v=>v.query(battles.exports.status,v.input.battle).actionScope),eligible:'captured'}));
  const phase=defineComponent({schema:z.object({divider:z.int32(),cycle:z.int32()}),initial:()=>({divider:0,cycle:0})});
  const dividerValue=defineQuery({input:z.number(),output:z.number(),reads:[phase],base:(r,e)=>r.component(e,phase).divider});


  const Hexaghost=enemyDefinition({id:mid.HEXAGHOST,threshold:9,choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.HEXAGHOST_ACTIVATE)),components:[phase],presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[phase],base:(r,e)=>({miscInfo:r.component(e,phase).divider,uniquePower0:r.component(e,phase).cycle})}),moves:[
    {move:mm.HEXAGHOST_ACTIVATE,execute:defineEffect<EnemyAction,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.enemy),phase,b.read(v=>({divider:Math.trunc(v.query(resources.exports.vitality,v.query(battles.exports.status,v.input.battle).actor).hp/12)+1,cycle:v.get(readComponent(v.input.enemy,phase)).cycle}))),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.HEXAGHOST_DIVIDER}),call(enemies.exports.noopRoll,b.read(v=>v.input.enemy))))},
    attackMove(mm.HEXAGHOST_DIVIDER,enemyAttack(v=>v.query(dividerValue,v.input.enemy),6,[dividerValue]),attack=>enemyProgram(attack,defineEffect<EnemyAction,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.enemy),phase,s=>({...s,cycle:0})),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.HEXAGHOST_SEAR}))),noop)),
    attackMove(mm.HEXAGHOST_INFERNO,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=4?3:2,6),attack=>enemyProgram(attack,defineEffect<EnemyAction,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.enemy),phase,s=>({...s,cycle:0})),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.HEXAGHOST_SEAR}))),noop)),
    {move:mm.HEXAGHOST_INFLAME,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:12}),call(enemyPower(basicPowers.exports.Strength,v=>v.query(enemies.exports.current,v.input.enemy).ascension>=19?3:2),b.input),updateLocalComponent(b.read(v=>v.input.enemy),phase,s=>({...s,cycle:s.cycle+1})),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.HEXAGHOST_TACKLE}),call(enemies.exports.noopRoll,b.read(v=>v.input.enemy))))},
    attackMove(mm.HEXAGHOST_SEAR,enemyAttack(6),attack=>defineEffect<EnemyAction,void>(b=>sequence(call(attack,b.input),call(enemyCards(pileCards.exports.Burn,v=>v.query(enemies.exports.current,v.input.enemy).ascension>=19?2:1,2,false,true,v=>v.input.turn>9),b.input),call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:b.read(v=>{const n=v.get(readComponent(v.input.enemy,phase)).cycle;return n===0?mm.HEXAGHOST_TACKLE:n===2?mm.HEXAGHOST_INFLAME:mm.HEXAGHOST_INFERNO;})}),updateLocalComponent(b.read(v=>v.input.enemy),phase,s=>({...s,cycle:s.cycle+1})),call(noop,b.input)))),
    attackMove(mm.HEXAGHOST_TACKLE,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=4?6:5,2),attack=>enemyProgram(attack,defineEffect<EnemyAction,void>(b=>sequence(call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move:mm.HEXAGHOST_SEAR}),updateLocalComponent(b.read(v=>v.input.enemy),phase,s=>({...s,cycle:s.cycle+1})))),noop)),
  ]});
  const shiftBlock=20;
  // Losing an attack opportunity is a drawback; the passive shield is a
  // separate benefit and must recheck suppression when its queued task runs.
  const shiftShield=defineEffect<{entity:number;amount:number},void>({effect:EffectKind.Special},b=>call(enemyOperations.exports.block,b.input));
  const shift=on(resources.exports.hpLost,{condition:defineQuery({input:typedValue<rules.ReactionContext<HpLost>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.entity===c.owner&&c.event.amount>0&&c.event.after>0&&r.query(powers.exports.enabled,c.source)}),effect:defineEffect<rules.ReactionContext<HpLost>,void>(b=>{const controller=b.local<number>();return sequence(b.assign(controller,b.read(v=>{const id=v.query(enemies.exports.forActor,v.input.owner);if(id===null)throw Error('Mode Shift needs an enemy controller');return id;})),when(b.read(v=>v.query(powers.exports.level,v.input.source)<=v.input.event.amount),sequence(call(enemyOperations.exports.dismissPower,b.read(v=>v.input.source)),call(enemies.exports.setMove,{enemy:controller,move:mm.THE_GUARDIAN_DEFENSIVE_MODE}),enqueue(shiftShield,{entity:b.read(v=>v.input.owner),amount:shiftBlock},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.query(enemies.exports.current,v.get(controller)).battle).actionScope),eligible:'captured'})),call(enemyOperations.exports.consumePower,{entity:b.read(v=>v.input.source),amount:b.read(v=>v.input.event.amount)})));})});
  const modeShiftProgram=defineDescribedEnemyPower('形态转换',{grantEffect:EffectKind.BattleFact,presentation:{key:MS.MODE_SHIFT,flag:false,slot:0},...counterPolicies({bits:32,clearOnRemove:true,zeroIsNoop:true})},{},describedEnemyAbility(`自身失去生命且仍存活时，按实际失去生命减少层数；本次损失达到剩余层数时移除此状态、切换防御姿态意图并打断原行动；这些受伤机制在领域内保留。另获得${shiftBlock}被动格挡，领域内压制该格挡。`,drawback(shift)));
  const ModeShift=modeShiftProgram.definition;
  const spikes=on(battles.exports.used,{condition:defineQuery({input:typedValue<rules.ReactionContext<CardUse>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.current,battles.exports.current,cardInstances.exports.metadata,battles.exports.status],base:(r,c)=>r.query(powers.exports.enabled,c.source)&&r.query(powers.exports.current,c.source).registry===r.query(battles.exports.status,c.event.battle).registry&&r.query(battles.exports.status,c.event.battle).enemies[0]===c.owner&&r.query(cardInstances.exports.metadata,c.event.card).type===0}),order:battles.exports.stages.enemy,effect:defineEffect<rules.ReactionContext<CardUse>,void>(b=>enqueue(enemyOperations.exports.retaliate,{battle:b.read(v=>v.input.event.battle),source:b.read(v=>v.input.owner),target:b.read(v=>v.input.event.owner),amount:query(powers.exports.level,b.read(v=>v.input.source)),attack:false,selfDamage:false},{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.battle).actionScope),eligible:'captured'}))});
  const sharpHideProgram=defineDescribedEnemyPower('尖刺外壳',{presentation:{key:MS.SHARP_HIDE,flag:false,slot:1},...counterPolicies({bits:16,clearOnRemove:true,zeroIsNoop:true})},{},describedEnemyAbility('自身为当前战斗首个敌人时，每打出一张攻击牌，对出牌者造成等同层数的非攻击反伤。',contribution(spikes)));
  const SharpHide=sharpHideProgram.definition;
  const threshold=defineComponent({schema:z.int32(),initial:()=>0});
  const nextMove=(move:number)=>defineEffect<EnemyAction,void>(b=>call(enemies.exports.setMove,{enemy:b.read(v=>v.input.enemy),move}));
  const Guardian=enemyDefinition({id:mid.THE_GUARDIAN,threshold:9,components:[threshold],choose:defineEffect<EnemyRoll,number>(b=>b.return(mm.THE_GUARDIAN_CHARGING_UP)),presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[threshold],base:(r,e)=>({miscInfo:r.component(e,threshold)})}),initialize:defineEffect<rules.EntityLifecycle<EnemySetup>,void>(b=>sequence(call(initialEnemyRoll,b.input),updateLocalComponent(b.read(v=>v.input.entity),threshold,b.read(v=>v.input.setup.ascension>=19?40:v.input.setup.ascension>=9?35:30)),call(enemyOperations.exports.applyPower,{registry:b.read(v=>v.query(battles.exports.status,v.input.setup.battle).registry),actor:b.read(v=>v.input.setup.actor),definition:ModeShift,amount:readComponent(b.read(v=>v.input.entity),threshold),source:null,debuff:false,scope:b.read(v=>v.input.scope)}))),moves:[
    {move:mm.THE_GUARDIAN_CHARGING_UP,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyOperations.exports.block,{entity:b.read(v=>v.input.actor),amount:9}),call(nextMove(mm.THE_GUARDIAN_FIERCE_BASH),b.input)))},
    {move:mm.THE_GUARDIAN_DEFENSIVE_MODE,execute:enemyProgram(enemyPower(SharpHide,v=>v.query(enemies.exports.current,v.input.enemy).ascension>=19?4:3),nextMove(mm.THE_GUARDIAN_ROLL_ATTACK))},
    attackMove(mm.THE_GUARDIAN_FIERCE_BASH,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=4?36:32),attack=>enemyProgram(attack,nextMove(mm.THE_GUARDIAN_VENT_STEAM))),
    attackMove(mm.THE_GUARDIAN_ROLL_ATTACK,enemyAttack(v=>v.query(enemies.exports.current,v.input.enemy).ascension>=4?10:9),attack=>enemyProgram(attack,nextMove(mm.THE_GUARDIAN_TWIN_SLAM))),
    attackMove(mm.THE_GUARDIAN_TWIN_SLAM,enemyAttack(8,2),attack=>defineEffect<EnemyAction,void>(b=>{const hide=b.local<number|null>();return sequence(call(attack,b.input),b.assign(hide,query(powers.exports.find,{registry:b.read(v=>v.query(battles.exports.status,v.input.battle).registry),actor:b.read(v=>v.input.actor),definition:SharpHide})),when(b.read(v=>v.get(hide)!==null),call(enemyOperations.exports.dismissPower,b.read(v=>v.get(hide)!))),updateLocalComponent(b.read(v=>v.input.enemy),threshold,n=>n+10),call(nextMove(mm.THE_GUARDIAN_WHIRLWIND),b.input),call(enemyPower(ModeShift,v=>v.get(readComponent(v.input.enemy,threshold)),false,false,true),b.input));})),
    {move:mm.THE_GUARDIAN_VENT_STEAM,execute:enemyProgram(enemyPower(basicPowers.exports.PlayerVulnerable,2,true,true,true),enemyPower(basicPowers.exports.PlayerWeak,2,true,true,true),nextMove(mm.THE_GUARDIAN_WHIRLWIND))},
    attackMove(mm.THE_GUARDIAN_WHIRLWIND,enemyAttack(5,4),attack=>enemyProgram(attack,nextMove(mm.THE_GUARDIAN_CHARGING_UP))),
  ]});
  return{exports:{Hexaghost,Guardian,ModeShift,SharpHide,statusTexts:{MODE_SHIFT:modeShiftProgram.text,SHARP_HIDE:sharpHideProgram.text}}};
}});
