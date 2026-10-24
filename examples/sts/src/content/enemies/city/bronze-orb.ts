import {enemyCardOperations} from '../shared/card-operations.ts';
import {enemyAbilities,settlement,defineDescribedEnemyPower,describedEnemyAbility} from '../shared/abilities.ts';
import {enemyOperations} from '../shared/operations.ts';
import { typedValue } from '../../../rules/value.schemas.ts';
import {z} from 'zod';
import {rules} from '../../../rules/execution.ts';
import {enemies} from "../../../rules/enemies.ts";
import {battles} from "../../../rules/battles.ts";
import {powers} from "../../../rules/powers.ts";
import {resources} from "../../../rules/resources.ts";
import {zones} from "../../../rules/zones.ts";
import {cardPiles} from "../../../rules/card-piles.ts";
import {cardInstances} from "../../../rules/card-instances.ts";
import {random} from "../../../rules/random.ts";
import {combatEnemyPowers} from "../shared/combat-powers.ts";
import {counterPolicies} from "../../powers/utils.ts";
import {attackMove,enemyUtilities,enemyDefinition,enemyHealth,enemyAttack,enemyProgram,rollEnemyAfter,enemyAtStart,enemyInitialize,enemyPower} from "../shared/programs.ts";
import {cardSortOrder} from "../../../card-order.ts";
import {combatStorageViews} from "../../../adapters/combat-storage-views.ts";
import {moveId as mm,monsterId as mid,MS} from "../../../combat-identifiers.ts";
import type {EnemyAction,EnemyRoll} from "../../../rules/enemies.types.ts";
import type {PowerLifecycle} from "../../../rules/powers.types.ts";
const {defineRules,defineQuery,defineEffect,defineEntity,defineComponent,sequence,when,call,query,on,updateLocalComponent,readComponent}=rules;
export const bronzeOrb=defineRules({requires:[enemyCardOperations,enemyOperations,enemyUtilities,enemies,battles,powers,combatEnemyPowers,combatStorageViews],build(){
  const candidate=defineComponent({schema:z.number().nullable(),initial:()=>null}),used=defineComponent({schema:z.boolean(),initial:()=>false}),held=defineComponent({schema:z.number().nullable(),initial:()=>null});
  const heldZone=defineQuery({input:z.number(),output:z.number().nullable(),reads:[held],base:(r,power)=>r.component(power,held)});
  const storageView=rules.modify(combatStorageViews.exports.slots,{condition:defineQuery({input:typedValue<rules.ModifierContext<number,{index:number;zone:number}[]>>(),output:z.boolean(),dependencies:[powers.exports.current,heldZone],base:(r,c)=>r.query(powers.exports.current,c.source).registry===c.input&&r.query(heldZone,c.source)!==null}),dependencies:[heldZone,enemies.exports.forActor,enemies.exports.current],transform:(r,c)=>{const enemy=r.query(enemies.exports.forActor,c.owner);if(enemy===null)throw Error('Stored card requires an enemy controller');return[...c.value,{index:Math.min(1,r.query(enemies.exports.current,enemy).slot??0),zone:r.query(heldZone,c.source)!}];}});
  const selected=defineQuery({input:z.number(),output:z.number(),reads:[candidate],dependencies:[enemies.exports.forActor],base:(r,actor)=>{const enemy=r.query(enemies.exports.forActor,actor),card=enemy===null?null:r.component(enemy,candidate);if(card===null)throw Error('Stasis needs a selected card');return card;}});
  const released=on(resources.exports.wouldDie,{condition:defineQuery({input:typedValue<rules.ReactionContext<{entity:number}>>(),output:z.boolean(),dependencies:[powers.exports.enabled,powers.exports.current,battles.exports.forRegistry,battles.exports.expectedOutcome],base:(r,c)=>{if(c.event.entity!==c.owner||!r.query(powers.exports.enabled,c.source))return false;const board=r.query(battles.exports.forRegistry,r.query(powers.exports.current,c.source).registry);return board!==null&&r.query(battles.exports.expectedOutcome,board)===0;}}),effect:defineEffect<rules.ReactionContext<{entity:number}>,void>(b=>{const zone=b.local<number|null>(),card=b.local<number>(),piles=b.local<number>();return sequence(b.assign(zone,query(heldZone,b.read(v=>v.input.source))),when(b.read(v=>v.get(zone)===null||v.query(zones.exports.members,v.get(zone)!).length===0),b.return(undefined)),b.assign(card,b.read(v=>v.query(zones.exports.members,v.get(zone)!)[0]!)),b.assign(piles,b.read(v=>{const board=v.query(battles.exports.forRegistry,v.query(powers.exports.current,v.input.source).registry);if(board===null)throw Error('Stasis return needs a battle');return v.query(battles.exports.status,board).piles;})),call(enemyCardOperations.exports.release,{piles,zone:b.read(v=>v.get(zone)!)}));})});
  // Existing storage is lifecycle state: domain may block a new theft, but must
  // never hide an already held card or suppress its once-only death return.
  const stasisProgram=defineDescribedEnemyPower('停滞',{presentation:{key:MS.STASIS,flag:true},...counterPolicies({bits:32,flag:true})},{components:[held],attach:abilities=>defineEffect<PowerLifecycle,void>(b=>{const zone=b.local<number|null>(),card=b.local<number>(),piles=b.local<number>();return sequence(b.assign(card,query(selected,b.read(v=>v.input.setup.actor))),b.assign(piles,b.read(v=>{const board=v.query(battles.exports.forRegistry,v.input.setup.registry);if(board===null)throw Error('Stasis needs a battle');return v.query(battles.exports.status,board).piles;})),b.assign(zone,call(enemyCardOperations.exports.store,{owner:b.read(v=>v.input.entity),scope:b.read(v=>v.input.scope),piles,card})),when(b.read(v=>v.get(zone)===null),b.return(undefined)),updateLocalComponent(b.read(v=>v.input.entity),held,zone),call(abilities,b.input));})},describedEnemyAbility('施加时封存已选定的一张牌，并显示封存记录；持有者即将死亡且战斗预计仍在进行时，释放封存牌。',settlement(released),settlement(storageView)));
  const Stasis=stasisProgram.definition;
  const stasisFragment=(()=>{const priority=[{rarity:2,name:'稀有'},{rarity:1,name:'罕见'},{rarity:0,name:'普通'}];
  const execute=defineEffect<EnemyAction,void>(b=>{const list=b.local<number[]>(),at=b.local<number>();return sequence(
    call(cardPiles.exports.resolveDrawOrder,b.read(v=>v.query(battles.exports.status,v.input.battle).piles)),b.assign(list,b.read(v=>{const p=v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles),draw=v.query(zones.exports.members,p.draw),cards=[...(draw.length?draw:v.query(zones.exports.members,p.discard))];const target=priority.map(item=>item.rarity).find(rarity=>cards.some(card=>v.query(cardInstances.exports.metadata,card).rarity===rarity));return target===undefined?cards:cards.filter(card=>v.query(cardInstances.exports.metadata,card).rarity===target).sort((a,b)=>cardSortOrder[v.query(cardInstances.exports.combatView,a).id]!-cardSortOrder[v.query(cardInstances.exports.combatView,b).id]!);})),when(b.read(v=>v.get(list).length===0),b.return(undefined)),b.assign(at,call(random.exports.int,{stream:b.read(v=>v.query(cardPiles.exports.bindings,v.query(battles.exports.status,v.input.battle).piles).cardRng),start:0,end:b.read(v=>v.get(list).length-1)})),updateLocalComponent(b.read(v=>v.input.enemy),candidate,b.read(v=>v.get(list)[v.get(at)]!)),call(enemyPower(Stasis,1),b.input),
  );});
  return Object.freeze({execute,text:`从抽牌堆选牌；抽牌堆为空时改用弃牌堆，按${priority.map(item=>item.name).join('、')}的顺序取首个存在的稀有度，无匹配则取所有候选，再随机选择一张。${stasisProgram.text}`});
  })();
  const choose=defineEffect<EnemyRoll,number>(b=>b.return(b.read(v=>{const h=v.query(enemies.exports.current,v.input.enemy).history;if(!v.get(readComponent(v.input.enemy,used))&&v.input.roll>=25)return mm.BRONZE_ORB_STASIS;return v.input.roll>=70&&!h.every(m=>m===mm.BRONZE_ORB_SUPPORT_BEAM)?mm.BRONZE_ORB_SUPPORT_BEAM:!h.every(m=>m===mm.BRONZE_ORB_BEAM)?mm.BRONZE_ORB_BEAM:mm.BRONZE_ORB_SUPPORT_BEAM;})));
  const BronzeOrb=enemyDefinition({id:mid.BRONZE_ORB,health:enemyHealth(mid.BRONZE_ORB,9,[{minimum:52,maximum:58}]),components:[candidate,used],choose,initialize:enemyInitialize(enemyAtStart(enemyPower(combatEnemyPowers.exports.Minion,1))),presentation:defineQuery({input:z.number(),output:z.record(z.string(),z.union([z.number(),z.boolean()])),reads:[used],base:(r,e)=>({miscInfo:Number(r.component(e,used))})}),moves:[attackMove(mm.BRONZE_ORB_BEAM,enemyAttack(8),attack=>enemyProgram(attack,rollEnemyAfter)),{move:mm.BRONZE_ORB_STASIS,execute:defineEffect<EnemyAction,void>(b=>sequence(call(stasisFragment.execute,b.input),updateLocalComponent(b.read(v=>v.input.enemy),used,true),call(enemies.exports.roll,b.read(v=>v.input.enemy))))},{move:mm.BRONZE_ORB_SUPPORT_BEAM,execute:defineEffect<EnemyAction,void>(b=>sequence(call(enemyOperations.exports.block,{entity:b.read(v=>v.query(battles.exports.status,v.input.battle).enemies[1]!),amount:12}),call(enemies.exports.roll,b.read(v=>v.input.enemy))))}]});
  return{exports:{BronzeOrb,Stasis,heldZone,statusTexts:{STASIS:stasisFragment.text}}};
}});
