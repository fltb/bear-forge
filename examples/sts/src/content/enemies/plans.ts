import {rules} from '../../rules/execution.ts';
import {random} from "../../rules/random.ts";
import {encounterId as e} from "../../identifiers.ts";
import {float24Choices,float24Index,permutationNextChoices,type Float24Selection,type OrderChoice} from '../../rules/ordering.ts';
import type {MonsterPlan} from "../../encounters.types.ts";
const {defineRules,defineEffect,sequence,when,whileDo,call}=rules;
const weak=[[e.CULTIST,e.JAW_WORM,e.TWO_LOUSE,e.SMALL_SLIMES],[e.SPHERIC_GUARDIAN,e.CHOSEN,e.SHELL_PARASITE,e.THREE_BYRDS,e.TWO_THIEVES],[e.THREE_DARKLINGS,e.ORB_WALKER,e.THREE_SHAPES]] as const;
const strong=[[e.GREMLIN_GANG,e.LOTS_OF_SLIMES,e.RED_SLAVER,e.EXORDIUM_THUGS,e.EXORDIUM_WILDLIFE,e.BLUE_SLAVER,e.LOOTER,e.LARGE_SLIME,e.THREE_LOUSE,e.TWO_FUNGI_BEASTS],[e.CHOSEN_AND_BYRDS,e.SENTRY_AND_SPHERE,e.CULTIST_AND_CHOSEN,e.THREE_CULTIST,e.SHELLED_PARASITE_AND_FUNGI,e.SNECKO,e.SNAKE_PLANT,e.CENTURION_AND_HEALER],[e.SPIRE_GROWTH,e.TRANSIENT,e.FOUR_SHAPES,e.MAW,e.SPHERE_AND_TWO_SHAPES,e.JAW_WORM_HORDE,e.THREE_DARKLINGS,e.WRITHING_MASS]] as const;
const weights=[[1/16,1/16,1/16,1.5/16,1.5/16,2/16,2/16,2/16,2/16,2/16],[2/29,2/29,3/29,3/29,3/29,4/29,6/29,6/29],[1/8,1/8,1/8,1/8,1/8,1/8,1/8,1/8]] as const;
const elites=[[e.GREMLIN_NOB,e.LAGAVULIN,e.THREE_SENTRIES],[e.GREMLIN_LEADER,e.SLAVERS,e.BOOK_OF_STABBING],[e.GIANT_HEAD,e.NEMESIS,e.REPTOMANCER]] as const;
const bosses=[[e.THE_GUARDIAN,e.HEXAGHOST,e.SLIME_BOSS],[e.AUTOMATON,e.COLLECTOR,e.CHAMP],[e.AWAKENED_ONE,e.TIME_EATER,e.DONU_AND_DECA]] as const;
// Both cached-plan execution and future-space execution use these original
// content tables and predicates. No search-specific encounter rules exist.
const eliteThresholds=[Math.fround(1/3),Math.fround(2/3)];
function thresholds(weights:readonly number[]){let sum=0;return weights.map(weight=>sum=Math.fround(sum+Math.fround(weight)));}
function fresh(picked:number,history:readonly number[]){return picked!==history.at(-1)&&picked!==history.at(-2);}
function firstStrong(picked:number,history:readonly number[]){const last=history.at(-1);return !(last===e.SMALL_SLIMES&&(picked===e.LARGE_SLIME||picked===e.LOTS_OF_SLIMES)||last===e.TWO_LOUSE&&picked===e.THREE_LOUSE);}
function freshElite(picked:number,history:readonly number[]){return picked!==history.at(-1);}
function actIndex(act:number){if(!Number.isInteger(act)||act<1||act>3)throw Error('Monster plan requires act 1–3');return act-1;}
function weakCount(act:number){return act===1?3:2;}
/** The single original encounter selection definition. Both the production
 * rejection loop and its probability projection consume this same data. */
export function encounterSelection(act:number,elite:boolean,history:readonly number[]):Float24Selection {
  const index=actIndex(act),early=history.length<weakCount(act),values=elite?elites[index]!:early?weak[index]!:strong[index]!;
  const bounds=elite?eliteThresholds:thresholds(early?values.map(()=>1/values.length):weights[index]!).slice(0,-1);
  const accept=elite?freshElite:history.length===weakCount(act)?firstStrong:fresh;
  return{values,bounds,accepted:values.map(value=>accept(value,history))};
}
export function nextEncounterChoices(act:number,elite:boolean,history:readonly number[]):OrderChoice[]{
  return float24Choices(encounterSelection(act,elite,history));
}
function bossPool(act:number){return bosses[actIndex(act)]!;}
export function secondBossChoices(first:number):OrderChoice[]{
  return permutationNextChoices(bossPool(3),[first]);
}
type Draw={stream:number;act:number;elite:boolean;history:readonly number[]};
/** Content pools and rejection rules use public random atoms; no mutable RandomState leaves its owner. */
export const encounterPlans=defineRules({requires:[random],build(){
  const next=defineEffect<Draw,number>(b=>{
    const selection=b.local<Float24Selection>(),roll=b.local<number>(),index=b.local<number>();
    return sequence(
      b.assign(selection,b.read(v=>encounterSelection(v.input.act,v.input.elite,v.input.history))),
      whileDo(true,sequence(
        b.assign(roll,call(random.exports.float,{stream:b.read(v=>v.input.stream)})),
        b.assign(index,b.read(v=>float24Index(v.get(selection),v.get(roll)))),
        when(b.read(v=>v.get(selection).accepted[v.get(index)]!),b.return(b.read(v=>v.get(selection).values[v.get(index)]!))),
      )),
    );
  });
  const populate=defineEffect<{stream:number;act:number;elite:boolean;count:number},number[]>(b=>{
    const list=b.local<number[]>(),picked=b.local<number>();
    return sequence(b.assign(list,[]),whileDo(b.read(v=>v.get(list).length<v.input.count),sequence(
      b.assign(picked,call(next,{stream:b.read(v=>v.input.stream),act:b.read(v=>v.input.act),elite:b.read(v=>v.input.elite),history:list})),
      b.assign(list,b.read(v=>[...v.get(list),v.get(picked)])),
    )),b.return(list));
  });
  const generate=defineEffect<{stream:number;act:number;ascension:number},MonsterPlan>(b=>{
    const monsters=b.local<number[]>(),eliteList=b.local<number[]>(),order=b.local<readonly number[]>();
    return sequence(
      b.assign(monsters,call(populate,{stream:b.read(v=>v.input.stream),act:b.read(v=>v.input.act),elite:false,count:b.read(v=>weakCount(v.input.act)+1+12)})),
      b.assign(eliteList,call(populate,{stream:b.read(v=>v.input.stream),act:b.read(v=>v.input.act),elite:true,count:10})),
      b.assign(order,random.exports.shuffle({stream:b.read(v=>v.input.stream),items:b.read(v=>bossPool(v.input.act))})),
      b.return({monsterList:monsters,eliteList,boss:b.read(v=>v.get(order)[0]!),secondBoss:b.read(v=>v.input.act===3&&v.input.ascension>=20?v.get(order)[1]!:e.INVALID)}),
    );
  });
  return{exports:{generate}};
}});
