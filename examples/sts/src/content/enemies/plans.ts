import {rules} from '@bear-forge/card-engine';
import {random} from "../../rules/random.ts";
import {encounterId as e} from "../../identifiers.ts";
import type {MonsterPlan} from "../../encounters.types.ts";
const {defineRules,defineEffect,sequence,when,whileDo,call}=rules;
const weak=[[e.CULTIST,e.JAW_WORM,e.TWO_LOUSE,e.SMALL_SLIMES],[e.SPHERIC_GUARDIAN,e.CHOSEN,e.SHELL_PARASITE,e.THREE_BYRDS,e.TWO_THIEVES],[e.THREE_DARKLINGS,e.ORB_WALKER,e.THREE_SHAPES]] as const;
const strong=[[e.GREMLIN_GANG,e.LOTS_OF_SLIMES,e.RED_SLAVER,e.EXORDIUM_THUGS,e.EXORDIUM_WILDLIFE,e.BLUE_SLAVER,e.LOOTER,e.LARGE_SLIME,e.THREE_LOUSE,e.TWO_FUNGI_BEASTS],[e.CHOSEN_AND_BYRDS,e.SENTRY_AND_SPHERE,e.CULTIST_AND_CHOSEN,e.THREE_CULTIST,e.SHELLED_PARASITE_AND_FUNGI,e.SNECKO,e.SNAKE_PLANT,e.CENTURION_AND_HEALER],[e.SPIRE_GROWTH,e.TRANSIENT,e.FOUR_SHAPES,e.MAW,e.SPHERE_AND_TWO_SHAPES,e.JAW_WORM_HORDE,e.THREE_DARKLINGS,e.WRITHING_MASS]] as const;
const weights=[[1/16,1/16,1/16,1.5/16,1.5/16,2/16,2/16,2/16,2/16,2/16],[2/29,2/29,3/29,3/29,3/29,4/29,6/29,6/29],[1/8,1/8,1/8,1/8,1/8,1/8,1/8,1/8]] as const;
const elites=[[e.GREMLIN_NOB,e.LAGAVULIN,e.THREE_SENTRIES],[e.GREMLIN_LEADER,e.SLAVERS,e.BOOK_OF_STABBING],[e.GIANT_HEAD,e.NEMESIS,e.REPTOMANCER]] as const;
const bosses=[[e.THE_GUARDIAN,e.HEXAGHOST,e.SLIME_BOSS],[e.AUTOMATON,e.COLLECTOR,e.CHAMP],[e.AWAKENED_ONE,e.TIME_EATER,e.DONU_AND_DECA]] as const;
type Draw={stream:number;pool:readonly number[];weights:readonly number[]};
/** Content pools and rejection rules use public random atoms; no mutable RandomState leaves its owner. */
export const encounterPlans=defineRules({requires:[random],build(){
  const weighted=defineEffect<Draw,number>(b=>{const roll=b.local<number>();return sequence(b.assign(roll,call(random.exports.float,{stream:b.read(v=>v.input.stream)})),b.return(b.read(v=>{let sum=0;for(let i=0;i<v.input.weights.length;i++){sum=Math.fround(sum+Math.fround(v.input.weights[i]!));if(v.get(roll)<sum)return v.input.pool[i]!;}return v.input.pool.at(-1)!;})));});
  const populate=defineEffect<Draw&{prefix:readonly number[];count:number},number[]>(b=>{const list=b.local<number[]>(),picked=b.local<number>(),added=b.local<number>();return sequence(b.assign(list,b.read(v=>[...v.input.prefix])),b.assign(added,0),whileDo(b.read(v=>v.get(added)<v.input.count),sequence(
    b.assign(picked,call(weighted,b.read(v=>({stream:v.input.stream,pool:v.input.pool,weights:v.input.weights})))),when(b.read(v=>v.get(picked)!==v.get(list).at(-1)&&v.get(picked)!==v.get(list).at(-2)),sequence(b.assign(list,b.read(v=>[...v.get(list),v.get(picked)])),b.assign(added,b.read(v=>v.get(added)+1)))),
  )),b.return(list));});
  const generate=defineEffect<{stream:number;act:number;ascension:number},MonsterPlan>(b=>{const index=b.local<number>(),monsters=b.local<number[]>(),eliteList=b.local<number[]>(),picked=b.local<number>(),roll=b.local<number>(),found=b.local<boolean>(),order=b.local<readonly number[]>();return sequence(
    b.assign(index,b.read(v=>{if(!Number.isInteger(v.input.act)||v.input.act<1||v.input.act>3)throw Error('Monster plan requires act 1–3');return v.input.act-1;})),
    b.assign(monsters,call(populate,b.read(v=>{const pool=weak[v.get(index)]!;return{stream:v.input.stream,pool,weights:pool.map(()=>1/pool.length),prefix:[],count:v.input.act===1?3:2};}))),b.assign(found,false),
    whileDo(b.read(v=>!v.get(found)),sequence(b.assign(picked,call(weighted,b.read(v=>({stream:v.input.stream,pool:strong[v.get(index)]!,weights:weights[v.get(index)]!})))),when(b.read(v=>{const last=v.get(monsters).at(-1),next=v.get(picked);return !(last===e.SMALL_SLIMES&&(next===e.LARGE_SLIME||next===e.LOTS_OF_SLIMES)||last===e.TWO_LOUSE&&next===e.THREE_LOUSE);}),sequence(b.assign(monsters,b.read(v=>[...v.get(monsters),v.get(picked)])),b.assign(found,true))))),
    b.assign(monsters,call(populate,b.read(v=>({stream:v.input.stream,pool:strong[v.get(index)]!,weights:weights[v.get(index)]!,prefix:v.get(monsters),count:12})))),b.assign(eliteList,[]),
    whileDo(b.read(v=>v.get(eliteList).length<10),sequence(b.assign(roll,call(random.exports.float,{stream:b.read(v=>v.input.stream)})),b.assign(picked,b.read(v=>elites[v.get(index)]![v.get(roll)<Math.fround(1/3)?0:v.get(roll)<Math.fround(2/3)?1:2])),when(b.read(v=>v.get(picked)!==v.get(eliteList).at(-1)),b.assign(eliteList,b.read(v=>[...v.get(eliteList),v.get(picked)]))))),
    b.assign(order,random.exports.shuffle({stream:b.read(v=>v.input.stream),items:[0,1,2]})),b.return({monsterList:monsters,eliteList,boss:b.read(v=>bosses[v.get(index)]![v.get(order)[0]!]!),secondBoss:b.read(v=>v.input.act===3&&v.input.ascension>=20?bosses[v.get(index)]![v.get(order)[1]!]!:e.INVALID)}),
  );});
  return{exports:{generate}};
}});
