import { typedValue } from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {resources} from "../../../rules/resources.ts";
import {powers} from "../../../rules/powers.ts";
import {random} from "../../../rules/random.ts";
import {damage} from "../../../rules/damage.ts";
import {adventures} from "../../../rules/adventures.ts";
import {permanentDecks} from "../../../rules/permanent-decks.ts";
import {relics} from "../../../rules/relics.ts";
import {deckRelics} from "../../relics/common/decks.ts";
import {basicPowers} from "../../powers/attributes.ts";
import {enemyDefensePowers} from "../shared/defense-powers.ts";
import {counterPolicies,attachAbilities} from "../../powers/utils.ts";
import {enemyUtilities,enemyDefinition,enemyAttack,enemyBlock,enemyPower,enemyProgram,rollEnemyAfter,enemyAtStart,enemyInitialize} from "../shared/programs.ts";
import {actionQueue} from "../../../rules/combat-actions.ts";
import {MS,moveId as mm,monsterId as mid} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll} from "../../../rules/enemies.types.ts";
import type {HpDamageRequest} from "../../../rules/damage.types.ts";
import type {Health} from "../../../rules/resources.types.ts";
const {defineRules,defineEffect,defineQuery,defineEntity,defineComponent,sequence,when,forEach,call,query,on,enqueue,readComponent,updateLocalComponent}=rules;
export const writhingMass=defineRules({requires:[enemyUtilities,enemies,battles,resources,powers,random,damage,adventures,permanentDecks,relics,deckRelics,basicPowers,enemyDefensePowers],build(){
  const implanted=defineComponent({schema:z.boolean(),initial:()=>false});
  const s=(v:rules.ReadView<EnemyAction>)=>v.query(enemies.exports.current,v.input.enemy);
  const reroll=defineEffect<number,void>(b=>sequence(forEach(b.read(v=>Array.from({length:v.query(powers.exports.level,v.input)},(_,i)=>i)),()=>call(enemies.exports.roll,b.read(v=>{const actor=v.query(powers.exports.current,v.input).actor,e=v.query(enemies.exports.forActor,actor);if(e===null)throw Error('Reactive needs an enemy');return e;}))),call(powers.exports.set,{entity:b.input,next:{level:0,active:true,justApplied:false}})));
  const reactive=on(damage.exports.blocked,{condition:defineQuery({input:typedValue<rules.ReactionContext<HpDamageRequest>>(),output:z.boolean(),dependencies:[powers.exports.enabled],base:(r,c)=>c.event.request.target===c.owner&&c.event.request.attack&&c.event.facts.unblocked>0&&r.query(powers.exports.enabled,c.source)}),order:10,effect:defineEffect<rules.ReactionContext<HpDamageRequest>,void>(b=>sequence(when(b.read(v=>v.query(powers.exports.level,v.input.source)===0),enqueue(reroll,b.read(v=>v.input.source),{queue:actionQueue,source:b.read(v=>v.input.source),lifetime:b.read(v=>v.query(battles.exports.status,v.input.event.request.battle).actionScope),eligible:'captured'})),call(powers.exports.set,{entity:b.read(v=>v.input.source),next:{level:b.read(v=>v.query(powers.exports.level,v.input.source)+1),active:true,justApplied:false}})))});
  const Reactive=defineEntity(powers.exports.kind,{presentation:{key:MS.REACTIVE,flag:false,slot:1},...counterPolicies({bits:32}),attach:attachAbilities(reactive)});
  const choose:rules.Effect<EnemyRoll,number>=defineEffect(b=>{const roll=b.local<number>(),coin=b.local<boolean>(),result=b.local<number>();const stream=b.read(v=>v.query(enemies.exports.current,v.input.enemy).aiRng);const again=(start:number,end:number)=>sequence(b.assign(roll,call(random.exports.int,{stream,start,end})),b.assign(result,call(choose,{enemy:b.read(v=>v.input.enemy),roll})),b.return(result));return sequence(
    when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]===0),b.return(b.read(v=>v.input.roll<33?mm.WRITHING_MASS_MULTI_STRIKE:v.input.roll<66?mm.WRITHING_MASS_FLAIL:mm.WRITHING_MASS_WITHER))),b.assign(roll,b.read(v=>v.input.roll)),
    when(b.read(v=>v.get(roll)<10),sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.WRITHING_MASS_STRONG_STRIKE),b.return(mm.WRITHING_MASS_STRONG_STRIKE)),b.assign(roll,call(random.exports.int,{stream,start:10,end:99})))),
    when(b.read(v=>v.get(roll)<20),sequence(when(b.read(v=>!v.get(readComponent(v.input.enemy,implanted))&&v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.WRITHING_MASS_IMPLANT),b.return(mm.WRITHING_MASS_IMPLANT)),b.assign(coin,call(random.exports.chance,{stream,chance:.1})),when(coin,b.return(mm.WRITHING_MASS_STRONG_STRIKE)),b.assign(roll,call(random.exports.int,{stream,start:20,end:99})))),
    when(b.read(v=>v.get(roll)<40),sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.WRITHING_MASS_WITHER),b.return(mm.WRITHING_MASS_WITHER)),b.assign(coin,call(random.exports.chance,{stream,chance:.4})),when(coin,sequence(b.assign(roll,call(random.exports.int,{stream,start:0,end:19})),when(b.read(v=>v.get(roll)<10),b.return(mm.WRITHING_MASS_STRONG_STRIKE)),when(b.read(v=>!v.get(readComponent(v.input.enemy,implanted))),b.return(mm.WRITHING_MASS_IMPLANT)),b.assign(coin,call(random.exports.chance,{stream,chance:.1})),when(coin,b.return(mm.WRITHING_MASS_STRONG_STRIKE)),again(20,99))),b.assign(roll,call(random.exports.int,{stream,start:40,end:99})))),
    when(b.read(v=>v.get(roll)<70),sequence(when(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.WRITHING_MASS_MULTI_STRIKE),b.return(mm.WRITHING_MASS_MULTI_STRIKE)),b.assign(coin,call(random.exports.chance,{stream,chance:.3})),when(coin,b.return(mm.WRITHING_MASS_FLAIL)),again(0,39))),
    b.return(b.read(v=>v.query(enemies.exports.current,v.input.enemy).history[0]!==mm.WRITHING_MASS_FLAIL?mm.WRITHING_MASS_FLAIL:mm.WRITHING_MASS_WITHER)),
  );});
  const runFor=(v:rules.ReadView<EnemyAction>)=>{const r=v.query(adventures.exports.forActor,v.query(battles.exports.current,v.input.battle).actor);if(r===null)throw Error('Implant requires an adventure');return r;};
  const exit=on(battles.exports.exiting,{condition:defineQuery({input:typedValue<rules.ReactionContext<{battle:number;actor:number;outcome:1|2}>>(),output:z.boolean(),reads:[implanted],dependencies:[enemies.exports.current],base:(r,c)=>r.query(enemies.exports.current,c.source).battle===c.event.battle&&r.component(c.source,implanted)}),effect:defineEffect<rules.ReactionContext<{battle:number;actor:number;outcome:1|2}>,void>(b=>{const run=b.local<number>(),omamori=b.local<number|null>(),saved=b.local<Health&{gold:number}>();return sequence(b.assign(run,b.read(v=>{const id=v.query(adventures.exports.forActor,v.input.event.actor);if(id===null)throw Error('Implant exit requires an adventure');return id;})),b.assign(omamori,query(relics.exports.find,{actor:b.read(v=>v.input.event.actor),definition:deckRelics.exports.Omamori})),when(b.read(v=>v.get(omamori)!==null),call(relics.exports.interact,b.read(v=>v.get(omamori)!)),sequence(b.assign(saved,b.read(v=>{const r=v.query(resources.exports.current,v.input.event.actor);return{hp:r.hp,maxHp:r.maxHp,gold:r.gold};})),call(permanentDecks.exports.obtain,{deck:b.read(v=>v.query(adventures.exports.bindings,v.get(run)).deck),definition:query(adventures.exports.card,{run,id:'PARASITE'}),count:1,upgraded:false,specialData:0,upgrade:false}),call(resources.exports.setHealth,{entity:b.read(v=>v.input.event.actor),hp:b.read(v=>v.get(saved).hp),maxHp:b.read(v=>v.get(saved).maxHp)}),call(resources.exports.spendGold,{entity:b.read(v=>v.input.event.actor),amount:b.read(v=>v.query(resources.exports.wealth,v.input.event.actor).gold-v.get(saved).gold)}))));})});
  const WrithingMass=enemyDefinition({id:mid.WRITHING_MASS,components:[implanted],choose,presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[implanted],base:(r,e)=>({miscInfo:Number(r.component(e,implanted))})}),initialize:enemyInitialize(exit,enemyAtStart(enemyProgram(enemyPower(Reactive,0),enemyPower(enemyDefensePowers.exports.Malleable,3)))),moves:[
    {move:mm.WRITHING_MASS_FLAIL,damage:s=>s.ascension>=2?16:15,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=2?16:15),enemyBlock(v=>s(v).ascension>=2?18:16),rollEnemyAfter)},
    {move:mm.WRITHING_MASS_IMPLANT,execute:defineEffect<EnemyAction,void>(b=>sequence(updateLocalComponent(b.read(v=>v.input.enemy),implanted,true),when(b.read(v=>!v.query(adventures.exports.hasRelic,{run:runFor(v),id:'OMAMORI'})&&v.query(adventures.exports.hasRelic,{run:runFor(v),id:'DARKSTONE_PERIAPT'})),call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.query(battles.exports.status,v.input.battle).actor),amount:6})),call(enemies.exports.roll,b.read(v=>v.input.enemy))))},
    {move:mm.WRITHING_MASS_MULTI_STRIKE,damage:s=>s.ascension>=2?9:7,hits:3,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=2?9:7,3),rollEnemyAfter)},
    {move:mm.WRITHING_MASS_STRONG_STRIKE,damage:s=>s.ascension>=2?38:32,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=2?38:32),rollEnemyAfter)},
    {move:mm.WRITHING_MASS_WITHER,damage:0,hits:0,execute:enemyProgram(enemyAttack(v=>s(v).ascension>=2?12:10),enemyPower(basicPowers.exports.PlayerWeak,2,true,true,true),enemyPower(basicPowers.exports.PlayerVulnerable,2,true,true,true),rollEnemyAfter)},
  ]});
  return{exports:{WrithingMass,Reactive}};
}});
