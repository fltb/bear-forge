import {z} from 'zod';
import {rules} from '../../rules/execution.ts';
import {rooms,type RoomDefinition,type RoomInput} from "../../rules/rooms.ts";
import {adventures} from "../../rules/adventures.ts";
import {random,float24Image} from "../../rules/random.ts";
import {resources} from "../../rules/resources.ts";
import {permanentDecks} from "../../rules/permanent-decks.ts";
import {relics,type RelicDefinition} from "../../rules/relics.ts";
import {createBattleAdventureEvents} from "./battles.ts";
import {createSelectionAdventureEvents} from "./selections.ts";
import {createRepeatedAdventureEvents} from "./repeated.ts";
import {basicEventAdmission,createBasicAdventureEvents} from "./basic.ts";
import {adventureEventUtils,sourceFraction} from "./utils.ts";
import {createAdventureLoot} from "../rewards/loot.ts";
import {eventId as e,type CardId} from "../../identifiers.ts";
import type {Room} from "../../map.types.ts";
import type {AdventureChoiceExports} from "../../rules/adventure-choices.ts";
import type {createAdventureAcquisition} from "../relics/acquisition.ts";
import {eventStep as step,eventOption as option,eventMenu,eventBranches} from './options.ts';
import type {RelicTier} from "../../rules/adventures.types.ts";

