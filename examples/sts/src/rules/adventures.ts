import { typedValue } from './value.schemas.ts';
import {z} from 'zod';
import * as parts from './adventures.schemas.ts';
import {componentPart,projectFields} from './component-parts.ts';
import {adventureHistory} from './adventure-history.ts';
import {rules} from './execution.ts';
import {resources} from './resources.ts';
import {permanentDecks} from './permanent-decks.ts';
import {cardInstances} from './card-instances.ts';
import {potions} from './potions.ts';
import {random} from './random.ts';
import {ordering,type OrderChoice} from './ordering.ts';
import {probabilityMass} from '@bear-forge/card-engine/probability-mass';
import {relics} from './relics.ts';
import {entityId} from './resources.schemas.ts';
import {adventureSetupSchema,adventureStateSchema,cardDefinitionSchema,relicDefinitionSchema,relicTiers,rewardsSchema,selectionSchema,selectedSchema} from './adventures.schemas.ts';
import type {AdventureSetup,AdventureState,AdventureCatalog,AdventureRewards,AdventureSelection,RelicTier} from './adventures.types.ts';
import type {PermanentCardDefinition} from './permanent-decks.types.ts';
import type {RelicDefinition} from './relics.ts';
/** Catalog labels are open; executable identity remains a typed definition reference. */
type CardId=string;
type RelicId=string;
const {defineRules,defineComponent,defineEvent,defineQuery,defineEffect,defineEntity,sequence,call,query,spawnEntity}=rules;
export const emptyAdventureRewards=():AdventureRewards=>({gold:[],cards:[],relics:[],potions:[],emeraldKey:false,sapphireKey:false});
export const adventures=defineRules({requires:[resources,permanentDecks,potions,random,relics,ordering],build(m){
  const menu=m.own(defineComponent({schema:z.object({enabled:z.boolean(),options:z.record(z.string(),z.string())}),initial:()=>({enabled:false,options:{}})}));
  const detailsEnabled=defineQuery({input:entityId,output:z.boolean(),reads:[menu],base:(r,id)=>r.component(id,menu).enabled});
  const optionDetails=defineQuery({input:entityId,output:z.record(z.string(),z.string()).nullable(),reads:[menu],base:(r,id)=>{const value=r.component(id,menu);return value.enabled&&Object.keys(value.options).length?value.options:null;}});
  const enableDetails=m.atom({input:entityId,output:z.undefined(),reads:[menu],writes:[menu],emits:[],run(r,entity){return{writes:[{entity,component:menu,value:{...r.component(entity,menu),enabled:true}}],events:[],result:undefined};}});
  const setOptionDetails=m.atom({input:z.object({run:entityId,options:z.record(z.string(),z.string())}),output:z.undefined(),reads:[menu],writes:[menu],emits:[],run(r,i){return{writes:[{entity:i.run,component:menu,value:{...r.component(i.run,menu),options:i.options}}],events:[],result:undefined};}});
  const settlement={},afterSettlement={},combatStages={settlement,afterSettlement};
  const combatFinished=m.own(defineEvent({payload:z.object({run:entityId,battle:entityId,actor:entityId,outcome:z.union([z.literal(1),z.literal(2)])}),dispatch:'immediate',order:{phases:[{phase:settlement,before:[afterSettlement]},{phase:afterSettlement}],default:settlement}}));
  const notifyCombatFinished=m.atom({input:z.object({run:entityId,battle:entityId,actor:entityId,outcome:z.union([z.literal(1),z.literal(2)])}),output:z.undefined(),reads:[],writes:[],emits:[combatFinished],run(_r,payload){return{writes:[],events:[{event:combatFinished,payload}],result:undefined};}});
  const bindings=componentPart(m,parts.adventureBindingsSchema),position=componentPart(m,parts.adventurePositionSchema),plan=componentPart(m,parts.adventurePlanSchema),economy=componentPart(m,parts.adventureEconomySchema),pools=componentPart(m,parts.adventurePoolsSchema),selection=componentPart(m,parts.adventureSelectionSchema),rewards=componentPart(m,parts.adventureRewardsSchema),history=adventureHistory(m,bindings.current);
  const pickBindings=projectFields(parts.adventureBindingsSchema),pickPosition=projectFields(parts.adventurePositionSchema),pickPlan=projectFields(parts.adventurePlanSchema),pickEconomy=projectFields(parts.adventureEconomySchema),pickPools=projectFields(parts.adventurePoolsSchema),pickSelection=projectFields(parts.adventureSelectionSchema),pickRewards=projectFields(parts.adventureRewardsSchema);
  const required=<T>(value:T|null):T=>{if(value===null)throw Error('Missing adventure');return value;};
  const requesting=m.own(rules.defineEvent({payload:entityId,dispatch:'immediate'}));
  const entered=m.own(rules.defineEvent({payload:z.object({run:entityId,actor:entityId,room:adventureStateSchema.shape.room}),dispatch:'immediate'}));
  const notifyEntered=m.atom({input:z.object({run:entityId,room:adventureStateSchema.shape.room}),output:z.undefined(),reads:[bindings.component],writes:[],emits:[entered],run(r,i){const s=r.component(i.run,bindings.component);if(s===null)throw Error('Missing adventure');return{writes:[],events:[{event:entered,payload:{...i,actor:s.actor}}],result:undefined};}});
  const prepareRequest=m.atom({input:entityId,output:z.undefined(),reads:[],writes:[],emits:[requesting],run(_r,run){return{writes:[],events:[{event:requesting,payload:run}],result:undefined};}});
  const status=defineQuery({input:entityId,output:parts.adventureBindingsSchema.extend(parts.adventurePositionSchema.shape),dependencies:[bindings.current,position.current],base:(r,id)=>({...r.query(bindings.current,id),...r.query(position.current,id)})});
  const location=defineQuery({input:entityId,output:parts.adventurePositionSchema.extend(parts.adventurePlanSchema.shape),dependencies:[position.current,plan.current],base:(r,id)=>({...r.query(position.current,id),...r.query(plan.current,id)})});
  const market=defineQuery({input:entityId,output:parts.adventureEconomySchema.extend(parts.adventurePositionSchema.shape),dependencies:[economy.current,position.current],base:(r,id)=>({...r.query(economy.current,id),...r.query(position.current,id)})});
  const rewardScene=defineQuery({input:entityId,output:parts.adventureRewardsSchema.extend(parts.adventurePositionSchema.shape),dependencies:[rewards.current,position.current],base:(r,id)=>({...r.query(rewards.current,id),...r.query(position.current,id)})});
  const selectionContext=defineQuery({input:entityId,output:parts.adventureBindingsSchema.extend(parts.adventureSelectionSchema.shape),dependencies:[bindings.current,selection.current],base:(r,id)=>({...r.query(bindings.current,id),...r.query(selection.current,id)})});
  const historyStatus=defineQuery({input:entityId,output:parts.adventureHistorySchema.extend(parts.adventurePositionSchema.shape),dependencies:[history.current,position.current],base:(r,id)=>({...r.query(history.current,id),...r.query(position.current,id)})});
  const publication=defineQuery({input:entityId,output:parts.adventureBindingsSchema.extend(parts.adventurePlanSchema.shape).extend(parts.adventurePositionSchema.shape).extend(parts.adventureRewardsSchema.shape).extend(parts.adventureSelectionSchema.shape),dependencies:[bindings.current,plan.current,position.current,rewards.current,selection.current],base:(r,id)=>({...r.query(bindings.current,id),...r.query(plan.current,id),...r.query(position.current,id),...r.query(rewards.current,id),...r.query(selection.current,id)})});
  const privateProjection=defineQuery({input:entityId,output:parts.adventureBindingsSchema.extend(parts.adventureEconomySchema.shape).extend(parts.adventurePlanSchema.shape).extend(parts.adventurePoolsSchema.shape).extend(parts.adventurePositionSchema.shape).extend(parts.adventureSelectionSchema.shape),dependencies:[bindings.current,economy.current,plan.current,pools.current,position.current,selection.current],base:(r,id)=>({...r.query(bindings.current,id),...r.query(economy.current,id),...r.query(plan.current,id),...r.query(pools.current,id),...r.query(position.current,id),...r.query(selection.current,id)})});
  const instances=defineQuery({input:z.undefined(),output:z.array(entityId),reads:[bindings.component],base:r=>r.entities(bindings.component).filter(id=>r.component(id,bindings.component)!==null)});
  const forActor=defineQuery({input:entityId,output:entityId.nullable(),reads:[bindings.component],base:(r,actor)=>{const ids=r.entities(bindings.component).filter(id=>r.component(id,bindings.component)?.actor===actor);if(ids.length>1)throw Error('Actor has two adventures');return ids[0]??null;}});
  // Configuration belongs to the shared Program. This index contains no run
  // state; each frozen configuration builds its derived lookup once on first use.
  const cardIndex=new WeakMap<object,Map<string,PermanentCardDefinition>>(),relicIndex=new WeakMap<object,Map<string,RelicDefinition>>();
  const configurationSchema=parts.catalogSchema.transform(value=>{
    if(new Set(value.cards.map(c=>c.id)).size!==value.cards.length||new Set(value.relics.map(c=>c.id)).size!==value.relics.length)throw Error('Duplicate catalog identity');
    for(const c of value.cards)if(rules.entityConfiguration(cardInstances.exports.kind,c.definition).id!==c.id)throw Error('Card catalog identity mismatch');
    for(const c of value.relics)if(rules.entityConfiguration(relics.exports.kind,c.definition).id!==c.id)throw Error('Relic catalog identity mismatch');
    const pools=value.cardPools;
    if(pools.rarity.length!==3||pools.typeRarity.length!==3||pools.typeRarity.some(row=>row.length!==3)||pools.combat.length!==5)throw Error('Invalid character pool dimensions');
    const ids=new Set(value.cards.map(c=>c.id));
    for(const pool of [...pools.rarity,...pools.typeRarity.flat(),pools.random,pools.transform,...pools.combat,pools.startingBasics]){
      if(pool.some(id=>!ids.has(id)))throw Error('Character pool references an unregistered card');
    }
    return value;
  });
  const validate=defineQuery({input:adventureSetupSchema,output:adventureSetupSchema,dependencies:[forActor,resources.exports.current,permanentDecks.exports.current,random.exports.current,cardInstances.exports.definitionMetadata],kinds:[cardInstances.exports.kind,relics.exports.kind],base:(r,i)=>{
    const {start}=i;r.query(resources.exports.current,start.actor);if(r.query(forActor,start.actor)!==null||r.query(permanentDecks.exports.current,start.deck).actor!==start.actor)throw Error('Invalid adventure owner');for(const stream of Object.values(start.streams))r.query(random.exports.current,stream);
    return i;
  }});
  const begin=m.atom({input:z.object({entity:entityId,value:adventureStateSchema}),output:z.undefined(),reads:[],writes:[bindings.component,position.component,plan.component,economy.component,pools.component,selection.component,rewards.component,history.component],emits:[],run(_r,i){return{writes:[
    {entity:i.entity,component:bindings.component,value:pickBindings(i.value)},{entity:i.entity,component:position.component,value:pickPosition(i.value)},
    {entity:i.entity,component:plan.component,value:pickPlan(i.value)},{entity:i.entity,component:economy.component,value:pickEconomy(i.value)},
    {entity:i.entity,component:pools.component,value:pickPools(i.value)},{entity:i.entity,component:selection.component,value:pickSelection(i.value)},
    {entity:i.entity,component:rewards.component,value:pickRewards(i.value)},{entity:i.entity,component:history.component,value:history.initial()},
  ],events:[],result:undefined};}});
  const inventory=defineEntity(potions.exports.kind,undefined);
  const initialize:rules.Effect<rules.EntityLifecycle<AdventureSetup>,void>=defineEffect<rules.EntityLifecycle<AdventureSetup>,void>(b=>{const input=b.local<AdventureSetup>(),belt=b.local<number>();const catalogValue=query(catalog,b.read(v=>v.input.entity));return sequence(b.assign(input,query(validate,b.read(v=>v.input.setup))),b.assign(belt,spawnEntity({definition:inventory,owner:b.read(v=>v.get(input).start.actor),scope:b.read(v=>v.input.scope),setup:{actor:b.read(v=>v.get(input).start.actor),capacity:2}})),call(begin,{entity:b.read(v=>v.input.entity),value:b.read(v=>{
    const {start,initial}=v.get(input),{catalog}=v.get(catalogValue),lookupCard=(id:CardId)=>{const found=catalog.cards.find(c=>c.id===id);if(!found)throw Error('Missing initial card definition: '+id);return found.definition;},lookupRelic=(id:RelicId)=>{const found=catalog.relics.find(c=>c.id===id);if(!found)throw Error('Missing initial relic definition: '+id);return found.definition;};
    return{...start,catalog,scope:v.input.scope,potions:v.get(belt),ascension:20,act:1,floor:0,x:-1,y:-1,screen:'EVENT_SCREEN',outcome:1 as const,room:'INVALID' as const,lastRoom:'INVALID' as const,event:initial.event,eventData:0,hasContinuation:false,keys:{red:false,green:false,blue:false},relicPools:Object.fromEntries(relicTiers.map(key=>[key,start.relicPools[key].map(lookupRelic)])) as AdventureState['relicPools'],colorlessPool:initial.colorlessPool.map(lookupCard),eventList:[...initial.eventList],shrineList:[...initial.shrineList],oneTimeEvents:[...initial.oneTimeEvents],monsterOffset:0,eliteOffset:0,cardRarityFactor:5,potionChance:0,monsterChance:Math.fround(.1),shopChance:Math.fround(.03),treasureChance:Math.fround(.02),shopRemoveCount:0,selection:{type:0,count:0,cards:[],selected:[],transformStream:start.streams.card},rewards:emptyAdventureRewards(),history:[],published:0,stolenGold:0,speedrunPace:false,skipBattles:false,noteForYourself:{definition:lookupCard(initial.note),upgraded:false,misc:0},bossRelics:[],chest:null};
  })}));});
  const kind:rules.EntityKind<AdventureCatalog,AdventureSetup>=m.kind({config:configurationSchema,setup:adventureSetupSchema,components:[menu,bindings.component,position.component,plan.component,economy.component,pools.component,selection.component,rewards.component,history.component],initialize});
  const catalog:rules.Query<number,{catalog:AdventureCatalog}>=defineQuery({input:entityId,output:parts.adventureCatalogSchema,kinds:[kind],base:(r,id)=>({catalog:r.configuration(id,kind)})});
  const card=defineQuery({input:z.object({run:entityId,id:typedValue<CardId>()}),output:cardDefinitionSchema,kinds:[kind],base:(r,i)=>{
    const config=r.configuration(i.run,kind);let entries=cardIndex.get(config);if(!entries){entries=new Map(config.cards.map(c=>[c.id,c.definition]));cardIndex.set(config,entries);}
    const definition=entries.get(i.id);if(!definition)throw Error('Card definition is not installed: '+i.id);return definition;
  }});
  const relic=defineQuery({input:z.object({run:entityId,id:typedValue<RelicId>()}),output:relicDefinitionSchema,kinds:[kind],base:(r,i)=>{
    const config=r.configuration(i.run,kind);let entries=relicIndex.get(config);if(!entries){entries=new Map(config.relics.map(c=>[c.id,c.definition]));relicIndex.set(config,entries);}
    const definition=entries.get(i.id);if(!definition)throw Error('Relic definition is not installed: '+i.id);return definition;
  }});
  const cardPools=defineQuery({input:entityId,output:parts.characterCardPoolsSchema,kinds:[kind],base:(r,id)=>r.configuration(id,kind).cardPools});
  const current=defineQuery({input:entityId,output:adventureStateSchema,dependencies:[bindings.current,position.current,plan.current,economy.current,pools.current,selection.current,rewards.current,history.current,catalog],base:(r,id)=>({...r.query(bindings.current,id),...r.query(position.current,id),...r.query(plan.current,id),...r.query(economy.current,id),...r.query(pools.current,id),...r.query(selection.current,id),...r.query(rewards.current,id),...r.query(history.current,id),...r.query(catalog,id)})});
  const hasRelic=defineQuery({input:z.object({run:entityId,id:typedValue<RelicId>()}),output:z.boolean(),dependencies:[bindings.current,relic,relics.exports.find],base:(r,i)=>r.query(relics.exports.find,{actor:r.query(bindings.current,i.run).actor,definition:r.query(relic,i)})!==null});
  const setScene=position.change(z.object({run:entityId,screen:z.string(),continuation:z.boolean()}),z.undefined(),(s,i)=>({state:{...s,screen:i.screen,hasContinuation:i.continuation},result:undefined}));
  const setRarity=economy.change(z.object({run:entityId,factor:z.int32()}),z.undefined(),(s,i)=>({state:{...s,cardRarityFactor:i.factor},result:undefined}));
  const countShopRemove=economy.change(z.object({run:entityId}),z.undefined(),s=>({state:{...s,shopRemoveCount:s.shopRemoveCount+1},result:undefined}));
  const setKeys=position.change(z.object({run:entityId,keys:adventureStateSchema.shape.keys}),z.undefined(),(s,i)=>({state:{...s,keys:i.keys},result:undefined}));
  const setOutcome=position.change(z.object({run:entityId,outcome:adventureStateSchema.shape.outcome}),z.undefined(),(s,i)=>({state:{...s,outcome:i.outcome},result:undefined}));
  const setStolenGold=economy.change(z.object({run:entityId,amount:z.int32().nonnegative()}),z.undefined(),(s,i)=>({state:{...s,stolenGold:i.amount},result:undefined}));
  const setPotionChance=economy.change(z.object({run:entityId,chance:z.int32()}),z.undefined(),(s,i)=>({state:{...s,potionChance:i.chance},result:undefined}));
  const arrive=position.change(z.object({run:entityId,x:z.int32(),y:z.int32(),room:adventureStateSchema.shape.room,event:z.int32()}),z.undefined(),(s,i)=>({state:{...s,lastRoom:s.room,x:i.x,y:i.y,floor:s.floor+1,room:i.room,event:i.event,hasContinuation:true},result:undefined}));
  const setRoom=position.change(z.object({run:entityId,room:adventureStateSchema.shape.room,event:z.int32()}),z.undefined(),(s,i)=>({state:{...s,room:i.room,event:i.event},result:undefined}));
  const setEventData=position.change(z.object({run:entityId,data:z.int32()}),z.undefined(),(s,i)=>({state:{...s,eventData:i.data},result:undefined}));
  const setColorlessPool=pools.change(z.object({run:entityId,cards:z.array(cardDefinitionSchema)}),z.undefined(),(s,i)=>({state:{...s,colorlessPool:[...i.cards]},result:undefined}));
  const removeEvent=pools.change(z.object({run:entityId,id:z.int32(),pools:z.array(z.enum(['eventList','shrineList','oneTimeEvents']))}),z.undefined(),(s,i)=>{let next={...s};for(const pool of i.pools){const index=next[pool].indexOf(i.id);if(index>=0)next={...next,[pool]:next[pool].filter((_,at)=>at!==index)};}return{state:next,result:undefined};});
  const setRoomChances=economy.change(z.object({run:entityId,monster:z.number(),shop:z.number(),treasure:z.number()}),z.undefined(),(s,i)=>({state:{...s,monsterChance:i.monster,shopChance:i.shop,treasureChance:i.treasure},result:undefined}));
  const setBossRelics=m.atom({input:z.object({run:entityId,relics:z.array(relicDefinitionSchema)}),output:z.undefined(),reads:[rewards.component,position.component],writes:[rewards.component,position.component],emits:[],run(r,i){return{writes:[{entity:i.run,component:rewards.component,value:{...required(r.component(i.run,rewards.component)),bossRelics:i.relics}},{entity:i.run,component:position.component,value:{...required(r.component(i.run,position.component)),screen:'BOSS_RELIC_REWARDS'}}],events:[],result:undefined};}});
  const setChest=m.atom({input:z.object({run:entityId,chest:adventureStateSchema.shape.chest}),output:z.undefined(),reads:[rewards.component,position.component],writes:[rewards.component,position.component],emits:[],run(r,i){return{writes:[{entity:i.run,component:rewards.component,value:{...required(r.component(i.run,rewards.component)),chest:i.chest}},{entity:i.run,component:position.component,value:{...required(r.component(i.run,position.component)),screen:'TREASURE_ROOM'}}],events:[],result:undefined};}});
  const incrementFloor=position.change(z.object({run:entityId}),z.undefined(),s=>({state:{...s,floor:s.floor+1},result:undefined}));
  const beginAct=m.atom({input:z.object({run:entityId,act:z.int32(),map:adventureStateSchema.shape.map,monsterList:z.array(z.int32()),eliteList:z.array(z.int32()),boss:z.int32(),secondBoss:z.int32(),eventList:z.array(z.int32()),shrineList:z.array(z.int32()),colorlessPool:z.array(cardDefinitionSchema)}),output:z.undefined(),reads:[position.component,plan.component,pools.component,economy.component],writes:[position.component,plan.component,pools.component,economy.component],emits:[],run(r,i){return{writes:[
    {entity:i.run,component:position.component,value:{...required(r.component(i.run,position.component)),act:i.act,x:-1,y:-1,screen:'MAP_SCREEN'}},
    {entity:i.run,component:plan.component,value:{...required(r.component(i.run,plan.component)),map:i.map,monsterList:i.monsterList,eliteList:i.eliteList,boss:i.boss,secondBoss:i.secondBoss,monsterOffset:0,eliteOffset:0}},
    {entity:i.run,component:pools.component,value:{...required(r.component(i.run,pools.component)),eventList:i.eventList,shrineList:i.shrineList,colorlessPool:i.colorlessPool}},
    {entity:i.run,component:economy.component,value:{...required(r.component(i.run,economy.component)),monsterChance:Math.fround(.1),shopChance:Math.fround(.03),treasureChance:Math.fround(.02),potionChance:0}},
  ],events:[],result:undefined};}});
  const consumeEncounter=plan.change(z.object({run:entityId,elite:z.boolean(),encounter:z.int32()}),z.int32(),(s,i)=>{
    const list=i.elite?s.eliteList:s.monsterList,index=i.elite?s.eliteOffset:s.monsterOffset;
    if(list[index]===undefined)throw Error('Encounter plan requires refill');
    const next=list.map((value,at)=>at===index?i.encounter:value);
    return{state:{...s,...(i.elite?{eliteList:next,eliteOffset:index+1}:{monsterList:next,monsterOffset:index+1})},result:i.encounter};
  });
  const takeEncounter=defineEffect<{run:number;elite:boolean;choices:OrderChoice[]},number>(b=>{
    const encounter=b.local<number>();return sequence(b.assign(encounter,call(ordering.exports.select,{actual:b.read(v=>{
      const s=v.query(plan.current,v.input.run),value=v.input.elite?s.eliteList[s.eliteOffset]:s.monsterList[s.monsterOffset];
      if(value===undefined)throw Error('Encounter plan requires refill');return value;
    }),choices:b.read(v=>v.input.choices)})),call(consumeEncounter,{run:b.read(v=>v.input.run),elite:b.read(v=>v.input.elite),encounter}),b.return(encounter));
  });
  const setRewards=m.atom({input:z.object({run:entityId,rewards:rewardsSchema}),output:z.undefined(),reads:[rewards.component,position.component],writes:[rewards.component,position.component],emits:[],run(r,i){return{writes:[{entity:i.run,component:rewards.component,value:{...required(r.component(i.run,rewards.component)),rewards:i.rewards}},{entity:i.run,component:position.component,value:{...required(r.component(i.run,position.component)),screen:'REWARDS'}}],events:[],result:undefined};}});
  const removeReward=rewards.change(z.object({run:entityId,kind:z.enum(['cards','gold','potions','relics']),index:z.int32().nonnegative()}),z.undefined(),(s,i)=>{
    if(i.index>=s.rewards[i.kind].length)throw Error('Invalid reward index');
    return{state:{...s,rewards:{...s.rewards,[i.kind]:s.rewards[i.kind].filter((_,index)=>index!==i.index)}},result:undefined};
  });
  const beginSelection=m.atom({input:z.object({run:entityId,selection:selectionSchema}),output:z.undefined(),reads:[position.component],writes:[selection.component,position.component],emits:[],run(r,i){return{writes:[{entity:i.run,component:selection.component,value:{selection:i.selection}},{entity:i.run,component:position.component,value:{...required(r.component(i.run,position.component)),screen:'CARD_SELECT'}}],events:[],result:undefined};}});
  const acceptSelection=selection.change(z.object({run:entityId,index:z.int32().nonnegative()}),z.boolean(),(s,i)=>{const chosen=s.selection.cards[i.index];if(!chosen||s.selection.selected.length>=s.selection.count)throw Error('Illegal permanent card selection');const selection={...s.selection,cards:s.selection.cards.filter((_,index)=>index!==i.index),selected:[...s.selection.selected,chosen]};return{state:{...s,selection},result:selection.selected.length===selection.count};});
  const setTransformStream=selection.change(z.object({run:entityId,stream:entityId}),z.undefined(),(s,i)=>({state:{...s,selection:{...s.selection,transformStream:i.stream}},result:undefined}));
  const consumeRelic=pools.change(z.object({run:entityId,tier:z.enum(relicTiers),index:z.int32().nonnegative()}),relicDefinitionSchema,(s,i)=>{
    const pool=s.relicPools[i.tier],definition=pool[i.index];if(!definition)throw Error('Pinned source relic pool exhausted');
    return{state:{...s,relicPools:{...s.relicPools,[i.tier]:pool.filter((_,at)=>at!==i.index)}},result:definition};
  });
  const takeRelic=defineEffect<{run:number;tier:RelicTier;front:boolean;publication?:{name:string;accepted:readonly string[]}},RelicDefinition>(b=>{
    const index=b.local<number>(),definition=b.local<RelicDefinition>();return sequence(b.assign(index,call(ordering.exports.select,{
      actual:b.read(v=>{const pool=v.query(pools.current,v.input.run).relicPools[v.input.tier];if(!pool.length)throw Error('Pinned source relic pool exhausted');return v.input.front?0:pool.length-1;}),
      choices:b.read(v=>{const pool=v.query(pools.current,v.input.run).relicPools[v.input.tier];return pool.map((definition,value)=>{const key=v.query(relics.exports.definitionId,definition);return{key,value,weight:probabilityMass(1n,BigInt(pool.length)),...(v.input.publication?{publication:v.input.publication.accepted.includes(key)?{name:v.input.publication.name,value:key}:null}:{})};});}),
    })),b.assign(definition,call(consumeRelic,{run:b.read(v=>v.input.run),tier:b.read(v=>v.input.tier),index})),b.return(definition));
  });
  const {record,published}=history;
  return{exports:{detailsEnabled,optionDetails,setOptionDetails,enableDetails,cardPools,bindings:bindings.current,position:position.current,plan:plan.current,economy:economy.current,pools:pools.current,selection:selection.current,rewards:rewards.current,history:history.current,historyCursor:history.cursor,pendingHistory:history.pending,catalog,status,location,market,rewardScene,selectionContext,historyStatus,publication,privateProjection,notifyCombatFinished,combatFinished:combatFinished.public,combatStages,kind,current,instances,prepareRequest,requesting:requesting.public,entered:entered.public,notifyEntered,forActor,card,relic,hasRelic,setScene,setRarity,countShopRemove,setKeys,setOutcome,setStolenGold,setPotionChance,arrive,setRoom,setEventData,setColorlessPool,removeEvent,setRoomChances,setBossRelics,setChest,incrementFloor,beginAct,takeEncounter,setRewards,removeReward,beginSelection,acceptSelection,setTransformStream,takeRelic,record,published}};
}});