const {defineRules,defineQuery,defineEffect,defineEntity,sequence,when,call,query,spawnEntity,despawnEntity}=rules;
const clericHealPrice=35;
const clericRemovePrice=(ascension:number)=>ascension>=15?75:50;
type Catalog={id:number;definition:RoomDefinition}[];
export function createAdventureEvents(ui:rules.RuleModule<AdventureChoiceExports>,acquisition:ReturnType<typeof createAdventureAcquisition>){const loot=createAdventureLoot(acquisition),basic=createBasicAdventureEvents(ui,acquisition,loot),repeated=createRepeatedAdventureEvents(ui,acquisition,loot),eventBattles=createBattleAdventureEvents(ui,acquisition,loot),eventSelections=createSelectionAdventureEvents(ui,acquisition,loot);return defineRules({requires:[ui,acquisition,loot,adventureEventUtils,rooms,basic,repeated,eventBattles,eventSelections],build(){
  const programs=new Map<number,rules.Effect<number,void>>(),admissions=new Map<number,rules.Query<number,boolean>>();
  const admit=(predicate:(r:rules.QueryRead,run:number)=>boolean)=>defineQuery({input:z.number(),output:z.boolean(),dependencies:[adventures.exports.bindings,adventures.exports.position,adventures.exports.status,adventures.exports.market,adventures.exports.hasRelic,resources.exports.vitality,resources.exports.wealth,permanentDecks.exports.current,relics.exports.owned],base:predicate});
  for(const id of [e.DEAD_ADVENTURER,e.HYPNOTIZING_COLORED_MUSHROOMS])admissions.set(id,admit((r,run)=>r.query(adventures.exports.position,run).floor>6));
  admissions.set(e.THE_MOAI_HEAD,admit((r,run)=>{const s=r.query(adventures.exports.bindings,run),p=r.query(resources.exports.vitality,s.actor);return p.hp<=Math.trunc(p.maxHp/2)||r.query(adventures.exports.hasRelic,{run,id:'GOLDEN_IDOL'});}));
  admissions.set(e.THE_CLERIC,admit((r,run)=>r.query(resources.exports.wealth,r.query(adventures.exports.bindings,run).actor).gold>=clericHealPrice));
  admissions.set(e.OLD_BEGGAR,admit((r,run)=>r.query(resources.exports.wealth,r.query(adventures.exports.bindings,run).actor).gold>=basicEventAdmission.beggarGold));
  // The pinned reference disables these two events at compile time.
  admissions.set(e.COLOSSEUM,admit(()=>false));admissions.set(e.MATCH_AND_KEEP,admit(()=>false));
  admissions.set(e.THE_DIVINE_FOUNTAIN,admit((r,run)=>r.query(permanentDecks.exports.current,r.query(adventures.exports.bindings,run).deck).counts[3]>0));
  admissions.set(e.DESIGNER_IN_SPIRE,admit((r,run)=>{const s=r.query(adventures.exports.status,run);return(s.act===2||s.act===3)&&r.query(resources.exports.wealth,s.actor).gold>=75;}));
  admissions.set(e.DUPLICATOR,admit((r,run)=>[2,3].includes(r.query(adventures.exports.position,run).act)));
  admissions.set(e.FACE_TRADER,admit((r,run)=>[1,2].includes(r.query(adventures.exports.position,run).act)));
  admissions.set(e.KNOWING_SKULL,admit((r,run)=>{const s=r.query(adventures.exports.status,run);return s.act===2&&r.query(resources.exports.vitality,s.actor).hp>12;}));
  admissions.set(e.NLOTH,admit((r,run)=>{const s=r.query(adventures.exports.status,run);return s.act===2&&r.query(relics.exports.owned,s.actor).length>=2;}));
  admissions.set(e.THE_JOUST,admit((r,run)=>{const s=r.query(adventures.exports.status,run);return s.act===2&&r.query(resources.exports.wealth,s.actor).gold>=basicEventAdmission.joustGold;}));
  admissions.set(e.THE_WOMAN_IN_BLUE,admit((r,run)=>r.query(resources.exports.wealth,r.query(adventures.exports.bindings,run).actor).gold>=basicEventAdmission.womanGold));
  admissions.set(e.SECRET_PORTAL,admit((r,run)=>{const s=r.query(adventures.exports.market,run);return s.act===3&&!s.speedrunPace;}));
  const leave=defineEffect<number,void>(b=>call(adventures.exports.setScene,{run:b.input,screen:'MAP_SCREEN',continuation:b.read(v=>v.query(adventures.exports.position,v.input).hasContinuation)}));
  const selectionCount=1;
  const select=(type:number)=>defineEffect<number,void>(b=>sequence(call(acquisition.exports.selections.exports.select,{run:b.input,type,count:selectionCount,provided:null,stream:b.read(v=>v.query(adventures.exports.selection,v.input).selection.transformStream)}),call(leave,b.input)));
  const remove=select(4),upgrade=select(3),transform=defineEffect<number,void>(b=>sequence(call(adventures.exports.setTransformStream,{run:b.input,stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.misc)}),call(select(1),b.input)));
  const obtainCard=(id:CardId)=>defineEffect<number,void>(b=>call(permanentDecks.exports.obtain,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input).deck),definition:query(adventures.exports.card,{run:b.input,id}),count:1,upgraded:false,specialData:0,upgrade:false}));
  const leaveStep=step(leave,'离开');
  const menu=(id:number,options:Parameters<typeof eventMenu>[1])=>programs.set(id,defineEffect<number,void>(b=>sequence(call(eventMenu(ui,options),b.input),call(leave,b.input))));
  const selectionStep=(type:1|3|4|5)=>step(type===1?transform:type===3?upgrade:type===4?remove:select(type),`${{1:'变换',3:'升级',4:'移除',5:'复制'}[type]}${selectionCount}张牌`);
  for(const [id,type] of [[e.PURIFIER,4],[e.UPGRADE_SHRINE,3],[e.TRANSMORGRIFIER,1],[e.DUPLICATOR,5]] as const) {
    programs.set(id,eventMenu(ui,[option(0,selectionStep(type)),option(1,leaveStep)]));
  }
  programs.set(e.LIVING_WALL,eventMenu(ui,[option(0,selectionStep(4)),option(1,selectionStep(1)),option(2,selectionStep(3))]));
  const fishHealing=(v:rules.ReadView<number>)=>sourceFraction(v.query(resources.exports.vitality,v.query(adventures.exports.bindings,v.input).actor).maxHp,1/3),fishMaxHp=5;
  menu(e.BIG_FISH,[
    option(0,step(defineEffect<number,void>(b=>call(resources.exports.heal,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:b.read(fishHealing)})),v=>`回复${fishHealing(v)}生命`)),
    option(1,step(defineEffect<number,void>(b=>call(resources.exports.raiseMaxHp,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:fishMaxHp})),`增加${fishMaxHp}最大生命`)),
    option(2,step(defineEffect<number,void>(b=>{const rank=b.local<RelicTier>(),relic=b.local<RelicDefinition>();return sequence(b.assign(rank,call(loot.exports.tier,{run:b.input,elite:false})),b.assign(relic,call(acquisition.exports.draw,{run:b.input,tier:rank,shop:false,front:true,screenless:true})),call(acquisition.exports.give,{run:b.input,definition:relic}),call(obtainCard('REGRET'),b.input));}),'获得随机遗物和REGRET')),
  ]);
  const clericHealing=(v:rules.ReadView<number>)=>Math.trunc(Math.fround(v.query(resources.exports.vitality,v.query(adventures.exports.bindings,v.input).actor).maxHp*.25));
  programs.set(e.THE_CLERIC,defineEffect<number,void>(b=>{const healing=b.local<number>();return sequence(
    b.assign(healing,b.read(clericHealing)),eventBranches(b,ui,[
      {id:0,text:v=>`支付${clericHealPrice}金币，回复${v.get(healing)}生命`,allowed:v=>v.query(resources.exports.wealth,v.query(adventures.exports.bindings,v.input).actor).gold>=clericHealPrice,execute:sequence(call(resources.exports.spendGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:clericHealPrice}),call(resources.exports.heal,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:healing}))},
      {id:1,text:v=>`支付${clericRemovePrice(v.query(adventures.exports.bindings,v.input).ascension)}金币，移除${selectionCount}张牌`,allowed:v=>{const s=v.query(adventures.exports.bindings,v.input);return v.query(resources.exports.wealth,s.actor).gold>=clericRemovePrice(s.ascension)&&v.query(permanentDecks.exports.current,s.deck).transformable>0;},execute:sequence(call(resources.exports.spendGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:b.read(v=>clericRemovePrice(v.query(adventures.exports.bindings,v.input).ascension))}),call(remove,b.input))},
      {id:2,text:'离开',execute:sequence()},
    ]),call(leave,b.input),
  );}));
  const shiningLoss=(v:rules.ReadView<number>)=>{const run=v.query(adventures.exports.bindings,v.input);return sourceFraction(v.query(resources.exports.vitality,run.actor).maxHp,run.ascension>=15?.3:.2,'round');},shiningUpgrades=2;
  programs.set(e.SHINING_LIGHT,defineEffect<number,void>(b=>{const loss=b.local<number>();return sequence(b.assign(loss,b.read(shiningLoss)),eventBranches(b,ui,[
    {id:0,text:v=>`受到${v.get(loss)}伤害，随机升级${shiningUpgrades}张牌`,execute:sequence(call(adventureEventUtils.exports.hurt,{run:b.input,amount:loss,direct:false}),call(permanentDecks.exports.upgradeRandom,{deck:b.read(v=>v.query(adventures.exports.bindings,v.input).deck),stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.misc),count:shiningUpgrades}))},
    {id:1,text:'离开',execute:sequence()},
  ]),call(leave,b.input));}));
  programs.set(e.WORLD_OF_GOOP,defineEffect<number,void>(b=>{
    const loss=b.local<number>(),damage=11,gold=75;
    return sequence(b.assign(loss,call(random.exports.int,{stream:b.read(v=>v.query(adventures.exports.bindings,v.input).streams.misc),start:b.read(v=>v.query(adventures.exports.bindings,v.input).ascension>=15?35:20),end:b.read(v=>v.query(adventures.exports.bindings,v.input).ascension>=15?75:50)})),b.assign(loss,b.read(v=>Math.min(v.get(loss),v.query(resources.exports.wealth,v.query(adventures.exports.bindings,v.input).actor).gold))),eventBranches(b,ui,[
      {id:0,text:`受到${damage}伤害；获得${gold}金币`,execute:sequence(call(adventureEventUtils.exports.hurt,{run:b.input,amount:damage,direct:false}),call(resources.exports.gainGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:gold}))},
      {id:1,text:v=>`失去${v.get(loss)}金币并离开`,execute:call(resources.exports.spendGold,{entity:b.read(v=>v.query(adventures.exports.bindings,v.input).actor),amount:loss})},
    ]),call(leave,b.input));
  }));
  for(const [id,effect] of Object.entries({...basic.exports.programs,...repeated.exports.programs,...eventBattles.exports.programs,...eventSelections.exports.programs}))programs.set(Number(id),effect!);
  const definitions=Object.values(e).filter(id=>id!==e.INVALID&&id!==e.NEOW).map(id=>({id,definition:defineEntity(rooms.exports.kind,{admit:admissions.get(id),enter:defineEffect<RoomInput,void>(b=>call(programs.get(id)??missing,b.read(v=>v.input.run)))})}));
  const missing=defineEffect<number,void>(b=>b.return(b.read(v=>{throw Error('Event content is not implemented: '+v.query(adventures.exports.position,v.input).event);}))),streamDefinition=defineEntity(random.exports.stream,undefined);
  const chooseShrine=defineEffect<{run:number;stream:number;catalog:Catalog},number>(b=>{const eligible=b.local<number[]>(),picked=b.local<number>();return sequence(b.assign(eligible,b.read(v=>{const s=v.query(adventures.exports.pools,v.input.run);return[...s.shrineList,...s.oneTimeEvents].filter(id=>{const def=v.input.catalog.find(entry=>entry.id===id)?.definition;return def!==undefined&&v.query(rooms.exports.allowed,{run:v.input.run,definition:def});});})),b.assign(picked,call(random.exports.mappedInt,{stream:b.read(v=>v.input.stream),values:eligible,declarations:b.read(v=>v.get(eligible).map(value=>({name:'resolved-event',value})))})),call(adventures.exports.removeEvent,{run:b.read(v=>v.input.run),id:picked,pools:['shrineList','oneTimeEvents']}),b.return(picked));});
  const chooseEvent=defineEffect<{run:number;stream:number;catalog:Catalog},number>(b=>{const eligible=b.local<number[]>(),picked=b.local<number>();return sequence(b.assign(eligible,b.read(v=>v.query(adventures.exports.pools,v.input.run).eventList.filter(id=>{const def=v.input.catalog.find(entry=>entry.id===id)?.definition;return def!==undefined&&v.query(rooms.exports.allowed,{run:v.input.run,definition:def});}))),when(b.read(v=>v.get(eligible).length===0),sequence(b.assign(picked,call(chooseShrine,{run:b.read(v=>v.input.run),stream:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.event),catalog:b.read(v=>v.input.catalog)})),b.return(picked))),b.assign(picked,call(random.exports.mappedInt,{stream:b.read(v=>v.input.stream),values:eligible,declarations:b.read(v=>v.get(eligible).map(value=>({name:'resolved-event',value})))})),call(adventures.exports.removeEvent,{run:b.read(v=>v.input.run),id:picked,pools:['eventList']}),b.return(picked));});
  const eventIndex=(roll:number)=>Math.trunc(Math.fround(roll*100));
  const roomAt=(index:number,forcedChest:boolean,monster:number,shop:number,treasure:number):Room=>forcedChest?'TREASURE':index<monster?'MONSTER':index<shop?'SHOP':index<treasure?'TREASURE':'EVENT';
  const withJuzu=(room:Room,owned:boolean):Room=>room==='MONSTER'&&owned?'EVENT':room;
  const roomInputs=defineQuery({input:z.object({run:z.number(),lastRoomWasShop:z.boolean(),tiny:z.number().nullable()}),output:z.object({forcedChest:z.boolean(),monster:z.number(),shop:z.number(),treasure:z.number()}),dependencies:[adventures.exports.economy,relics.exports.data],base:(r,i)=>{
    const s=r.query(adventures.exports.economy,i.run),monster=Math.trunc(Math.fround(s.monsterChance*100)),shop=monster+(i.lastRoomWasShop?0:Math.trunc(Math.fround(s.shopChance*100))),treasure=shop+Math.trunc(Math.fround(s.treasureChance*100));
    return{forcedChest:i.tiny!==null&&r.query(relics.exports.data,i.tiny)===acquisition.exports.counterPrograms.TINY_CHEST.triggerAt,monster,shop,treasure};
  }});
  const sample=defineEffect<{run:number;lastRoomWasShop:boolean},Room>(b=>{const roll=b.local<number>(),room=b.local<Room>(),copy=b.local<number>(),catalog=b.local<Catalog>(),picked=b.local<number>(),tiny=b.local<number|null>();return sequence(
    b.assign(catalog,definitions),b.assign(tiny,query(relics.exports.find,{actor:b.read(v=>v.query(adventures.exports.bindings,v.input.run).actor),definition:query(adventures.exports.relic,{run:b.read(v=>v.input.run),id:'TINY_CHEST'})})),b.assign(roll,call(random.exports.mappedFloat,b.read(v=>{
      const data=v.query(roomInputs,{run:v.input.run,lastRoomWasShop:v.input.lastRoomWasShop,tiny:v.get(tiny)}),juzu=v.query(adventures.exports.hasRelic,{run:v.input.run,id:'JUZU_BRACELET'});
      return{stream:v.query(adventures.exports.bindings,v.input.run).streams.event,image:float24Image(0,1,eventIndex).map(row=>({...row,publication:{name:'resolved-room',value:withJuzu(roomAt(row.value,data.forcedChest,data.monster,data.shop,data.treasure),juzu)}}))};
    }))),b.assign(room,b.read(v=>{const data=v.query(roomInputs,{run:v.input.run,lastRoomWasShop:v.input.lastRoomWasShop,tiny:v.get(tiny)});return roomAt(v.get(roll),data.forcedChest,data.monster,data.shop,data.treasure);})),
    when(b.read(v=>v.get(tiny)!==null),call(relics.exports.interact,b.read(v=>v.get(tiny)!))),
    b.assign(room,b.read(v=>withJuzu(v.get(room),v.query(adventures.exports.hasRelic,{run:v.input.run,id:'JUZU_BRACELET'})))),
    call(adventures.exports.setRoomChances,b.read(v=>{const s=v.query(adventures.exports.economy,v.input.run),r=v.get(room);return{run:v.input.run,monster:r==='MONSTER'||r==='EVENT'&&v.query(adventures.exports.hasRelic,{run:v.input.run,id:'JUZU_BRACELET'})&&v.get(roll)<Math.trunc(Math.fround(s.monsterChance*100))?Math.fround(.1):Math.fround(s.monsterChance+Math.fround(.1)),shop:r==='SHOP'?Math.fround(.03):Math.fround(s.shopChance+Math.fround(.03)),treasure:r==='TREASURE'?Math.fround(.02):Math.fround(s.treasureChance+Math.fround(.02))};})),
    when(b.read(v=>v.get(room)==='EVENT'),sequence(b.assign(copy,spawnEntity({definition:streamDefinition,owner:b.read(v=>v.input.run),scope:b.read(v=>v.query(adventures.exports.bindings,v.input.run).scope),setup:0n})),call(random.exports.copyFrom,{target:copy,source:b.read(v=>v.query(adventures.exports.bindings,v.input.run).streams.event)}),b.assign(roll,call(random.exports.mappedFloat,{stream:copy,image:float24Image(0,1,roll=>roll<Math.fround(.25)?0:1)})),when(b.read(v=>v.get(roll)===0&&(()=>{const s=v.query(adventures.exports.pools,v.input.run);return s.shrineList.length+s.oneTimeEvents.length>0;})()),b.assign(picked,call(chooseShrine,{run:b.read(v=>v.input.run),stream:copy,catalog})),b.assign(picked,call(chooseEvent,{run:b.read(v=>v.input.run),stream:copy,catalog}))),despawnEntity({entity:copy,reason:{drawComplete:true}}),call(adventures.exports.setRoom,{run:b.read(v=>v.input.run),room:'EVENT',event:picked})),call(adventures.exports.setRoom,{run:b.read(v=>v.input.run),room,event:e.INVALID})),b.return(room),
  );});
  const resolve=defineEffect<number,Room>(b=>call(sample,{run:b.input,lastRoomWasShop:b.read(v=>v.query(adventures.exports.position,v.input).lastRoom==='SHOP')}));
  const open=defineEffect<number,void>(b=>{const catalog=b.local<Catalog>(),entity=b.local<number>();return sequence(b.assign(catalog,definitions),call(adventures.exports.setScene,{run:b.input,screen:'EVENT_SCREEN',continuation:true}),b.assign(entity,spawnEntity({kind:rooms.exports.kind,definition:b.read(v=>{const id=v.query(adventures.exports.position,v.input).event,entry=v.get(catalog).find(c=>c.id===id);if(!entry)throw Error('Event definition is absent: '+id);return entry.definition;}),owner:b.input,scope:b.read(v=>v.query(adventures.exports.bindings,v.input).scope),setup:{run:b.input}})),despawnEntity({entity,reason:{eventComplete:true}}));});
  return{exports:{open,resolve,sample,relicTexts:Object.freeze({TINY_CHEST:`每经过${acquisition.exports.counterPrograms.TINY_CHEST.period}个问号房间，将该次房间替换为宝箱。`,JUZU_BRACELET:'问号房间抽到普通战斗时，改为事件。'})}};
}});}
